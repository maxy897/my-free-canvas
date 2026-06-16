import type { Env } from "../types";
import { toIsoUtc } from "./datetime";

/**
 * File validation and storage optimization layer
 * Handles MIME type validation, size limits, deduplication, and caching
 */

// Configuration
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/json",
]);

const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "application/json": ".json",
};

interface FileValidationResult {
  valid: boolean;
  error?: string;
}

interface FileMetadata {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  hash?: string;
}

interface FileStorageOptions {
  fileKey: string;
  data: ArrayBuffer;
  mimeType: string;
  userId: string;
  telegramFileId?: string;
  metadata?: Partial<FileMetadata>;
}

/**
 * Validate file before storage
 */
export function validateFile(
  data: ArrayBuffer,
  mimeType: string
): FileValidationResult {
  // Check size
  if (data.byteLength === 0) {
    return { valid: false, error: "File is empty" };
  }

  if (data.byteLength > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `MIME type ${mimeType} not allowed. Allowed types: ${Array.from(ALLOWED_MIME_TYPES).join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Calculate SHA-256 hash of file for deduplication
 */
export async function calculateFileHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if file already exists (by hash)
 */
export async function checkFileDuplicate(
  env: Env,
  hash: string,
  userId: string
): Promise<{
  exists: boolean;
  existingKey?: string;
}> {
  const existing = await env.DB.prepare(
    `SELECT "r2Key" FROM "canvas_file" WHERE "hash" = ? AND "userId" = ? LIMIT 1`
  )
    .bind(hash, userId)
    .first<{ r2Key: string }>();

  if (existing?.r2Key) {
    return { exists: true, existingKey: existing.r2Key };
  }

  return { exists: false };
}

/**
 * Generate optimized file key with metadata
 */
export function generateFileKey(
  userId: string,
  mimeType: string,
  timestamp = Date.now()
): string {
  const extension = MIME_TYPE_EXTENSIONS[mimeType] || ".bin";
  const sanitizedUserId = userId.replace(/[^a-z0-9-]/g, "");
  return `${sanitizedUserId}/${timestamp}-${crypto.randomUUID()}${extension}`;
}

/**
 * Compress image metadata for storage efficiency
 * Uses single-letter keys: w=width, h=height, d=durationMs, s=hash
 */
export function compressMetadata(metadata?: Partial<FileMetadata>): string {
  if (!metadata) return "{}";
  // Only store non-null, non-undefined values
  const compressed: Record<string, unknown> = {};
  if (metadata.width) compressed.w = metadata.width;
  if (metadata.height) compressed.h = metadata.height;
  if (metadata.durationMs) compressed.d = metadata.durationMs;
  if (metadata.hash) compressed.s = metadata.hash;
  return JSON.stringify(compressed);
}

/**
 * Decompress metadata
 */
export function decompressMetadata(
  compressed: string
): Partial<FileMetadata> {
  if (!compressed || compressed === "{}") return {};
  try {
    const data = JSON.parse(compressed) as Record<string, unknown>;
    return {
      width: data.w as number | undefined,
      height: data.h as number | undefined,
      durationMs: data.d as number | undefined,
      hash: data.s as string | undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Store file with validation and deduplication
 */
export async function storeFileEnhanced(
  env: Env,
  opts: FileStorageOptions
): Promise<{
  success: boolean;
  fileKey: string;
  fileId: string;
  isDuplicate: boolean;
  error?: string;
}> {
  // Validate file
  const validation = validateFile(opts.data, opts.mimeType);
  if (!validation.valid) {
    return {
      success: false,
      fileKey: "",
      fileId: "",
      isDuplicate: false,
      error: validation.error,
    };
  }

  // Calculate hash for deduplication
  const hash = await calculateFileHash(opts.data);

  // Check for duplicates
  const duplicate = await checkFileDuplicate(env, hash, opts.userId);
  if (duplicate.exists && duplicate.existingKey) {
    // Log duplicate usage
    await env.DB.prepare(
      `INSERT INTO "canvas_file" (id, "userId", "r2Key", "mimeType", "sizeBytes", "hash")
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        opts.userId,
        duplicate.existingKey,
        opts.mimeType,
        opts.data.byteLength,
        hash
      )
      .run();

    return {
      success: true,
      fileKey: duplicate.existingKey,
      fileId: crypto.randomUUID(),
      isDuplicate: true,
    };
  }

  // Generate file key
  const fileKey = opts.fileKey || generateFileKey(opts.userId, opts.mimeType);

  // Upload to R2
  try {
    await env.R2.put(fileKey, opts.data, {
      httpMetadata: {
        contentType: opts.mimeType,
        cacheControl: "public, max-age=31536000", // 1 year
      },
    });
  } catch (error) {
    return {
      success: false,
      fileKey,
      fileId: "",
      isDuplicate: false,
      error: `Failed to upload to R2: ${(error as Error).message}`,
    };
  }

  // Compress metadata for storage
  const compressedMetadata = compressMetadata({
    ...opts.metadata,
    hash,
  });

  // Record in D1
  const fileId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO "canvas_file" (id, "userId", "telegramFileId", "r2Key", "mimeType", "sizeBytes", "width", "height", "durationMs", "hash", "createdAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(
        fileId,
        opts.userId,
        opts.telegramFileId || null,
        fileKey,
        opts.mimeType,
        opts.data.byteLength,
        opts.metadata?.width || null,
        opts.metadata?.height || null,
        opts.metadata?.durationMs || null,
        hash
      )
      .run();
  } catch (error) {
    return {
      success: false,
      fileKey,
      fileId,
      isDuplicate: false,
      error: `Failed to record in database: ${(error as Error).message}`,
    };
  }

  return {
    success: true,
    fileKey,
    fileId,
    isDuplicate: false,
  };
}

