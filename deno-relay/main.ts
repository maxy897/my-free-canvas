import { txt2img, healthCheck as falHealthCheck } from "./providers/fal.ts";
import { generateImages, editImage, healthCheck as chatgpt2apiHealthCheck } from "./providers/chatgpt2api.ts";
import {
  generateOpenAICompat,
  ProviderError,
  type ProviderConfig as OpenAICompatProviderConfig,
} from "./providers/openai-compat.ts";
import { ReplicateProvider } from "./providers/replicate.ts";
import { KlingProvider } from "./providers/kling.ts";
import { processVideo } from "./providers/hf-video.ts";
import { uploadToTelegram } from "./telegram.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || Deno.env.get("DENO_SECRET") || "";
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000; // Start with 1s, exponential backoff
const FAL_API_KEY = Deno.env.get("FAL_API_KEY") || "";
const CHATGPT2API_KEY = Deno.env.get("CHATGPT2API_KEY") || "";

function runTaskInBackground(task: TaskRequest): void {
  executeTask(task).catch((error) => {
    console.error(
      `[trace] relay.task.unhandled taskId=${task.taskId} userId=${task.userId || ""}`,
      error
    );
  });
}

interface ProviderAttempt {
  providerId: string;
  status: "success" | "failed";
  latencyMs: number;
  errorMessage?: string;
}

/**
 * Wire protocol the worker requests for this provider. Worker writes the
 * value; relay must dispatch accordingly. Unknown values are coerced to
 * `openai-compat` (the original protocol added in 0016).
 */
type ProviderProtocol = "openai-compat" | "chatgpt2api-async";

interface ProviderConfig extends OpenAICompatProviderConfig {
  protocol: ProviderProtocol;
}

interface TaskRequest {
  taskId: string;
  userId?: string;
  projectId?: string;
  canvasId?: string | null;
  nodeId?: string;
  type: "txt2img" | "img2img" | "img2video";
  params: Record<string, unknown>;
  callbackUrl: string;
  /**
   * Worker-pushed provider list (priority-ordered). Present only when at
   * least one active row exists in `image_provider`. Empty / undefined falls
   * back to the legacy code path.
   */
  providers?: ProviderConfig[];
}

let useMockMode = false;
let useChatgpt2api = false;
const replicateProvider = new ReplicateProvider();
const klingProvider = new KlingProvider();

function getFirstImageUrl(params: Record<string, unknown>): string {
  const directUrl = params.image_url ?? params.imageUrl;
  if (typeof directUrl === "string" && directUrl.trim()) return directUrl.trim();

  const referenceImages = params.referenceImages;
  if (Array.isArray(referenceImages)) {
    const first = referenceImages.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : "";
  }

  return "";
}

function getReferenceImageUrls(params: Record<string, unknown>): string[] {
  const referenceImages = params.referenceImages;
  if (!Array.isArray(referenceImages)) {
    const first = getFirstImageUrl(params);
    return first ? [first] : [];
  }

  return [...new Set(
    referenceImages
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  )].slice(0, 14);
}

// Initialize before accepting tasks so provider selection cannot race requests.
async function initialize() {
  console.log(`🚀 Deno Relay running on port ${PORT}`);

  // Prefer chatgpt2api if configured
  if (CHATGPT2API_KEY) {
    const isHealthy = await chatgpt2apiHealthCheck();
    if (isHealthy) {
      console.log("✅ ChatGPT2API is reachable");
    } else {
      console.warn("⚠️  ChatGPT2API health check failed; will still use ChatGPT2API for task dispatch.");
    }
    useChatgpt2api = true;
    return;
  }

  if (!FAL_API_KEY) {
    console.warn(
      "⚠️  No image API configured. Running in MOCK MODE."
    );
    console.warn(
      "   Set CHATGPT2API_KEY or FAL_API_KEY in environment."
    );
    useMockMode = true;
  } else {
    // Check if FAL API is reachable
    const isHealthy = await falHealthCheck();
    if (isHealthy) {
      console.log("✅ FAL.ai API is reachable");
    } else {
      console.warn(
        "⚠️  FAL.ai API health check failed. Falling back to MOCK MODE."
      );
      useMockMode = true;
    }
  }
}

await initialize();

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      service: "deno-relay",
      mode: useMockMode ? "mock" : "production",
      fal_configured: !!FAL_API_KEY,
    });
  }

  if (url.pathname === "/tasks" && req.method === "POST") {
    const task: TaskRequest = await req.json();
    const prompt = typeof task.params.prompt === "string" ? task.params.prompt : "";
    console.log(
      `[trace] relay.task.received taskId=${task.taskId} userId=${task.userId || ""} projectId=${task.projectId || ""} canvasId=${task.canvasId || ""} nodeId=${task.nodeId || ""} type=${task.type} promptLength=${prompt.length} imageUrl=${getFirstImageUrl(task.params)} callbackUrl=${task.callbackUrl} providerCount=${task.providers?.length || 0}`
    );

    runTaskInBackground(task);

    return Response.json({ accepted: true }, { status: 202 });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
});

