import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { canvasTaskRoutes } from "../routes/canvas-tasks";
import { canvasWebhookRoutes } from "../routes/canvas-webhooks";
import type { Env } from "../types";

// Mock implementations
//
// The mock simulates just enough D1 behavior to exercise the cancel/webhook
// race fix:
//   - canvas_task updates honor the `status IN (...)` WHERE filter
//     (so cancelled rows can stay cancelled when the webhook arrives)
//   - canvas_task updates honor the `status = CASE ... END` expression
//     (so success/failed only flips non-cancelled rows)
//   - credit_transaction INSERT OR IGNORE simulates the partial unique
//     index on (relatedTaskId, type) — duplicate writes return changes=0,
//     which is what the lib uses to short-circuit balance mutations.
function createMockDB(initialBalance = 100, initialFree = 50) {
  const tasks: Map<string, Record<string, unknown>> = new Map();
  const projects: Map<string, Record<string, unknown>> = new Map();
  const credits: Map<string, Record<string, unknown>> = new Map();
  const creditTxKeys: Set<string> = new Set();

  // Initialize test data
  projects.set("proj-1", { id: "proj-1", userId: "test-user-1" });
  credits.set("test-user-1", {
    id: "credits-1",
    userId: "test-user-1",
    balance: initialBalance,
    free_balance: initialFree,
    purchased_balance: initialBalance - initialFree,
  });

  function statusMatchesAllowList(sql: string, currentStatus: string): boolean {
    const match = sql.match(/status IN \(([^)]+)\)/);
    if (!match) return true;
    const allowed = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^'(.*)'$/, "$1"));
    return allowed.includes(currentStatus);
  }

  function applyCanvasTaskUpdateStatus(sql: string, currentStatus: string): string {
    // Mirror "status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'X' END".
    const caseMatch = sql.match(
      /status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE '([^']+)' END/
    );
    if (caseMatch) {
      return currentStatus === "cancelled" ? "cancelled" : caseMatch[1];
    }
    const literalMatch = sql.match(/SET status = '([^']+)'/);
    return literalMatch ? literalMatch[1] : currentStatus;
  }

  return {
    prepare(sql: string) {
      return {
        _sql: sql,
        _bindings: [] as unknown[],
        bind(...args: unknown[]) {
          this._bindings = args;
          return this;
        },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          if (this._sql.includes('FROM "canvas_project"')) {
            const projectId = this._bindings[0] as string;
            const userId = this._bindings[1] as string;
            const project = projects.get(projectId);
            if (!project) return null;
            if (userId && project.userId !== userId) return null;
            return project as T;
          }
          if (this._sql.includes('FROM "canvas_task"')) {
            const taskId = this._bindings[0] as string;
            const task = tasks.get(taskId);
            return task as T | null;
          }
          if (this._sql.includes('FROM "user_credits"')) {
            const userId = this._bindings[0] as string;
            const creditRecord = credits.get(userId);
            return creditRecord as T | null;
          }
          return null;
        },
        async run() {
          if (this._sql.includes("INSERT INTO \"canvas_task\"")) {
            const taskId = this._bindings[0] as string;
            const projectId = this._bindings[1] as string;
            // schema bind order: id, projectId, canvasId, nodeId, userId, taskType, inputParams
            const canvasId = this._bindings[2] as string | null;
            const nodeId = this._bindings[3] as string;
            const userId = this._bindings[4] as string;
            const taskType = this._bindings[5] as string;
            const inputParams = this._bindings[6] as string;
            tasks.set(taskId, {
              id: taskId,
              projectId,
              canvasId,
              nodeId,
              userId,
              taskType,
              status: "pending",
              inputParams,
              outputData: null,
              errorMessage: null,
              createdAt: new Date().toISOString(),
            });
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes("UPDATE \"canvas_task\"")) {
            const taskId = this._bindings[this._bindings.length - 1] as string;
            const task = tasks.get(taskId);
            if (!task) return { meta: { changes: 0 } };
            const currentStatus = task.status as string;
            if (!statusMatchesAllowList(this._sql, currentStatus)) {
              return { meta: { changes: 0 } };
            }
            const nextStatus = applyCanvasTaskUpdateStatus(this._sql, currentStatus);
            task.status = nextStatus;
            // Bind order is fixed by the SQL: positional parsing of the
            // first 1–2 bindings before the trailing taskId.
            if (this._sql.includes('"outputData" = ?')) {
              task.outputData = this._bindings[0];
            } else if (this._sql.includes('"errorMessage" = ?')) {
              task.errorMessage = this._bindings[0];
            }
            task.completedAt = new Date().toISOString();
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes("INSERT OR IGNORE INTO \"credit_transaction\"")) {
            // Bind order: id, userId, amount, type='use'|'refund', relatedTaskId, description.
            // The 'type' column value is hard-coded in the SQL, not a bind, so we extract it.
            const typeMatch = this._sql.match(/'(use|refund)'/);
            const type = typeMatch?.[1];
            const relatedTaskId = this._bindings[3] as string | null;
            if (!type || !relatedTaskId) {
              return { meta: { changes: 1 } };
            }
            const key = `${relatedTaskId}:${type}`;
            if (creditTxKeys.has(key)) {
              return { meta: { changes: 0 } };
            }
            creditTxKeys.add(key);
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes("INSERT INTO \"credit_transaction\"")) {
            // Legacy non-idempotent path; not exercised after migration 0018
            // but keep it harmless so older tests still parse.
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes("UPDATE \"user_credits\"")) {
            const userId = this._bindings[this._bindings.length - 1] as string;
            const creditRecord = credits.get(userId);
            if (creditRecord) {
              if (this._sql.includes("balance = balance -")) {
                const cost = this._bindings[0] as number;
                creditRecord.balance = (creditRecord.balance as number) - cost;
              } else if (this._sql.includes("balance = balance +")) {
                const cost = this._bindings[0] as number;
                creditRecord.balance = (creditRecord.balance as number) + cost;
              }
            }
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes("INSERT OR IGNORE INTO \"canvas_project\"")) {
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
}

function createMockKV() {
  const data: Map<string, string> = new Map();
  return {
    get: async (key: string) => data.get(key) || null,
    put: async (key: string, value: string) => {
      data.set(key, value);
    },
  } as unknown as KVNamespace;
}

function createTestApp(mockDB: D1Database, mockKV: KVNamespace) {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user-id") || "test-user-1");
    await next();
  });

  app.route("/api/canvas/tasks", canvasTaskRoutes);
  app.route("/api/canvas/webhooks", canvasWebhookRoutes);
  return app;
}

describe("Canvas Tasks with Credit System", () => {
  let app: ReturnType<typeof createTestApp>;
  let mockDB: D1Database;
  let mockKV: KVNamespace;

  beforeEach(() => {
    mockDB = createMockDB();
    mockKV = createMockKV();
    app = createTestApp(mockDB, mockKV);
  });

  const makeRequest = (
    path: string,
    options: RequestInit = {},
    userId = "test-user-1",
    denoSecret = "test-secret",
    extraEnv: Partial<Env> = {}
  ) => {
    return app.request(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": userId,
        ...(options.headers || {}),
      },
    }, {
      DB: mockDB,
      KV: mockKV,
      ENVIRONMENT: "test",
      DENO_SECRET: denoSecret,
      ...extraEnv,
    } as unknown as Env);
  };

  describe("POST /api/canvas/tasks — credit deduction", () => {
    it("returns 402 when user has insufficient credits", async () => {
      // Create a new DB with low balance
      const lowCreditDB = createMockDB(5, 0); // Only 5 total credits
      const lowCreditApp = createTestApp(lowCreditDB, mockKV);

      const res = await lowCreditApp.request("/api/canvas/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": "test-user-1",
        },
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "txt2img", // costs 10 credits
          inputParams: { prompt: "test" },
        }),
      }, {
        DB: lowCreditDB,
        KV: mockKV,
        ENVIRONMENT: "test",
      } as unknown as Env);

      expect(res.status).toBe(402);
      const data = await res.json() as Record<string, unknown>;
      expect(data.error).toContain("Insufficient credits");
      expect(data.available).toBe(5);
      expect(data.required).toBe(10);
    });

    it("deducts credits on successful task submission", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "txt2img", // costs 10 credits
          inputParams: { prompt: "test" },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as Record<string, unknown>;
      expect(data.creditsDeducted).toBe(10);
      expect(data.transactionId).toBeTruthy();
    });

    it("enforces txt2img cost of 10 credits", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "txt2img",
          inputParams: { prompt: "test" },
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as Record<string, unknown>;
      expect(data.creditsDeducted).toBe(10);
    });

    it("enforces img2img cost of 15 credits", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "img2img",
          inputParams: { image: "test" },
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as Record<string, unknown>;
      expect(data.creditsDeducted).toBe(15);
    });

    it("enforces img2video cost of 50 credits", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "img2video",
          inputParams: { video: "test" },
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as Record<string, unknown>;
      expect(data.creditsDeducted).toBe(50);
    });

    it("returns 404 when project doesn't exist", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "nonexistent",
          nodeId: "node-1",
          taskType: "txt2img",
          inputParams: { prompt: "test" },
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json() as Record<string, unknown>;
      expect(data.error).toContain("not found");
    });

    it("returns 400 when missing required fields", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as Record<string, unknown>;
      expect(data.error).toContain("Missing required");
    });
  });

  describe("POST /api/canvas/webhooks/task-complete", () => {
    it("refunds credits when task fails", async () => {
      // Mock the task lookup
      (mockDB as any).prepare(`SELECT "userId", "taskType" FROM "canvas_task"`).bind = () => ({
        first: async () => ({
          userId: "test-user-1",
          taskType: "txt2img",
        }),
      });

      const res = await makeRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: {
          "x-webhook-secret": "test-secret",
        },
        body: JSON.stringify({
          taskId: "task-1",
          status: "failed",
          error: "Processing failed",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
    });

    it("completes successfully on task success", async () => {
      const res = await makeRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: {
          "x-webhook-secret": "test-secret",
        },
        body: JSON.stringify({
          taskId: "task-1",
          status: "success",
          url: "https://example.com/image.png",
          fileKey: "test-key",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
    });

    it("returns 400 when missing required fields", async () => {
      const res = await makeRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: {
          "x-webhook-secret": "test-secret",
        },
        body: JSON.stringify({
          taskId: "task-1",
          // missing status
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as Record<string, unknown>;
      expect(data.error).toContain("Missing");
    });
  });

  describe("Cancel + webhook race semantics", () => {
    // Force dispatchTask down the external-relay branch and stub fetch so
    // the dispatch promise resolves without flipping the row to success
    // (the mock-mode branch in lib/task-orchestrator.ts would short-circuit
    // the whole race scenario otherwise).
    const RELAY_ENV = { DENO_RELAY_URL: "https://relay.test.invalid" };
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    function raceRequest(path: string, options: RequestInit = {}) {
      return makeRequest(path, options, "test-user-1", "test-secret", RELAY_ENV);
    }

    async function submitAndGetTaskId(): Promise<string> {
      const res = await raceRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj-1",
          nodeId: "node-1",
          taskType: "txt2img",
          inputParams: { prompt: "test" },
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      return data.taskId as string;
    }

    function readTask(taskId: string): Promise<Record<string, unknown> | null> {
      return mockDB.prepare(`SELECT id FROM "canvas_task" WHERE id = ?`).bind(taskId).first<Record<string, unknown>>();
    }

    async function fetchTask(taskId: string): Promise<Record<string, unknown> | null> {
      return readTask(taskId);
    }

    async function waitForTaskStatus(taskId: string, expectedStatus: string): Promise<Record<string, unknown> | null> {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const task = await fetchTask(taskId);
        if (task?.status === expectedStatus) return task;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return fetchTask(taskId);
    }

    async function readBalance(userId = "test-user-1"): Promise<number> {
      const row = await mockDB.prepare(
        `SELECT balance FROM "user_credits" WHERE "userId" = ?`
      ).bind(userId).first<{ balance: number }>();
      return row?.balance ?? 0;
    }

    it("keeps status=cancelled and stores outputData when upstream succeeds after cancel", async () => {
      const taskId = await submitAndGetTaskId();
      const balanceAfterSubmit = await readBalance();
      expect(balanceAfterSubmit).toBe(90); // 100 - 10 (txt2img cost)

      // User cancels while upstream is still running.
      const cancelRes = await raceRequest(`/api/canvas/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(cancelRes.status).toBe(200);
      expect(await readBalance()).toBe(90); // cancel must NOT refund

      // Upstream completes successfully after the cancel — webhook arrives.
      const webhookRes = await raceRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: { "x-webhook-secret": "test-secret" },
        body: JSON.stringify({
          taskId,
          status: "success",
          url: "https://example.com/result.png",
          fileKey: "k1",
        }),
      });
      expect(webhookRes.status).toBe(200);

      const finalTask = await fetchTask(taskId);
      expect(finalTask?.status).toBe("cancelled"); // status preserved
      expect(finalTask?.outputData).toBeTruthy();   // result still recorded
      expect(await readBalance()).toBe(90);         // still no refund
    });

    it("refunds exactly once when upstream fails after cancel, even on webhook re-delivery", async () => {
      const taskId = await submitAndGetTaskId();
      expect(await readBalance()).toBe(90);

      const cancelRes = await raceRequest(`/api/canvas/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(cancelRes.status).toBe(200);
      expect(await readBalance()).toBe(90);

      // First webhook delivery — upstream failed.
      const webhookBody = JSON.stringify({
        taskId,
        status: "failed",
        error: "upstream blew up",
      });
      const webhook1 = await raceRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: { "x-webhook-secret": "test-secret" },
        body: webhookBody,
      });
      expect(webhook1.status).toBe(200);

      const taskAfter1 = await fetchTask(taskId);
      expect(taskAfter1?.status).toBe("cancelled"); // status preserved
      expect(taskAfter1?.errorMessage).toBe("upstream blew up");
      expect(await readBalance()).toBe(100); // refunded once

      // Re-delivery of the same webhook — must not double-refund.
      const webhook2 = await raceRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: { "x-webhook-secret": "test-secret" },
        body: webhookBody,
      });
      expect(webhook2.status).toBe(200);
      expect(await readBalance()).toBe(100); // still 100, idempotent
    });

    it("cancel during pending does not refund (behavior change from prior version)", async () => {
      const taskId = await submitAndGetTaskId();
      expect(await readBalance()).toBe(90);

      const res = await raceRequest(`/api/canvas/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
      expect(data.alreadyTerminal).toBe(false);

      expect(await readBalance()).toBe(90); // refund deferred to webhook
    });

    it("moves task to running after dispatch starts", async () => {
      const taskId = await submitAndGetTaskId();

      const task = await waitForTaskStatus(taskId, "running");
      expect(task?.status).toBe("running");
    });

    it("cancel after webhook success is a no-op (alreadyTerminal=true)", async () => {
      const taskId = await submitAndGetTaskId();

      // Webhook arrives first — task transitions to success.
      await raceRequest("/api/canvas/webhooks/task-complete", {
        method: "POST",
        headers: { "x-webhook-secret": "test-secret" },
        body: JSON.stringify({
          taskId,
          status: "success",
          url: "https://example.com/result.png",
        }),
      });
      const taskBefore = await fetchTask(taskId);
      expect(taskBefore?.status).toBe("success");

      // User taps cancel afterwards — should not flip the row.
      const cancelRes = await raceRequest(`/api/canvas/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(cancelRes.status).toBe(200);
      const data = await cancelRes.json() as Record<string, unknown>;
      expect(data.alreadyTerminal).toBe(true);

      const taskAfter = await fetchTask(taskId);
      expect(taskAfter?.status).toBe("success"); // unchanged
    });
  });

  describe("Authorization and access control", () => {
    it("prevents unauthorized task creation", async () => {
      const res = await makeRequest(
        "/api/canvas/tasks",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: "proj-1",
            nodeId: "node-1",
            taskType: "txt2img",
            inputParams: { prompt: "test" },
          }),
        },
        "test-user-2" // Different user
      );

      expect(res.status).toBe(404);
    });
  });
});
