import { Hono } from "hono";
import { refundCreditsForTask } from "../lib/credit-deduction";
import type { Env } from "../types";

export const canvasWebhookRoutes = new Hono<{ Bindings: Env }>();

// Auto-disable a provider after this many consecutive failed attempts.
const PASSIVE_DISABLE_THRESHOLD = 5;

interface ProviderAttempt {
  providerId: string;
  status: "success" | "failed";
  latencyMs?: number | null;
  errorMessage?: string | null;
}

/**
 * Persist relay-reported provider attempts.
 *
 * The dedup table `image_provider_attempt` has PK `(taskId, providerId)`,
 * so webhook re-deliveries hit `INSERT OR IGNORE` and never double-count.
 * Counter rollups on `image_provider` only fire when a row was newly
 * inserted (`changes > 0`).
 */
async function recordProviderAttempts(
  env: Env,
  taskId: string,
  attempts: ProviderAttempt[]
): Promise<void> {
  for (const attempt of attempts) {
    if (!attempt.providerId) continue;
    const status: "success" | "failed" =
      attempt.status === "success" ? "success" : "failed";
    const latency =
      typeof attempt.latencyMs === "number" && Number.isFinite(attempt.latencyMs)
        ? Math.max(0, Math.floor(attempt.latencyMs))
        : null;
    const errorMessage = attempt.errorMessage ? String(attempt.errorMessage).slice(0, 1000) : null;

    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO "image_provider_attempt"
         ("taskId", "providerId", "status", "latencyMs", "errorMessage", "attemptedAt")
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(taskId, attempt.providerId, status, latency, errorMessage)
      .run();

    if (!inserted.meta.changes) {
      // Replay of a webhook we already counted; skip aggregate update.
      continue;
    }

    // CASE-driven atomic update: total always +1; success/failed +1 on the
    // matching branch; consecutiveFailures resets on success or auto-bumps
    // (and may flip isActive=0 once it crosses the threshold) on failure.
    // Same `status` value is bound to every CASE arm — D1 binds positionally
    // and does not collapse repeated literals.
    await env.DB.prepare(
      `UPDATE "image_provider"
         SET "totalCount" = "totalCount" + 1,
             "successCount" = "successCount" + CASE WHEN ? = 'success' THEN 1 ELSE 0 END,
             "failedCount"  = "failedCount"  + CASE WHEN ? = 'failed'  THEN 1 ELSE 0 END,
             "consecutiveFailures" = CASE
               WHEN ? = 'success' THEN 0
               ELSE "consecutiveFailures" + 1
             END,
             "isActive" = CASE
               WHEN ? = 'failed' AND "consecutiveFailures" + 1 >= ? THEN 0
               ELSE "isActive"
             END,
             "lastUsedAt" = datetime('now'),
             "lastError"   = CASE WHEN ? = 'failed' THEN ? ELSE "lastError" END,
             "lastErrorAt" = CASE WHEN ? = 'failed' THEN datetime('now') ELSE "lastErrorAt" END,
             "updatedAt" = datetime('now')
       WHERE "id" = ?`
    )
      .bind(
        status,
        status,
        status,
        status,
        PASSIVE_DISABLE_THRESHOLD,
        status,
        errorMessage,
        status,
        attempt.providerId
      )
      .run();
  }
}

