import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { dispatchTask } from "../lib/task-orchestrator";
import { deductCreditsForTask, checkAvailableCredits, refundCreditsForTask } from "../lib/credit-deduction";
import { getOrCreateUserCredits } from "../lib/credits";
import { getTaskCost } from "../lib/task-costs";
import type { Env } from "../types";
import { getCanvasTaskOutputUrls } from "@shared/types";
import { toIsoUtc } from "../lib/datetime";

export const canvasTaskRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

canvasTaskRoutes.use("*", authMiddleware);

interface CanvasTaskListRow {
  id: string;
  projectId: string;
  canvasId?: string | null;
  nodeId: string;
  taskType: string;
  status: string;
  inputParams: string;
  outputData?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toHistoryItem(row: CanvasTaskListRow) {
  const inputParams = parseJsonRecord(row.inputParams);
  const outputData = parseJsonRecord(row.outputData);
  const prompt = typeof inputParams.prompt === "string" ? inputParams.prompt : "";

  return {
    id: row.id,
    projectId: row.projectId,
    canvasId: row.canvasId ?? null,
    nodeId: row.nodeId,
    taskType: row.taskType,
    status: row.status,
    prompt,
    inputParams,
    outputData,
    outputUrls: getCanvasTaskOutputUrls(outputData),
    assets: Array.isArray(outputData.assets) ? outputData.assets : [],
    errorMessage: row.errorMessage ?? null,
    createdAt: toIsoUtc(row.createdAt),
    completedAt: toIsoUtc(row.completedAt ?? null),
  };
}

function createTaskCallbackUrl(env: Env, requestUrl: string): string {
  const baseUrl = env.CANVAS_WEBHOOK_BASE_URL || new URL(requestUrl).origin;
  return `${baseUrl}/api/canvas/webhooks/task-complete`;
}

function getStandaloneTaskProjectId(userId: string): string {
  return `standalone-generation-${userId}`;
}

async function getOrCreateStandaloneTaskProject(env: Env, userId: string): Promise<string> {
  const projectId = getStandaloneTaskProjectId(userId);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO "canvas_project" (id, "userId", name)
     VALUES (?, ?, ?)`
  )
    .bind(projectId, userId, "图片生成工作台")
    .run();
  return projectId;
}

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
}

function getFirstImageUrl(params: Record<string, unknown>): string | null {
  const directUrl = params.image_url ?? params.imageUrl;
  if (typeof directUrl === "string" && directUrl.trim()) return directUrl.trim();

  const referenceImages = params.referenceImages;
  if (Array.isArray(referenceImages)) {
    const first = referenceImages.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first.trim() : null;
  }

  return null;
}

// GET /api/canvas/tasks — list current user's generation history/gallery
canvasTaskRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const url = new URL(c.req.url);
  const projectIdParam = url.searchParams.get("projectId");
  const projectId = projectIdParam === "local" ? getStandaloneTaskProjectId(userId) : projectIdParam;
  const canvasId = url.searchParams.get("canvasId");
  const status = url.searchParams.get("status");
  const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 100);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 10_000);

  const conditions = [`"userId" = ?`];
  const values: unknown[] = [userId];

  if (projectId) {
    conditions.push(`"projectId" = ?`);
    values.push(projectId);
  }
  if (canvasId) {
    conditions.push(`"canvasId" = ?`);
    values.push(canvasId);
  }
  if (status) {
    conditions.push(`status = ?`);
    values.push(status);
  }

  const whereClause = conditions.join(" AND ");
  const rows = await c.env.DB.prepare(
    `SELECT id, "projectId", "canvasId", "nodeId", "taskType", status, "inputParams",
            "outputData", "errorMessage", "createdAt", "completedAt"
     FROM "canvas_task"
     WHERE ${whereClause}
     ORDER BY "createdAt" DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...values, limit, offset)
    .all<CanvasTaskListRow>();

  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM "canvas_task" WHERE ${whereClause}`
  )
    .bind(...values)
    .first<{ count: number }>();

  return c.json({
    items: (rows.results || []).map(toHistoryItem),
    total: total?.count || 0,
    limit,
    offset,
  });
});

// POST /api/canvas/tasks — submit an AI task
canvasTaskRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    projectId: string;
    canvasId?: string | null;
    nodeId: string;
    taskType: string;
    inputParams: Record<string, unknown>;
  }>();

  if (!body.projectId || !body.nodeId || !body.taskType || !body.inputParams) {
    console.warn(`[security] worker.task.invalid_request userId=${userId} reason=missing_required_fields`);
    return c.json({ error: "Missing required fields" }, 400);
  }

  const sourceImageUrl = getFirstImageUrl(body.inputParams);
  const prompt = typeof body.inputParams.prompt === "string" ? body.inputParams.prompt : "";
  console.log(
    `[trace] worker.task.submit userId=${userId} projectId=${body.projectId} canvasId=${body.canvasId || ""} nodeId=${body.nodeId} type=${body.taskType} promptLength=${prompt.length} imageUrl=${sourceImageUrl || ""} ip=${getClientIp(c)}`
  );

  const effectiveProjectId = body.projectId === "local"
    ? await getOrCreateStandaloneTaskProject(c.env, userId)
    : body.projectId;

  // Verify project ownership. Local/standalone submissions are first mapped
  // to a real per-user project so canvas_task.projectId satisfies its FK.
  if (body.projectId !== "local") {
    const project = await c.env.DB.prepare(
      `SELECT id FROM "canvas_project" WHERE id = ? AND "userId" = ?`
    )
      .bind(effectiveProjectId, userId)
      .first();

    if (!project) {
      console.warn(
        `[security] worker.task.project_denied userId=${userId} projectId=${effectiveProjectId} type=${body.taskType}`
      );
      return c.json({ error: "Project not found or access denied" }, 404);
    }

    if (body.canvasId) {
      const canvas = await c.env.DB.prepare(
        `SELECT id FROM "canvas" WHERE id = ? AND "projectId" = ? AND "userId" = ?`
      )
        .bind(body.canvasId, effectiveProjectId, userId)
        .first();

      if (!canvas) {
        console.warn(
          `[security] worker.task.canvas_denied userId=${userId} projectId=${effectiveProjectId} canvasId=${body.canvasId} type=${body.taskType}`
        );
        return c.json({ error: "Canvas not found or access denied" }, 404);
      }
    }
  }

  // Check if user has enough credits
  const taskCost = getTaskCost(body.taskType);
  await getOrCreateUserCredits(c.env, userId);
  const creditCheck = await checkAvailableCredits(c.env, userId, body.taskType);

  if (!creditCheck.canAfford) {
    console.warn(
      `[trace] worker.task.insufficient_credits userId=${userId} type=${body.taskType} required=${taskCost} available=${creditCheck.available}`
    );
    return c.json(
      {
        error: "Insufficient credits",
        required: taskCost,
        available: creditCheck.available,
      },
      402 // Payment Required
    );
  }

  const taskId = crypto.randomUUID();

  // Attempt to deduct credits
  const deductionResult = await deductCreditsForTask(
    c.env,
    userId,
    body.taskType,
    taskId
  );

  if (!deductionResult.success) {
    return c.json(
      {
        error: deductionResult.error || "Failed to process credit deduction",
      },
      500
    );
  }

  // Write to D1
  await c.env.DB.prepare(
    `INSERT INTO "canvas_task" (id, "projectId", "canvasId", "nodeId", "userId", "taskType", "status", "inputParams")
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(
      taskId,
      effectiveProjectId,
      body.canvasId || null,
      body.nodeId,
      userId,
      body.taskType,
      JSON.stringify(body.inputParams)
    )
    .run();

