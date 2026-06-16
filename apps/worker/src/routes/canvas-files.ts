import { Hono } from "hono";
import { serveFile } from "../lib/file-storage";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const canvasFileRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string; userName: string };
}>();

interface AssetServiceUploadResponse {
  asset?: Record<string, unknown> & {
    id?: string;
    url?: string;
    title?: string;
    type?: string;
    asset_details?: {
      url?: string;
      download_url?: string;
      thumbnail_url?: string;
      width?: string;
      height?: string;
      size?: string;
      duration?: string;
    };
  };
  id?: string;
  url?: string;
}

function getAssetServiceUrl(env: Env): string | null {
  const baseUrl = env.ASSET_SERVICE_URL?.replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/api/assets/upload` : null;
}

function readAssetUploadResult(data: AssetServiceUploadResponse) {
  const asset = data.asset;
  const url = asset?.url || asset?.asset_details?.url || data.url;
  const assetId = asset?.id || data.id || "";

  return {
    asset,
    assetId,
    url,
    title: asset?.title,
    type: asset?.type,
    width: asset?.asset_details?.width,
    height: asset?.asset_details?.height,
    size: asset?.asset_details?.size,
    downloadUrl: asset?.asset_details?.download_url,
    thumbnailUrl: asset?.asset_details?.thumbnail_url,
    duration: asset?.asset_details?.duration,
  };
}

function parseIntegerOrNull(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function recordUserUpload(
  env: Env,
  params: {
    userId: string;
    assetId: string;
    url: string;
    title?: string;
    type?: string;
    mimeType: string;
    thumbnailUrl?: string;
    downloadUrl?: string;
    width?: string | number;
    height?: string | number;
    sizeBytes?: string | number;
    durationMs?: string | number;
    projectId?: string | null;
  },
) {
  try {
    await env.DB.prepare(
      `INSERT INTO "user_upload"
        ("id", "userId", "assetServiceId", "url", "thumbnailUrl", "downloadUrl",
         "title", "mimeType", "type", "sizeBytes", "width", "height", "durationMs", "projectId")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        params.userId,
        params.assetId,
        params.url,
        params.thumbnailUrl ?? null,
        params.downloadUrl ?? null,
        params.title ?? null,
        params.mimeType,
        params.type ?? null,
        parseIntegerOrNull(params.sizeBytes),
        parseIntegerOrNull(params.width),
        parseIntegerOrNull(params.height),
        parseIntegerOrNull(params.durationMs),
        params.projectId ?? null,
      )
      .run();
  } catch (error) {
    console.error("[user_upload] Failed to record upload:", {
      userId: params.userId,
      assetId: params.assetId,
      message: (error as Error)?.message,
    });
  }
}

// POST /api/canvas/files/upload — upload a local canvas image through the asset service
canvasFileRoutes.post("/upload", authMiddleware, async (c) => {
  const uploadUrl = getAssetServiceUrl(c.env);
  if (!uploadUrl || !c.env.ASSET_SERVICE_API_KEY) {
    return c.json({ error: "Asset service is not configured" }, 503);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }

  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Only image uploads are supported" }, 400);
  }

  const userId = c.get("userId");
  const assetForm = new FormData();
  assetForm.set("file", file, file.name || "canvas-image");
  assetForm.set("type", "image");
  assetForm.set("title", file.name || "canvas-image");
  assetForm.set("app", "free_canvas");
  assetForm.set("user_id", userId);
  assetForm.set("workflow_id", "canvas");

  const projectId = form.get("projectId");
  const projectIdValue =
    typeof projectId === "string" && projectId && projectId !== "local" ? projectId : null;
  if (projectIdValue) {
    assetForm.set("task_id", projectIdValue);
  }

  const assetRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.ASSET_SERVICE_API_KEY}`,
    },
    body: assetForm,
  });

  if (!assetRes.ok) {
    const errorText = await assetRes.text();
    const detail = errorText.slice(0, 300);
    console.error("Asset service upload failed:", {
      status: assetRes.status,
      statusText: assetRes.statusText,
      detail,
    });

    return c.json(
      {
        error: "Asset service upload failed",
        detail,
      },
      502
    );
  }

  const assetData = (await assetRes.json()) as AssetServiceUploadResponse;
  const result = readAssetUploadResult(assetData);
  if (!result.url) {
    console.error("Asset service upload response did not include a URL:", assetData);
    return c.json({ error: "Asset service did not return a file URL" }, 502);
  }

  if (result.assetId) {
    c.executionCtx.waitUntil(
      recordUserUpload(c.env, {
        userId,
        assetId: result.assetId,
        url: result.url,
        title: result.title,
        type: result.type,
        mimeType: file.type,
        thumbnailUrl: result.thumbnailUrl,
        downloadUrl: result.downloadUrl,
        width: result.width,
        height: result.height,
        sizeBytes: result.size,
        durationMs: result.duration,
        projectId: projectIdValue,
      }),
    );
  } else {
    console.warn("[user_upload] Asset service response missing assetId; skipping DB record");
  }

  return c.json(result, 201);
});

// GET /api/canvas/files/:key — serve a file from R2 (or Telegram fallback)
canvasFileRoutes.get("/:key", async (c) => {
  const fileKey = c.req.param("key");

  // If R2 public URL is available, redirect
  if (c.env.R2_PUBLIC_URL) {
    const r2Object = await c.env.R2.head(fileKey);
    if (r2Object) {
      return c.redirect(`${c.env.R2_PUBLIC_URL}/${fileKey}`, 302);
    }
  }

  const response = await serveFile(c.env, fileKey);
  if (!response) {
    return c.json({ error: "File not found" }, 404);
  }

  return response;
});