// POST /api/canvas/webhooks/task-complete — Deno relay callback
canvasWebhookRoutes.post("/task-complete", async (c) => {
  // Verify secret
  const secret = c.req.header("x-webhook-secret");
  if (c.env.DENO_SECRET && secret !== c.env.DENO_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{
    taskId: string;
    status: "success" | "failed";
    fileKey?: string;
    url?: string;
    urls?: string[];
    assets?: unknown[];
    metadata?: Record<string, unknown>;
    error?: string;
    /** Provider that ultimately served (or last attempted) this task. */
    usedProviderId?: string;
    /** Per-attempt log used for dedup-safe counter rollups. */
    attempts?: ProviderAttempt[];
  }>();

  if (!body.taskId || !body.status) {
    return c.json({ error: "Missing taskId or status" }, 400);
  }

  const task = await c.env.DB.prepare(
    `SELECT "userId", "taskType", "projectId", "canvasId", "nodeId" FROM "canvas_task" WHERE id = ?`
  )
    .bind(body.taskId)
    .first<{
      userId: string;
      taskType: string;
      projectId: string;
      canvasId?: string | null;
      nodeId: string;
    }>();

  console.log(
    `[trace] worker.webhook.received taskId=${body.taskId} userId=${task?.userId || ""} projectId=${task?.projectId || ""} canvasId=${task?.canvasId || ""} nodeId=${task?.nodeId || ""} type=${task?.taskType || ""} status=${body.status} usedProviderId=${body.usedProviderId || ""} attemptCount=${body.attempts?.length || 0}`
  );

  // Roll up per-provider counters (idempotent vs webhook re-delivery).
  if (Array.isArray(body.attempts) && body.attempts.length > 0) {
    try {
      await recordProviderAttempts(c.env, body.taskId, body.attempts);
    } catch (err) {
      // Counter accounting must never block the task callback path.
      console.error(
        `[trace] worker.webhook.attempts_failed taskId=${body.taskId} err=${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (body.status === "success") {
    const outputData = JSON.stringify({
      url: body.url,
      urls: body.urls || (body.url ? [body.url] : []),
      assets: body.assets || [],
      fileKey: body.fileKey,
      metadata: body.metadata,
    });

    // Conditional flip:
    //  - pending/running → success (normal happy path)
    //  - cancelled       → keep status='cancelled' but still record outputData
    //                      so the user finds the image in their history
    //  - success/failed  → no-op (webhook re-delivery)
    // Upstream success never refunds — money was spent.
    const result = await c.env.DB.prepare(
      `UPDATE "canvas_task"
         SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'success' END,
             "outputData" = ?,
             "providerId" = COALESCE(?, "providerId"),
             "completedAt" = datetime('now')
       WHERE id = ? AND status IN ('pending', 'running', 'cancelled')`
    )
      .bind(outputData, body.usedProviderId || null, body.taskId)
      .run();

    // Read back the row to learn the final status (cancelled vs success);
    // KV must mirror D1 to avoid the SSE client seeing a "resurrected"
    // success after a cancel.
    const finalRow = await c.env.DB.prepare(
      `SELECT status FROM "canvas_task" WHERE id = ?`
    )
      .bind(body.taskId)
      .first<{ status: string }>();
    const finalStatus = finalRow?.status || "success";

    console.log(
      `[trace] worker.webhook.applied taskId=${body.taskId} userId=${task?.userId || ""} upstreamStatus=success finalStatus=${finalStatus} rows=${result.meta.changes} refunded=false`
    );

    await c.env.KV.put(
      `task:${body.taskId}`,
      JSON.stringify({ status: finalStatus, outputData: JSON.parse(outputData) }),
      { expirationTtl: 300 }
    );
  } else {
    // Conditional flip:
    //  - pending/running → failed
    //  - cancelled       → keep status='cancelled' but record errorMessage
    //  - success/failed  → no-op (webhook re-delivery)
    // Upstream failure always triggers refund — refundCreditsForTask is
    // idempotent (see migration 0018 + lib/credit-deduction.ts), so it is
    // safe to call regardless of prior cancel-side state.
    const result = await c.env.DB.prepare(
      `UPDATE "canvas_task"
         SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
             "errorMessage" = ?,
             "providerId" = COALESCE(?, "providerId"),
             "completedAt" = datetime('now')
       WHERE id = ? AND status IN ('pending', 'running', 'cancelled')`
    )
      .bind(body.error || "Unknown error", body.usedProviderId || null, body.taskId)
      .run();

    let refundOutcome: "applied" | "already" | "skipped" = "skipped";
    if (task && (result.meta.changes ?? 0) > 0) {
      const refund = await refundCreditsForTask(
        c.env,
        task.userId,
        task.taskType,
        body.taskId
      );
      refundOutcome = refund.alreadyApplied ? "already" : refund.success ? "applied" : "skipped";
    }

    const finalRow = await c.env.DB.prepare(
      `SELECT status FROM "canvas_task" WHERE id = ?`
    )
      .bind(body.taskId)
      .first<{ status: string }>();
    const finalStatus = finalRow?.status || "failed";

    console.warn(
      `[security] worker.task.failed taskId=${body.taskId} userId=${task?.userId || ""} type=${task?.taskType || ""} error=${JSON.stringify(body.error || "Unknown error")}`
    );
    console.log(
      `[trace] worker.webhook.applied taskId=${body.taskId} userId=${task?.userId || ""} upstreamStatus=failed finalStatus=${finalStatus} rows=${result.meta.changes} refunded=${refundOutcome}`
    );

    await c.env.KV.put(
      `task:${body.taskId}`,
      JSON.stringify({ status: finalStatus, errorMessage: body.error }),
      { expirationTtl: 300 }
    );
  }

  return c.json({ success: true });
});