  // Write to KV for fast polling
  await c.env.KV.put(
    `task:${taskId}`,
    JSON.stringify({ status: "pending", taskType: body.taskType }),
    { expirationTtl: 3600 }
  );

  const taskType = body.taskType as "txt2img" | "img2img" | "img2video";
  const callbackUrl = createTaskCallbackUrl(c.env, c.req.url);

  // Dispatch in the background so the client can receive taskId immediately
  // and start polling while the relay runs the long image generation flow.
  const dispatchPromise = (async () => {
    try {
      const dispatchRequest = {
        taskId,
        userId,
        projectId: effectiveProjectId,
        canvasId: body.canvasId || null,
        nodeId: body.nodeId,
        type: taskType,
        params: body.inputParams,
        callbackUrl,
      };

      await dispatchTask(c.env, dispatchRequest);
    } catch (error) {
      console.error(`[trace] worker.task.dispatch_failed taskId=${taskId} userId=${userId} type=${body.taskType}`, error);
      await refundCreditsForTask(c.env, userId, body.taskType, taskId);
      await c.env.DB.prepare(
        `UPDATE "canvas_task" SET status = 'failed', "errorMessage" = 'Failed to dispatch task' WHERE id = ?`
      )
        .bind(taskId)
        .run();

      await c.env.KV.put(
        `task:${taskId}`,
        JSON.stringify({ status: "failed", errorMessage: "Failed to dispatch task" }),
        { expirationTtl: 300 }
      );
    }
  })();

