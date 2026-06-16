/**
 * ChatGPT2API Image Generation Provider
 * Async task API for text-to-image and image editing. The upstream host is
 * fully configurable via the CHATGPT2API_BASE_URL environment variable.
 *
 * Flow:
 * 1. Submit task via POST /api/creation-tasks/image-generations
 * 2. Poll GET /api/creation-tasks?ids=<id> until status=success
 * 3. Download auth-protected images and re-upload to asset service
 * 4. Return public image URLs
 */

const API_BASE = Deno.env.get("CHATGPT2API_BASE_URL") || "";
const API_KEY = Deno.env.get("CHATGPT2API_KEY") || "";
const ASSET_SERVICE_URL = Deno.env.get("ASSET_SERVICE_URL") || "";
const ASSET_SERVICE_API_KEY = Deno.env.get("ASSET_SERVICE_API_KEY") || "";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max

// On task success the upstream occasionally reports the image URL before its
// auth-protected read path is ready (404 lag between "task=success" and
// "/images/<key> readable"). Retry that specific status with bounded backoff;
// other failures fall through immediately.
const REUPLOAD_404_RETRY_DELAYS_MS = [1000, 3000, 6000, 10000];

/**
 * Per-call upstream endpoint, used when the worker pushes a configured
 * provider via the multi-provider failover path. Omit to fall back to
 * the module-level env (CHATGPT2API_BASE_URL / CHATGPT2API_KEY) — that
 * preserves the legacy "single env-driven upstream" code path
 * unchanged.
 */
export interface EndpointOverride {
  baseUrl: string;
  apiKey: string;
}

interface ResolvedEndpoint {
  baseUrl: string;
  apiKey: string;
}

function resolveEndpoint(override?: EndpointOverride): ResolvedEndpoint {
  const baseUrl = override?.baseUrl?.trim().replace(/\/+$/, "") || API_BASE;
  if (!baseUrl) {
    throw new Error(
      "CHATGPT2API base URL is not configured. Set CHATGPT2API_BASE_URL " +
        "in the deno-relay environment, or supply a per-provider override.",
    );
  }
  return {
    baseUrl,
    apiKey: override?.apiKey || API_KEY,
  };
}

function sampleUrls(urls: string[], max = 5): string[] {
  if (urls.length <= max) return urls;
  return [...urls.slice(0, max), `...(+${urls.length - max} more)`];
}

export interface GenerateParams {
  prompt: string;
  n?: number;
  size?: string;
  image_resolution?: string;
  quality?: string;
  output_format?: string;
  model?: string;
  trace?: TaskTrace;
  /** Worker-pushed upstream override; omit to use env defaults. */
  endpoint?: EndpointOverride;
}

export interface EditParams {
  prompt: string;
  image_url: string;
  image_urls?: string[];
  n?: number;
  size?: string;
  image_resolution?: string;
  quality?: string;
  output_format?: string;
  model?: string;
  trace?: TaskTrace;
  /** Worker-pushed upstream override; omit to use env defaults. */
  endpoint?: EndpointOverride;
}

interface TaskTrace {
  taskId?: string;
  userId?: string;
}

export interface AssetUploadResult {
  url: string;
  asset?: unknown;
}

export interface GenerationResult {
  urls: string[];
  revisedPrompt?: string;
  metadata: Record<string, unknown>;
}

/**
 * Thrown by pollTask when the upstream task succeeds but returns a text reply
 * instead of an image (e.g. the model decided to "ask a clarifying question"
 * rather than render). Used by editImage/generateImages to trigger a one-shot
 * fallback retry that feeds the text reply back as additional prompt context.
 */
class TextResponseError extends Error {
  constructor(public readonly textResponse: string) {
    super(`API returned text instead of image: ${textResponse}`);
    this.name = "TextResponseError";
  }
}

function normalizeImageUrls(params: EditParams): string[] {
  const urls = params.image_urls && params.image_urls.length > 0
    ? params.image_urls
    : [params.image_url];
  return [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 14);
}

