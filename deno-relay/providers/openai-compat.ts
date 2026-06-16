/**
 * OpenAI-compatible synchronous image generation provider.
 *
 * Targets endpoints that implement `POST /v1/images/generations` with the
 * stock OpenAI response shape: `{ data: [{ b64_json }] }`. Used by the
 * multi-provider failover path.
 *
 * Differences vs the existing chatgpt2api provider:
 *   - Synchronous (single HTTP roundtrip), no client_task_id / poll loop.
 *   - Per-provider config is passed in (baseUrl/apiKey/model/defaults)
 *     rather than read from process env, so the relay stays stateless.
 *   - `b64_json` payload is rehosted via the asset service so the
 *     downstream worker / web app sees public URLs identical to the
 *     legacy code path.
 */

const ASSET_SERVICE_URL = Deno.env.get("ASSET_SERVICE_URL") || "";
const ASSET_SERVICE_API_KEY = Deno.env.get("ASSET_SERVICE_API_KEY") || "";

const DEFAULT_TIMEOUT_MS = 90_000;

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultSize: string;
  defaultQuality: string;
}

export interface OpenAICompatParams {
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  output_format?: string;
  /** Override the per-provider default model. */
  model?: string;
  trace?: { taskId?: string; userId?: string };
}

export interface OpenAICompatResult {
  urls: string[];
  metadata: Record<string, unknown>;
}

interface AssetUploadResult {
  url: string;
  asset?: unknown;
}

/**
 * Carries the upstream HTTP status alongside the message so the dispatcher
 * can decide whether to fail over (5xx, 408, 429) or fail fast (400 with
 * `invalid_request` / `content_policy_violation`).
 */
export class ProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : base + "/").toString();
}

function formatTrace(trace?: OpenAICompatParams["trace"]): string {
  if (!trace?.taskId && !trace?.userId) return "";
  return ` appTaskId=${trace.taskId || ""} userId=${trace.userId || ""}`;
}

/**
 * Run one upstream call. Throws ProviderError on transport failure or
 * non-2xx response; ordinary Error on local issues (asset service not
 * configured, malformed JSON, etc.). The dispatcher decides whether to
 * fail over based on the thrown error.
 */
export async function generateOpenAICompat(
  provider: ProviderConfig,
  params: OpenAICompatParams
): Promise<OpenAICompatResult> {
  if (!ASSET_SERVICE_URL || !ASSET_SERVICE_API_KEY) {
    throw new Error(
      "Asset service not configured: set ASSET_SERVICE_URL and ASSET_SERVICE_API_KEY"
    );
  }

  const url = joinUrl(provider.baseUrl, "v1/images/generations");
  const trace = formatTrace(params.trace);

  const body = {
    model: params.model || provider.model,
    prompt: params.prompt,
    n: params.n || 1,
    size: params.size || provider.defaultSize,
    quality: params.quality || provider.defaultQuality,
    // gpt-image-2 ignores `format` for some providers — kept for compat
    // with the reference test (test/e2e-gpt-image-2.ts).
    format: params.output_format || "png",
  };

  console.log(
    `[openai-compat] → providerId=${provider.id} providerName=${provider.name} url=${url} model=${body.model} size=${body.size}${trace}`
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  const t0 = Date.now();
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    // AbortError → upstream timed out at DEFAULT_TIMEOUT_MS
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new ProviderError(
      isTimeout ? 408 : 0,
      isTimeout ? `Upstream timed out after ${DEFAULT_TIMEOUT_MS}ms` : `Network error: ${reason}`
    );
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(
      `[openai-compat] ✗ providerId=${provider.id} status=${res.status} elapsedMs=${elapsedMs} detail=${errText.slice(0, 300)}${trace}`
    );
    throw new ProviderError(
      res.status,
      `HTTP ${res.status}: ${errText.slice(0, 300) || res.statusText}`
    );
  }

  const json = await res.json().catch(() => null) as
    | { data?: Array<{ b64_json?: string; url?: string }>; usage?: unknown }
    | null;
  if (!json || !Array.isArray(json.data) || json.data.length === 0) {
    throw new ProviderError(res.status, "Upstream returned no image data");
  }

  // Rehost every returned image. Failures here are local errors (asset
  // service down) — they should not trigger failover since the upstream
  // already produced an image.
  const uploads = await rehostImages(provider, params.trace?.taskId, json.data);
  const urls = uploads.map((upload) => upload.url);
  const assets = uploads.map((upload) => upload.asset).filter((asset) => asset !== undefined);

  console.log(
    `[openai-compat] ✓ providerId=${provider.id} elapsedMs=${elapsedMs} imageCount=${urls.length}${trace}`
  );

  return {
    urls,
    metadata: {
      provider: provider.name,
      providerId: provider.id,
      model: body.model,
      count: urls.length,
      elapsedMs,
      usage: json.usage,
      assets,
    },
  };
}

/**
 * Upload each generated image (b64 or URL) to the asset service and return
 * the public URLs. Mirrors the strict-fail behavior of
 * chatgpt2api.ts:reuploadImages — any failure here aborts the call.
 */
async function rehostImages(
  provider: ProviderConfig,
  taskId: string | undefined,
  data: Array<{ b64_json?: string; url?: string }>
): Promise<AssetUploadResult[]> {
  const uploadUrl = `${ASSET_SERVICE_URL.replace(/\/+$/, "")}/api/assets/upload`;
  const tag = taskId ? `[task:${taskId}]` : "";
  const uploads: AssetUploadResult[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    let blob: Blob;
    let filename: string;

    if (item.b64_json) {
      const buf = base64ToBytes(item.b64_json);
      // Allocate a fresh ArrayBuffer (never SharedArrayBuffer) so the typed
      // array's `.buffer` is unambiguously a BlobPart in modern Deno typings.
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      blob = new Blob([ab], { type: "image/png" });
      filename = `gpt-image-${Date.now()}-${i}.png`;
    } else if (item.url) {
      const res = await fetch(item.url, {
        headers: { Authorization: `Bearer ${provider.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(
          `${tag} download fallback URL failed status=${res.status} url=${item.url}`
        );
      }
      blob = await res.blob();
      filename = item.url.split("/").pop() || `gpt-image-${Date.now()}-${i}.png`;
    } else {
      throw new Error(`${tag} response item has neither b64_json nor url`);
    }

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
      const detail = await uploadRes.text().catch(() => "");
      throw new Error(
        `${tag} asset upload failed status=${uploadRes.status} detail=${detail.slice(0, 300)}`
      );
    }

    const uploadData = await uploadRes.json() as {
      asset?: { url?: string; asset_details?: { url?: string } };
      url?: string;
    };
    const publicUrl =
      uploadData.asset?.url || uploadData.asset?.asset_details?.url || uploadData.url;
    if (!publicUrl) {
      throw new Error(`${tag} asset upload succeeded but no public URL in response`);
    }

    uploads.push({ url: publicUrl, asset: uploadData.asset });
  }

  return uploads;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