  try {
    c.executionCtx.waitUntil(dispatchPromise);
  } catch {
    // Unit tests and non-Workers runtimes do not provide ExecutionContext.
    dispatchPromise.catch((error) => {
      console.error("Unhandled dispatch task error:", error);
    });
  }

  return c.json(
    {
      taskId,
      status: "pending",
      creditsDeducted: deductionResult.creditsDeducted,
      transactionId: deductionResult.transactionId,
    },
    201
  );
});

// GET /api/canvas/tasks/:id — poll task status
canvasTaskRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const taskId = c.req.param("id");

  // Try KV first (fast)
  const kvData = await c.env.KV.get(`task:${taskId}`);
  if (kvData) {
    // Still need to verify ownership from DB on KV hit
    const kvParsed = JSON.parse(kvData);
    const task = await c.env.DB.prepare(
      `SELECT id, "userId" FROM "canvas_task" WHERE id = ?`
    )
      .bind(taskId)
      .first<{ id: string; userId: string }>();
    
    if (!task || task.userId !== userId) {
      return c.json({ error: "Task not found or access denied" }, 404);
    }
    
    return c.json(kvParsed);
  }

  // Fall back to D1
  const task = await c.env.DB.prepare(
    `SELECT id, "userId", status, "outputData", "errorMessage", "completedAt"
     FROM "canvas_task" WHERE id = ?`
  )
    .bind(taskId)
    .first<{ id: string; userId: string; status: string; outputData?: string; errorMessage?: string; completedAt?: string }>();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  // Verify ownership
  if (task.userId !== userId) {
    return c.json({ error: "Access denied" }, 403);
  }

  return c.json({
    status: task.status,
    outputData: task.outputData ? JSON.parse(task.outputData) : null,
    errorMessage: task.errorMessage,
  });
});