function makeHeaders(endpoint: ResolvedEndpoint, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${endpoint.apiKey}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

function formatTrace(trace?: TaskTrace): string {
  if (!trace?.taskId && !trace?.userId) return "";
  return ` appTaskId=${trace.taskId || ""} userId=${trace.userId || ""}`;
}

/**
 * Submit an async text-to-image generation task and poll until completion.
 * Wraps the actual call in a single retry: if the upstream returns a text reply
 * (model decided to "ask" instead of render), we feed that text back as
 * additional prompt context and try once more before giving up.
 */
export async function generateImages(params: GenerateParams): Promise<GenerationResult> {
  try {
    return await generateImagesOnce(params);
  } catch (err) {
    if (err instanceof TextResponseError) {
      const trace = formatTrace(params.trace);
      console.warn(
        `[chatgpt2api] generation returned text instead of image; retrying once with augmented prompt${trace}`
      );
      const augmentedPrompt = `${params.prompt}\n\n${err.textResponse}`;
      return await generateImagesOnce({ ...params, prompt: augmentedPrompt });
    }
    throw err;
  }
}

async function generateImagesOnce(params: GenerateParams): Promise<GenerationResult> {
  const endpoint = resolveEndpoint(params.endpoint);
  if (!endpoint.apiKey) {
    throw new Error("CHATGPT2API_KEY not configured");
  }

  const clientTaskId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload: Record<string, unknown> = {
    client_task_id: clientTaskId,
    model: params.model || "gpt-image-2",
    prompt: params.prompt,
    n: params.n || 1,
    output_format: params.output_format || "png",
    visibility: "private",
  };
  if (params.size) payload.size = params.size;
  if (params.image_resolution) payload.image_resolution = params.image_resolution;
  if (params.quality) payload.quality = params.quality;

  const trace = formatTrace(params.trace);
  console.log(`[chatgpt2api] Submitting generation task: ${clientTaskId}${trace}`);

  const submitRes = await fetch(`${endpoint.baseUrl}/api/creation-tasks/image-generations`, {
    method: "POST",
    headers: makeHeaders(endpoint, "application/json"),
    body: JSON.stringify(payload),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Submit failed (${submitRes.status}): ${errText.slice(0, 300)}`);
  }

  const submitData = await submitRes.json() as { id: string; status: string };
  console.log(`[chatgpt2api] Task submitted: ${submitData.id}, status: ${submitData.status}${trace}`);

  // Poll until completion
  return await pollTask(endpoint, submitData.id, params.trace);
}

/**
 * Submit an async image editing task.
 * Wraps editImageOnce in a single retry on TextResponseError, the same fallback
 * strategy used by generateImages.
 */
export async function editImage(params: EditParams): Promise<GenerationResult> {
  try {
    return await editImageOnce(params);
  } catch (err) {
    if (err instanceof TextResponseError) {
      const trace = formatTrace(params.trace);
      console.warn(
        `[chatgpt2api] edit returned text instead of image; retrying once with augmented prompt${trace}`
      );
      const augmentedPrompt = `${params.prompt}\n\n${err.textResponse}`;
      return await editImageOnce({ ...params, prompt: augmentedPrompt });
    }
    throw err;
  }
}

/**
 * Submit an async image editing task.
 * Downloads the source image and uploads via multipart/form-data.
 */
async function editImageOnce(params: EditParams): Promise<GenerationResult> {
  const endpoint = resolveEndpoint(params.endpoint);
  if (!endpoint.apiKey) {
    throw new Error("CHATGPT2API_KEY not configured");
  }

  const clientTaskId = `canvas-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const trace = formatTrace(params.trace);
  const imageUrls = normalizeImageUrls(params);
  if (imageUrls.length === 0) {
    throw new Error("No source image URL provided");
  }
  console.log(`[chatgpt2api] Downloading ${imageUrls.length} source image(s)${trace}`);
  const imageBlobs = await Promise.all(
    imageUrls.map(async (url, index) => {
      const imageRes = await fetch(url);
      if (!imageRes.ok) {
        throw new Error(`Failed to download source image ${index + 1}: ${imageRes.status}`);
      }
      return imageRes.blob();
    })
  );

  // Build multipart form
  const form = new FormData();
  form.append("client_task_id", clientTaskId);
  form.append("model", params.model || "gpt-image-2");
  form.append("prompt", params.prompt);
  form.append("n", String(params.n || 1));
  form.append("output_format", params.output_format || "png");
  form.append("visibility", "private");
  if (params.size) form.append("size", params.size);
  if (params.image_resolution) form.append("image_resolution", params.image_resolution);
  if (params.quality) form.append("quality", params.quality);
  imageBlobs.forEach((imageBlob, index) => {
    form.append(imageBlobs.length > 1 ? "image[]" : "image", imageBlob, `input-${index + 1}.png`);
  });

  console.log(`[chatgpt2api] Submitting edit task: ${clientTaskId}${trace}`);

  const submitRes = await fetch(`${endpoint.baseUrl}/api/creation-tasks/image-edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.apiKey}` },
    body: form,
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Edit submit failed (${submitRes.status}): ${errText.slice(0, 300)}`);
  }

  const submitData = await submitRes.json() as { id: string; status: string };
  console.log(`[chatgpt2api] Edit task submitted: ${submitData.id}, status: ${submitData.status}${trace}`);

  return await pollTask(endpoint, submitData.id, params.trace);
}

/**
 * Poll the task until it reaches a terminal state.
 */
async function pollTask(
  endpoint: ResolvedEndpoint,
  taskId: string,
  traceInfo?: TaskTrace
): Promise<GenerationResult> {
  const trace = formatTrace(traceInfo);
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${endpoint.baseUrl}/api/creation-tasks?ids=${taskId}`, {
      headers: makeHeaders(endpoint),
    });

    if (!res.ok) {
      console.warn(`[chatgpt2api] Poll failed (${res.status}), retrying...${trace}`);
      continue;
    }

    const body = await res.json() as {
      items: Array<{
        id: string;
        status: string;
        output_type?: string;
        data?: Array<{ url?: string; revised_prompt?: string; text_response?: string }>;
        error?: string;
        output_statuses?: string[];
      }>;
      missing_ids?: string[];
    };

    const task = body.items?.[0];
    if (!task) {
      console.warn(`[chatgpt2api] Task ${taskId} not found in response, retrying...${trace}`);
      continue;
    }

    if (task.status === "success") {
      // Check if it's a text response instead of images
      if (task.output_type === "text") {
        const textContent = task.data?.[0]?.text_response || "No image generated";
        throw new TextResponseError(textContent);
      }

      const urls = (task.data || [])
        .map((item) => item.url)
        .filter((url): url is string => !!url);
      const outputStatuses = Array.isArray(task.output_statuses) ? task.output_statuses : [];
      console.log(
        `[chatgpt2api] Task ${taskId} success snapshot: dataCount=${task.data?.length || 0} urlCount=${urls.length} outputStatusesCount=${outputStatuses.length} outputStatuses=${outputStatuses.join(",") || "(none)"} sampledUrls=${JSON.stringify(sampleUrls(urls))}${trace}`
      );

      if (urls.length === 0) {
        throw new Error("Task succeeded but no image URLs in response");
      }

      const revisedPrompt = task.data?.[0]?.revised_prompt;
      console.log(`[chatgpt2api] Task ${taskId} completed: ${urls.length} image(s)${trace}`);

      // Re-upload images to asset service for public access
      const uploads = await reuploadImages(endpoint, taskId, urls, traceInfo);
      const publicUrls = uploads.map((upload) => upload.url);
      const assets = uploads.map((upload) => upload.asset).filter((asset) => asset !== undefined);

      return {
        urls: publicUrls,
        revisedPrompt: revisedPrompt || undefined,
        metadata: { model: "gpt-image-2", count: publicUrls.length, assets },
      };
    }

    if (task.status === "error" || task.status === "cancelled") {
      throw new Error(`Task ${task.status}: ${task.error || "Unknown error"}`);
    }

    // Still queued/running — log progress
    if (attempt % 5 === 0) {
      console.log(`[chatgpt2api] Task ${taskId} status: ${task.status} (attempt ${attempt + 1})${trace}`);
    }
  }

  throw new Error(`Task ${taskId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}

/**
 * Download auth-protected images from the API and re-upload to the asset service.
 * Returns public URLs accessible without authentication.
 */
async function reuploadImages(
  endpoint: ResolvedEndpoint,
  taskId: string,
  protectedUrls: string[],
  traceInfo?: TaskTrace
): Promise<AssetUploadResult[]> {
  const trace = formatTrace(traceInfo);
  if (!ASSET_SERVICE_URL || !ASSET_SERVICE_API_KEY) {
    throw new Error(
      `[task:${taskId}] asset service not configured: ASSET_SERVICE_URL or ASSET_SERVICE_API_KEY is missing`
    );
  }

  const uploadUrl = `${ASSET_SERVICE_URL.replace(/\/+$/, "")}/api/assets/upload`;
  const uploads: AssetUploadResult[] = [];

  for (const url of protectedUrls) {
    try {
      console.log(`[chatgpt2api] [task:${taskId}] Reuploading source URL: ${url}${trace}`);

      // Download image with API auth.
      // Bounded retry on 404 only — see REUPLOAD_404_RETRY_DELAYS_MS comment.
      let imgRes: Response | null = null;
      let lastStatus = 0;
      let lastErrText = "";
      for (let attempt = 0; attempt <= REUPLOAD_404_RETRY_DELAYS_MS.length; attempt++) {
        const downloadStart = Date.now();
        const res = await fetch(url, { headers: makeHeaders(endpoint) });
        const downloadElapsedMs = Date.now() - downloadStart;
        console.log(
          `[chatgpt2api] [task:${taskId}] Download attempt ${attempt + 1}: status=${res.status} ok=${res.ok} contentType=${res.headers.get("content-type") || ""} contentLength=${res.headers.get("content-length") || ""} cacheControl=${res.headers.get("cache-control") || ""} server=${res.headers.get("server") || ""} elapsedMs=${downloadElapsedMs}${trace}`
        );

        if (res.ok) {
          imgRes = res;
          break;
        }

        lastStatus = res.status;
        lastErrText = await res.text();

        // Only 404 is retried — it's the symptom of the upstream success/read
        // race. Anything else (401/403/5xx/...) is a real error; fail fast.
        const isLastAttempt = attempt === REUPLOAD_404_RETRY_DELAYS_MS.length;
        if (res.status !== 404 || isLastAttempt) break;

        const delayMs = REUPLOAD_404_RETRY_DELAYS_MS[attempt];
        console.warn(
          `[chatgpt2api] [task:${taskId}] 404 on download, retrying in ${delayMs}ms (attempt ${attempt + 1}/${REUPLOAD_404_RETRY_DELAYS_MS.length}) url=${url}${trace}`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (!imgRes) {
        if (lastStatus === 404) {
          try {
            const verifyRes = await fetch(`${endpoint.baseUrl}/api/creation-tasks?ids=${taskId}`, {
              headers: makeHeaders(endpoint),
            });
            if (verifyRes.ok) {
              const verifyBody = await verifyRes.json() as {
                items?: Array<{ status?: string; output_statuses?: string[]; data?: Array<{ url?: string }> }>;
              };
              const latestTask = verifyBody.items?.[0];
              const latestUrls = (latestTask?.data || [])
                .map((item) => item.url)
                .filter((u): u is string => !!u);
              const stillPresent = latestUrls.includes(url);
              console.warn(
                `[chatgpt2api] [task:${taskId}] 404 verify snapshot: taskStatus=${latestTask?.status || "(none)"} outputStatuses=${(latestTask?.output_statuses || []).join(",") || "(none)"} dataCount=${latestTask?.data?.length || 0} urlCount=${latestUrls.length} urlStillPresent=${stillPresent} sampledUrls=${JSON.stringify(sampleUrls(latestUrls))}${trace}`
              );
            } else {
              const verifyErr = await verifyRes.text();
              console.warn(
                `[chatgpt2api] [task:${taskId}] 404 verify poll failed: status=${verifyRes.status} detail=${verifyErr.slice(0, 200)}${trace}`
              );
            }
          } catch (verifyErr) {
            console.warn(
              `[chatgpt2api] [task:${taskId}] 404 verify poll exception: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}${trace}`
            );
          }
        }
        throw new Error(
          `[task:${taskId}] download failed status=${lastStatus} url=${url} detail=${lastErrText.slice(0, 300)}`
        );
      }

      const blob = await imgRes.blob();
      const filename = url.split("/").pop() || "generated.png";

      // Upload to asset service
      const form = new FormData();
      form.append("file", blob, filename);
      form.append("type", "image");
      form.append("title", filename);
      form.append("app", "free_canvas");
      form.append("workflow_id", "canvas_generation");

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ASSET_SERVICE_API_KEY}` },
        body: form,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(
          `[task:${taskId}] asset upload failed status=${uploadRes.status} sourceUrl=${url} detail=${errText.slice(0, 300)}`
        );
      }

      const uploadData = await uploadRes.json() as {
        asset?: { url?: string; asset_details?: { url?: string } };
        url?: string;
      };
      const publicUrl = uploadData.asset?.url || uploadData.asset?.asset_details?.url || uploadData.url;

      if (publicUrl) {
        uploads.push({ url: publicUrl, asset: uploadData.asset });
        console.log(`[chatgpt2api] [task:${taskId}] Uploaded: ${filename} → ${publicUrl}${trace}`);
      } else {
        throw new Error(
          `[task:${taskId}] asset upload succeeded but no public URL in response, sourceUrl=${url}`
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[chatgpt2api] [task:${taskId}] Strict reupload failed for ${url}: ${reason}${trace}`);
      throw new Error(`[task:${taskId}] strict asset reupload failed for ${url}: ${reason}`);
    }
  }

  return uploads;
}

/**
 * Health check — verify API key is valid
 */
export async function healthCheck(): Promise<boolean> {
  const endpoint = resolveEndpoint();
  if (!endpoint.apiKey) return false;
  try {
    const res = await fetch(`${endpoint.baseUrl}/v1/models`, {
      headers: makeHeaders(endpoint),
    });
    return res.ok;
  } catch {
    return false;
  }
}