/**
 * Serve file with optimization and caching
 */
export async function serveFileEnhanced(
  env: Env,
  fileKey: string
): Promise<{
  response: Response | null;
  cached: boolean;
  source: "r2" | "telegram" | "none";
}> {
  // Try R2 first (primary cache)
  try {
    const r2Object = await env.R2.get(fileKey);
    if (r2Object) {
      const headers = new Headers();
      headers.set(
        "Content-Type",
        r2Object.httpMetadata?.contentType || "application/octet-stream"
      );
      headers.set("Cache-Control", "public, max-age=31536000"); // 1 year
      headers.set("ETag", r2Object.httpEtag);

      return {
        response: new Response(r2Object.body, { headers }),
        cached: true,
        source: "r2",
      };
    }
  } catch (error) {
    console.error(`Failed to read from R2: ${fileKey}`, error);
  }

  // Fall back to Telegram (persistent backup)
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { response: null, cached: false, source: "none" };
  }

  try {
    // Look up file metadata and Telegram file ID
    const record = await env.DB.prepare(
      `SELECT "telegramFileId", "mimeType" FROM "canvas_file" WHERE "r2Key" = ? LIMIT 1`
    )
      .bind(fileKey)
      .first<{ telegramFileId: string; mimeType: string }>();

    if (!record?.telegramFileId) {
      return { response: null, cached: false, source: "none" };
    }

    // Get file info from Telegram
    const fileInfoRes = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${record.telegramFileId}`,
      { signal: AbortSignal.timeout(5000) }
    );

    const fileInfo = (await fileInfoRes.json()) as {
      ok: boolean;
      result?: { file_path: string };
    };
    if (!fileInfo.ok || !fileInfo.result) {
      return { response: null, cached: false, source: "none" };
    }

    // Download file from Telegram
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(10000) });

    if (!fileRes.ok) {
      return { response: null, cached: false, source: "none" };
    }

    const data = await fileRes.arrayBuffer();

    // Cache back to R2 for next time (fire-and-forget)
    env.R2.put(fileKey, data, {
      httpMetadata: { contentType: record.mimeType },
    }).catch((err) => {
      console.error(`Failed to cache to R2: ${fileKey}`, err);
    });

    const headers = new Headers();
    headers.set("Content-Type", record.mimeType);
    headers.set("Cache-Control", "public, max-age=31536000");

    return {
      response: new Response(data, { headers }),
      cached: false,
      source: "telegram",
    };
  } catch (error) {
    console.error(`Failed to read from Telegram: ${fileKey}`, error);
    return { response: null, cached: false, source: "none" };
  }
}

/**
 * Get file metadata for a stored file
 */
export async function getFileMetadata(
  env: Env,
  fileKey: string,
  userId: string
): Promise<FileMetadata | null> {
  const file = await env.DB.prepare(
    `SELECT "mimeType", "sizeBytes", "width", "height", "durationMs", "hash"
     FROM "canvas_file" WHERE "r2Key" = ? AND "userId" = ? LIMIT 1`
  )
    .bind(fileKey, userId)
    .first<{
      mimeType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      hash: string;
    }>();

  if (!file) return null;

  return {
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    width: file.width || undefined,
    height: file.height || undefined,
    durationMs: file.durationMs || undefined,
    hash: file.hash,
  };
}

/**
 * Delete file from storage
 */
export async function deleteFile(
  env: Env,
  fileKey: string,
  userId: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  // Verify ownership
  const file = await env.DB.prepare(
    `SELECT id, "userId" FROM "canvas_file" WHERE "r2Key" = ? LIMIT 1`
  )
    .bind(fileKey)
    .first<{ id: string; userId: string }>();

  if (!file) {
    return { success: false, error: "File not found" };
  }

  if (file.userId !== userId) {
    return { success: false, error: "Access denied" };
  }

  try {
    // Delete from R2
    await env.R2.delete(fileKey);
  } catch (error) {
    console.error(`Failed to delete from R2: ${fileKey}`, error);
    // Continue with DB deletion even if R2 delete fails
  }

  // Delete from database
  try {
    await env.DB.prepare(`DELETE FROM "canvas_file" WHERE "r2Key" = ?`).bind(
      fileKey
    ).run();
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete from database: ${(error as Error).message}`,
    };
  }

  return { success: true };
}