// POST /api/canvas/tasks/:id/cancel — cancel a running task
//
// Cancel is "soft": the relay has no cancel channel, so the upstream call is
// already in flight (and possibly already paid for). We only flip our own
// status to `cancelled` and let the eventual webhook decide whether to
// refund. See routes/canvas-webhooks.ts for the corresponding logic — on
// upstream success we keep status='cancelled' but still write outputData,
// so the user can find the result in their history. On upstream failure the
// webhook is what triggers the refund (idempotent via migration 0018).
canvasTaskRoutes.post("/:id/cancel", async (c) => {
  const userId = c.get("userId");
  const taskId = c.req.param("id");

  // Verify ownership first
  const task = await c.env.DB.prepare(
    `SELECT id, "userId", "taskType", status FROM "canvas_task" WHERE id = ?`
  )
    .bind(taskId)
    .first<{ id: string; userId: string; taskType: string; status: string }>();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  if (task.userId !== userId) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Conditional flip — only pending/running can be cancelled. If the webhook
  // raced us and the row is already terminal, leave it alone.
  const updateResult = await c.env.DB.prepare(
    `UPDATE "canvas_task" SET status = 'cancelled', "completedAt" = datetime('now')
     WHERE id = ? AND status IN ('pending', 'running')`
  )
    .bind(taskId)
    .run();

  const rowsChanged = updateResult.meta.changes ?? 0;
  console.log(
    `[trace] worker.task.cancel.applied taskId=${taskId} userId=${userId} rowsChanged=${rowsChanged}`
  );

  if (rowsChanged > 0) {
    // We won the race: announce cancelled to the polling/SSE clients.
    await c.env.KV.put(
      `task:${taskId}`,
      JSON.stringify({ status: "cancelled" }),
      { expirationTtl: 300 }
    );
  }
  // else: webhook arrived first; keep its KV value (success/failed) intact.

  return c.json({ success: true, alreadyTerminal: rowsChanged === 0 });
});

// GET /api/canvas/tasks/:id/stream — Server-Sent Events for real-time task updates
canvasTaskRoutes.get("/:id/stream", async (c) => {
  const userId = c.get("userId");
  const taskId = c.req.param("id");

  // Verify task ownership
  const task = await c.env.DB.prepare(
    `SELECT id, "userId" FROM "canvas_task" WHERE id = ?`
  )
    .bind(taskId)
    .first<{ id: string; userId: string }>();

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  if (task.userId !== userId) {
    return c.json({ error: "Access denied" }, 403);
  }

  const terminalStatuses = new Set(["success", "failed", "cancelled"]);
  const encoder = new TextEncoder();
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pollInterval) clearInterval(pollInterval);
        if (timeout) clearTimeout(timeout);
        controller.close();
      };

      try {
        const initialTask = await c.env.DB.prepare(
          `SELECT id, "userId", status, "outputData", "errorMessage", "completedAt"
           FROM "canvas_task" WHERE id = ?`
        )
          .bind(taskId)
          .first<{
            id: string;
            userId: string;
            status: string;
            outputData?: string;
            errorMessage?: string;
            completedAt?: string;
          }>();

        if (initialTask) {
          write(
            `data: ${JSON.stringify({
              type: "task_update",
              data: {
                id: initialTask.id,
                status: initialTask.status,
                outputData: initialTask.outputData
                  ? JSON.parse(initialTask.outputData)
                  : null,
                errorMessage: initialTask.errorMessage,
              },
            })}\n\n`
          );

          if (terminalStatuses.has(initialTask.status)) {
            write(":stream-end\n\n");
            close();
            return;
          }
        }

        let lastStatus = initialTask?.status || "pending";
        pollInterval = setInterval(async () => {
          try {
            const kvData = await c.env.KV.get(`task:${taskId}`);
            if (!kvData) return;

            const kvParsed = JSON.parse(kvData);
            if (!kvParsed.status || kvParsed.status === lastStatus) return;

            lastStatus = kvParsed.status;
            write(
              `data: ${JSON.stringify({
                type: "task_update",
                data: kvParsed,
              })}\n\n`
            );

            if (terminalStatuses.has(kvParsed.status)) {
              write(":stream-end\n\n");
              close();
            }
          } catch (error) {
            console.error("SSE poll error:", error);
            close();
          }
        }, 500);

        timeout = setTimeout(close, 60000);
      } catch (error) {
        console.error("SSE stream error:", error);
        closed = true;
        controller.error(error);
      }
    },
    cancel() {
      closed = true;
      if (pollInterval) clearInterval(pollInterval);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