async function executeTask(task: TaskRequest) {
  try {
    let resultUrl: string;
    let resultUrls: string[] = [];
    let metadata: Record<string, unknown> = {};

    switch (task.type) {
      case "txt2img": {
        // Multi-provider failover takes precedence when worker pushed an
        // active provider list. Falls through to the legacy provider
        // selection below if `providers` is empty.
        if (Array.isArray(task.providers) && task.providers.length > 0) {
          await runMultiProviderTxt2Img(task, task.providers);
          return;
        }

        if (useChatgpt2api) {
          // Use ChatGPT2API (configured via CHATGPT2API_BASE_URL)
          const result = await generateImages({
            prompt: (task.params.prompt as string) || "",
            n: task.params.n as number,
            size: task.params.size as string,
            image_resolution: task.params.image_resolution as string,
            quality: task.params.quality as string,
            output_format: task.params.output_format as string,
            model: task.params.model as string,
            trace: {
              taskId: task.taskId,
              userId: task.userId,
            },
          });
          resultUrls = result.urls;
          resultUrl = resultUrls[0];
          metadata = result.metadata;
        } else if (useMockMode) {
          // Mock mode: use placeholder
          const result = await mockTxt2img({
            prompt: (task.params.prompt as string) || "",
          });
          const width = task.params.width || 1024;
          const height = task.params.height || 1024;
          const text = encodeURIComponent(
            ((task.params.prompt as string) || "Image").slice(0, 30)
          );
          resultUrl = `https://placehold.co/${width}x${height}/png?text=${text}`;
          resultUrls = [resultUrl];
          metadata = result.metadata;
        } else {
          // Real mode: use FAL API
          const result = await txt2img({
            prompt: (task.params.prompt as string) || "",
            negative_prompt: task.params.negative_prompt as string,
            width: task.params.width as number,
            height: task.params.height as number,
            steps: task.params.steps as number,
            model: task.params.model as string,
            seed: task.params.seed as number,
            guidance_scale: task.params.guidance_scale as number,
          });

          // Upload to Telegram for backup storage
          const fileId = await uploadToTelegram(
            result.data,
            result.mimeType,
            `canvas-gen-${task.taskId}.jpg`
          );

          // Use Telegram file ID as the result URL if available
          resultUrl = fileId
            ? `https://t.me/file/bd${fileId}` // Telegram file URL format (placeholder)
            : `data:${result.mimeType};base64,${
                btoa(
                  String.fromCharCode.apply(null, Array.from(result.data))
                )
              }`;
          resultUrls = [resultUrl];
          metadata = result.metadata;
        }
        break;
      }
      case "img2img": {
        if (useChatgpt2api) {
          // Use ChatGPT2API image editing
          const imageUrl = getFirstImageUrl(task.params);
          if (!imageUrl) throw new Error("No source image URL provided for img2img");
          const result = await editImage({
            prompt: (task.params.prompt as string) || "",
            image_url: imageUrl,
            image_urls: getReferenceImageUrls(task.params),
            n: task.params.n as number,
            size: task.params.size as string,
            image_resolution: task.params.image_resolution as string,
            quality: task.params.quality as string,
            output_format: task.params.output_format as string,
            model: task.params.model as string,
            trace: {
              taskId: task.taskId,
              userId: task.userId,
            },
          });
          resultUrls = result.urls;
          resultUrl = resultUrls[0];
          metadata = result.metadata;
        } else {
          // Use Replicate provider (mock mode if no API key)
          const imageUrl = getFirstImageUrl(task.params);
          const img2imgResult = await replicateProvider.img2img({
            prompt: (task.params.prompt as string) || "",
            image_url: imageUrl,
            width: task.params.width as number,
            height: task.params.height as number,
            steps: task.params.steps as number,
            strength: task.params.strength as number,
            model: task.params.model as string,
          });

          // Upload result
          const img2imgFileId = await uploadToTelegram(
            img2imgResult.data,
            img2imgResult.mimeType,
            `canvas-img2img-${task.taskId}.png`
          );

          resultUrl = img2imgFileId
            ? `https://t.me/file/bd${img2imgFileId}`
            : `https://placehold.co/1024x1024/png?text=img2img`;
          resultUrls = [resultUrl];
          metadata = img2imgResult.metadata;
        }
        break;
      }
      case "img2video": {
        // Use Kling provider (mock mode if no API key)
        const videoResult = await klingProvider.img2video({
          image_url: getFirstImageUrl(task.params),
          prompt: task.params.prompt as string,
          duration: task.params.duration as number,
          fps: task.params.fps as number,
          model: task.params.model as string,
        });

        // Post-process video through HF Spaces FFmpeg (pass-through in mock mode)
        const processed = await processVideo({
          inputData: videoResult.data,
          inputMimeType: videoResult.mimeType,
          outputFormat: "mp4",
          fps: (task.params.fps as number) || 24,
        });

        // Upload processed video
        const videoFileId = await uploadToTelegram(
          processed.data,
          processed.mimeType,
          `canvas-video-${task.taskId}.mp4`
        );

        resultUrl = videoFileId
          ? `https://t.me/file/bd${videoFileId}`
          : `https://placehold.co/640x480/mp4?text=video`;
        metadata = { ...videoResult.metadata, ...processed.metadata };
        break;
      }
      default:
        throw new Error(`Unsupported task type: ${task.type}`);
    }

    const assets = Array.isArray(metadata.assets) ? metadata.assets : undefined;

    // Callback to Worker with retry logic
    console.log(
      `[trace] relay.task.completed taskId=${task.taskId} userId=${task.userId || ""} status=success resultUrl=${resultUrl} resultCount=${resultUrls.length}`
    );
    await sendWebhookWithRetry(task.callbackUrl, {
      taskId: task.taskId,
      userId: task.userId,
      status: "success",
      url: resultUrl,
      urls: resultUrls,
      assets,
      fileKey: `gen-${task.taskId}`,
      metadata,
    });
  } catch (error) {
    console.error(`[trace] relay.task.failed taskId=${task.taskId} userId=${task.userId || ""}`, error);
    await sendWebhookWithRetry(task.callbackUrl, {
      taskId: task.taskId,
      userId: task.userId,
      status: "failed",
      error: (error as Error).message,
    });
  }
}