/**
 * List user's files with pagination
 */
export async function listUserFiles(
  env: Env,
  userId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{
  files: (FileMetadata & { fileKey: string; createdAt: string })[];
  total: number;
}> {
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  // Get total count
  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM "canvas_file" WHERE "userId" = ?`
  )
    .bind(userId)
    .first<{ count: number }>();

  const total = countResult?.count || 0;

  // Get paginated results
  const files = await env.DB.prepare(
    `SELECT "r2Key", "mimeType", "sizeBytes", "width", "height", "durationMs", "hash", "createdAt"
     FROM "canvas_file" WHERE "userId" = ?
     ORDER BY "createdAt" DESC
     LIMIT ? OFFSET ?`
  )
    .bind(userId, limit, offset)
    .all<{
      r2Key: string;
      mimeType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      hash: string;
      createdAt: string;
    }>();

  return {
    files: (files?.results || []).map((f) => ({
      fileKey: f.r2Key,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      width: f.width || undefined,
      height: f.height || undefined,
      durationMs: f.durationMs || undefined,
      hash: f.hash,
      createdAt: toIsoUtc(f.createdAt),
    })),
    total,
  };
}

/**
 * Get storage usage statistics for a user
 */
export async function getUserStorageStats(
  env: Env,
  userId: string
): Promise<{
  totalFiles: number;
  totalSizeBytes: number;
  byMimeType: Record<string, { count: number; sizeBytes: number }>;
}> {
  const stats = await env.DB.prepare(
    `SELECT "mimeType", COUNT(*) as count, SUM("sizeBytes") as totalSize
     FROM "canvas_file" WHERE "userId" = ?
     GROUP BY "mimeType"`
  )
    .bind(userId)
    .all<{ mimeType: string; count: number; totalSize: number }>();

  const byMimeType: Record<string, { count: number; sizeBytes: number }> = {};
  let totalFiles = 0;
  let totalSizeBytes = 0;

  for (const row of stats?.results || []) {
    byMimeType[row.mimeType] = {
      count: row.count,
      sizeBytes: row.totalSize,
    };
    totalFiles += row.count;
    totalSizeBytes += row.totalSize;
  }

  return {
    totalFiles,
    totalSizeBytes,
    byMimeType,
  };
}
