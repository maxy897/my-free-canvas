import type { Env } from "../types";

/**
 * Serve a file from R2 cache (fast) or fall back to Telegram (persistent).
 * Returns the file as a Response, or null if not found.
 */
export async function serveFile(
  env: Env,
  fileKey: string
): Promise<Response | null> {
  // Try R2 first
  const r2Object = await env.R2.get(fileKey);
  if (r2Object) {
    const headers = new Headers();
    headers.set("Content-Type", r2Object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("ETag", r2Object.httpEtag);
    return new Response(r2Object.body, { headers });
  }

  // Try Telegram fallback
  if (!env.TELEGRAM_BOT_TOKEN) return null;

  // Look up file_id from D1
  const record = await env.DB.prepare(
    `SELECT "telegramFileId", "mimeType" FROM "canvas_file" WHERE "r2Key" = ?`
  )
    .bind(fileKey)
    .first<{ telegramFileId: string; mimeType: string }>();

  if (!record?.telegramFileId) return null;

  // Get file URL from Telegram
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${record.telegramFileId}`
  );
  const fileInfo = (await fileInfoRes.json()) as { ok: boolean; result?: { file_path: string } };
  if (!fileInfo.ok || !fileInfo.result) return null;

  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return null;

  const data = await fileRes.arrayBuffer();

  // Cache back to R2 for next time
  await env.R2.put(fileKey, data, {
    httpMetadata: { contentType: record.mimeType },
  });

  const headers = new Headers();
  headers.set("Content-Type", record.mimeType);
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(data, { headers });
}

/**
 * Store a file to R2 and record in D1.
 */
export async function storeFile(
  env: Env,
  opts: {
    fileKey: string;
    data: ArrayBuffer;
    mimeType: string;
    userId: string;
    telegramFileId?: string;
    width?: number;
    height?: number;
  }
): Promise<void> {
  // Upload to R2
  await env.R2.put(opts.fileKey, opts.data, {
    httpMetadata: { contentType: opts.mimeType },
  });

  // Record in D1
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO "canvas_file" (id, "userId", "telegramFileId", "r2Key", "mimeType", "width", "height")
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, opts.userId, opts.telegramFileId || null, opts.fileKey, opts.mimeType, opts.width || null, opts.height || null)
    .run();
}