/**
 * Mock image generation for testing/demo mode
 */
async function mockTxt2img(
  params: { prompt: string }
): Promise<{
  data: Uint8Array;
  mimeType: string;
  metadata: { width: number; height: number; model: string };
}> {
  // Simulate AI generation delay (1-3 seconds)
  const delay = 1000 + Math.random() * 2000;
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Return a placeholder image
  const width = 1024;
  const height = 1024;
  const text = encodeURIComponent(params.prompt.slice(0, 30) || "Generated");
  const url = `https://placehold.co/${width}x${height}/png?text=${text}`;

  const response = await fetch(url);
  const data = new Uint8Array(await response.arrayBuffer());

  return {
    data,
    mimeType: "image/png",
    metadata: { width, height, model: "mock" },
  };
}

/**
 * Send webhook callback with exponential backoff retry logic
 */
async function sendWebhookWithRetry(
  callbackUrl: string,
  payload: Record<string, unknown>,
  attempt = 1
): Promise<void> {
  try {
    console.log(
      `[trace] relay.webhook.send taskId=${payload.taskId as string} userId=${payload.userId as string || ""} attempt=${attempt} callbackUrl=${callbackUrl} status=${payload.status as string}`
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Webhook failed with status ${res.status}: ${errorText}`);
    }

    const responseText = await res.text();
    console.log(
      `[trace] relay.webhook.success taskId=${payload.taskId as string} userId=${payload.userId as string || ""} attempt=${attempt} response=${responseText}`
    );
  } catch (error) {
    console.error(
      `[trace] relay.webhook.failed taskId=${payload.taskId as string} userId=${payload.userId as string || ""} attempt=${attempt}/${MAX_RETRIES}`,
      error
    );

    if (attempt < MAX_RETRIES) {
      const delayMs = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`[webhook] Retrying in ${delayMs}ms...`);

      // Schedule retry
      setTimeout(() => {
        sendWebhookWithRetry(callbackUrl, payload, attempt + 1).catch(
          (err) => {
            console.error(
              `[webhook] Final retry failed for task ${payload.taskId}:`,
              err
            );
            // Log to dead letter queue or monitoring service here
            logDeadLetterEvent(payload, err);
          }
        );
      }, delayMs);
    } else {
      // All retries exhausted
      console.error(`[webhook] All retries exhausted for task ${payload.taskId}`);
      logDeadLetterEvent(payload, error);
    }
  }
}

/**
 * Log failed callbacks to monitoring/dead letter system
 * This could be extended to write to a database, queue, or monitoring service
 */
function logDeadLetterEvent(
  payload: Record<string, unknown>,
  error: unknown
): void {
  console.error(`[deadletter] Task ${payload.taskId} callback failed permanently:`, {
    taskId: payload.taskId,
    error: (error as Error)?.message || String(error),
    timestamp: new Date().toISOString(),
    payload,
  });

  // TODO: Send to monitoring service (Sentry, DataDog, CloudWatch, etc.)
  // TODO: Write to persistent storage for manual review
}

/**
 * Should this provider failure roll over to the next upstream, or fail the
 * task immediately?
 *
 *   - 5xx / 408 / 429 / 401 / 403 / network / timeout → roll over
 *   - 400 with `invalid_request_error` or `content_policy_violation` →
 *     surface immediately so retries do not burn quota on something the
 *     model will never accept (Plan agent recommendation)
 */
function shouldFailOver(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return true; // network / asset upload / etc.
  if (err.status === 0 || err.status >= 500) return true;
  if ([408, 429, 401, 403].includes(err.status)) return true;
  if (err.status === 400 && /invalid_request|content_policy|safety/i.test(err.message)) {
    return false;
  }
  return false;
}

/**
 * Run text-to-image through the worker-supplied provider list with priority
 * ordering. Stops at the first success; otherwise reports the last error.
 * Always sends a webhook with `attempts` so the worker can update per-
 * provider counters atomically (and idempotently — see worker
 * recordProviderAttempts).
 */
async function runMultiProviderTxt2Img(
  task: TaskRequest,
  providers: ProviderConfig[]
): Promise<void> {
  const attempts: ProviderAttempt[] = [];
  let usedProviderId: string | undefined;
  let success: { urls: string[]; metadata: Record<string, unknown> } | null = null;
  let lastError: unknown = null;

  for (const provider of providers) {
    const t0 = Date.now();
    try {
      // Dispatch by protocol. Adding a new upstream wire format requires one
      // more case here and a matching provider protocol value in the worker.
      const protocol: ProviderProtocol =
        provider.protocol === "chatgpt2api-async" ? "chatgpt2api-async" : "openai-compat";

      let result: { urls: string[]; metadata: Record<string, unknown> };

      if (protocol === "chatgpt2api-async") {
        // Reuses the legacy chatgpt2api client by passing per-call
        // baseUrl/apiKey overrides; module-level env values stay as
        // fallbacks for the no-providers code path.
        const apiResult = await generateImages({
          prompt: (task.params.prompt as string) || "",
          n: task.params.n as number,
          size: task.params.size as string,
          image_resolution: task.params.image_resolution as string,
          quality: task.params.quality as string,
          output_format: task.params.output_format as string,
          model: task.params.model as string || provider.model,
          trace: { taskId: task.taskId, userId: task.userId },
          endpoint: { baseUrl: provider.baseUrl, apiKey: provider.apiKey },
        });
        result = {
          urls: apiResult.urls,
          metadata: { ...apiResult.metadata, providerId: provider.id, protocol },
        };
      } else {
        result = await generateOpenAICompat(provider, {
          prompt: (task.params.prompt as string) || "",
          n: task.params.n as number,
          size: task.params.size as string,
          quality: task.params.quality as string,
          output_format: task.params.output_format as string,
          model: task.params.model as string,
          trace: { taskId: task.taskId, userId: task.userId },
        });
      }

      const latencyMs = Date.now() - t0;
      attempts.push({ providerId: provider.id, status: "success", latencyMs });
      usedProviderId = provider.id;
      success = result;
      break;
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({
        providerId: provider.id,
        status: "failed",
        latencyMs,
        errorMessage: message,
      });
      lastError = err;
      console.warn(
        `[trace] relay.provider.attempt_failed taskId=${task.taskId} providerId=${provider.id} providerName=${provider.name} elapsedMs=${latencyMs} err=${message.slice(0, 200)}`
      );
      if (!shouldFailOver(err)) {
        // Final-state error — do not waste the rest of the quota on this.
        break;
      }
    }
  }

  if (success) {
    const resultUrls = success.urls;
    const resultUrl = resultUrls[0];
    const assets = Array.isArray(success.metadata.assets) ? success.metadata.assets : undefined;

    console.log(
      `[trace] relay.task.completed taskId=${task.taskId} userId=${task.userId || ""} status=success usedProviderId=${usedProviderId || ""} attempts=${attempts.length} resultCount=${resultUrls.length}`
    );

    await sendWebhookWithRetry(task.callbackUrl, {
      taskId: task.taskId,
      userId: task.userId,
      status: "success",
      url: resultUrl,
      urls: resultUrls,
      assets,
      fileKey: `gen-${task.taskId}`,
      metadata: success.metadata,
      usedProviderId,
      attempts,
    });
    return;
  }

  const errMessage = lastError instanceof Error ? lastError.message : String(lastError || "All providers failed");
  console.error(
    `[trace] relay.task.failed taskId=${task.taskId} userId=${task.userId || ""} attempts=${attempts.length} err=${errMessage.slice(0, 200)}`
  );

  await sendWebhookWithRetry(task.callbackUrl, {
    taskId: task.taskId,
    userId: task.userId,
    status: "failed",
    error: errMessage,
    // Attribute the failed task to the last attempted provider.
    usedProviderId: attempts[attempts.length - 1]?.providerId,
    attempts,
  });
}
