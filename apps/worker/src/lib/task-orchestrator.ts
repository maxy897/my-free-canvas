import type { Env } from "../types";

export interface TaskRequest {
  taskId: string;
  userId: string;
  projectId: string;
  canvasId?: string | null;
  nodeId: string;
  type: "txt2img" | "img2img" | "img2video";
  params: Record<string, unknown>;
  callbackUrl: string;
}

/**
 * Subset of `image_provider` columns shipped to the relay so it can run
 * failover without an extra round-trip back to the worker. Secrets travel
 * over the existing TLS channel; the relay is forbidden from logging
 * `apiKey`.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultSize: string;
  defaultQuality: string;
  /** Wire protocol the relay must use. See deno-relay/main.ts for the
   *  dispatch matrix. Unknown values are coerced to `openai-compat`. */
  protocol: "openai-compat" | "chatgpt2api-async";
}

interface ProviderRow extends ProviderConfig {
  priority: number;
}

/**
 * Read every active provider in priority order. Empty array → no providers
 * configured, fall back to the legacy code path inside the relay.
 */
async function loadActiveProviders(env: Env): Promise<ProviderConfig[]> {
  try {
    const result = await env.DB.prepare(
      `SELECT "id", "name", "baseUrl", "apiKey", "model",
              "defaultSize", "defaultQuality", "protocol", "priority"
         FROM "image_provider"
        WHERE "isActive" = 1
        ORDER BY "priority" ASC, "createdAt" ASC`
    ).all<ProviderRow>();
    return (result.results || []).map(({ priority: _priority, protocol, ...config }) => ({
      ...config,
      protocol: protocol === "chatgpt2api-async" ? "chatgpt2api-async" : "openai-compat",
    }));
  } catch (err) {
    // Migration not yet applied (e.g. fresh local DB) — degrade gracefully.
    console.warn(
      `[trace] worker.providers.load_failed err=${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Dispatch a task to the Deno relay.
 * If DENO_RELAY_URL is not configured, runs a local mock (returns test image after 2s delay).
 */
export async function dispatchTask(env: Env, req: TaskRequest): Promise<void> {
  await env.DB.prepare(
    `UPDATE "canvas_task" SET status = 'running' WHERE id = ? AND status = 'pending'`
  )
    .bind(req.taskId)
    .run();

  // Update KV to running
  await env.KV.put(
    `task:${req.taskId}`,
    JSON.stringify({ status: "running", taskType: req.type }),
    { expirationTtl: 3600 }
  );

  if (env.DENO_RELAY_URL) {
    // Only txt2img currently has a multi-upstream code path in the relay.
    // For other types we still ship `providers: []` to keep the wire
    // format stable.
    const providers = req.type === "txt2img" ? await loadActiveProviders(env) : [];

    console.log(
      `[trace] worker.task.dispatch taskId=${req.taskId} userId=${req.userId} projectId=${req.projectId} canvasId=${req.canvasId || ""} nodeId=${req.nodeId} type=${req.type} relayUrl=${env.DENO_RELAY_URL} providerCount=${providers.length}`
    );

    // Real dispatch to Deno relay
    const res = await fetch(`${env.DENO_RELAY_URL}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": env.DENO_SECRET || "",
      },
      body: JSON.stringify({ ...req, providers }),
    });

    const responseText = await res.text();
    let responseBody: { accepted?: boolean } | null = null;
    try {
      responseBody = JSON.parse(responseText) as { accepted?: boolean };
    } catch {
      // Non-JSON usually means the configured URL is not the Deno relay.
    }

    if (!res.ok || responseBody?.accepted !== true) {
      throw new Error(
        `Relay dispatch failed (${res.status}): ${responseText.slice(0, 200)}`
      );
    }
  } else {
    console.log(
      `[trace] worker.task.dispatch taskId=${req.taskId} userId=${req.userId} projectId=${req.projectId} canvasId=${req.canvasId || ""} nodeId=${req.nodeId} type=${req.type} relayUrl=mock`
    );

    // Mock mode: complete directly so local development does not depend on
    // background timers or self-callback networking.
    const outputData = {
      url: "https://placehold.co/1024x1024/png?text=Generated+Image",
      urls: ["https://placehold.co/1024x1024/png?text=Generated+Image"],
      fileKey: `mock-${req.taskId}`,
      metadata: { width: 1024, height: 1024, model: "mock" },
    };

    // Mirror the webhook handler's cancel-aware semantics so local mock
    // mode does not "resurrect" cancelled tasks back to success — see
    // routes/canvas-webhooks.ts for the production path.
    await env.DB.prepare(
      `UPDATE "canvas_task"
         SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'success' END,
             "outputData" = ?,
             "completedAt" = datetime('now')
       WHERE id = ? AND status IN ('pending', 'running', 'cancelled')`
    )
      .bind(JSON.stringify(outputData), req.taskId)
      .run();

    const finalRow = await env.DB.prepare(
      `SELECT status FROM "canvas_task" WHERE id = ?`
    )
      .bind(req.taskId)
      .first<{ status: string }>();
    const finalStatus = finalRow?.status || "success";

    await env.KV.put(
      `task:${req.taskId}`,
      JSON.stringify({ status: finalStatus, outputData }),
      { expirationTtl: 300 }
    );
  }
}
