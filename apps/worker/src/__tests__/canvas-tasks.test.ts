import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { canvasTaskRoutes } from "../routes/canvas-tasks";
import type { Env } from "../types";

// Mock implementations
function createMockDB() {
  const tasks: Map<string, Record<string, unknown>> = new Map();
  const projects: Map<string, Record<string, unknown>> = new Map();
  const credits: Map<string, Record<string, unknown>> = new Map();

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
          if (this._sql.includes('COUNT(*)') && this._sql.includes('FROM "canvas_task"')) {
            const userId = this._bindings[0] as string;
            const count = Array.from(tasks.values()).filter((task) => task.userId === userId).length;
            return { count } as T;
          }
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
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          if (this._sql.includes('FROM "canvas_task"')) {
            const userId = this._bindings[0] as string;
            const limit = this._bindings[this._bindings.length - 2] as number;
            const offset = this._bindings[this._bindings.length - 1] as number;
            const results = Array.from(tasks.values())
              .filter((task) => task.userId === userId)
              .slice(offset, offset + limit) as T[];
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (this._sql.includes("INSERT INTO \"canvas_task\"")) {
            const taskId = this._bindings[0] as string;
            const projectId = this._bindings[1] as string;
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
              createdAt: new Date().toISOString(),
            });
          } else if (this._sql.includes("INSERT INTO \"credit_transaction\"")) {
            // Record transaction
          } else if (this._sql.includes("UPDATE \"user_credits\"")) {
            const userId = this._bindings[this._bindings.length - 1] as string;
            const creditRecord = credits.get(userId);
            if (creditRecord) {
              if (this._sql.includes("balance = balance -")) {
                const cost = this._bindings[0] as number;
                creditRecord.balance = (creditRecord.balance as number) - cost;
              }
            }
          } else if (this._sql.includes("UPDATE \"canvas_task\"")) {
            const taskId = this._bindings[this._bindings.length - 1] as string;
            const task = tasks.get(taskId);
            if (task) {
              if (this._sql.includes("status = 'cancelled'")) {
                task.status = "cancelled";
              } else if (this._sql.includes("status = 'success'")) {
                task.status = "success";
                task.outputData = this._bindings[0] as string;
                task.completedAt = new Date().toISOString();
              } else if (this._sql.includes("status = 'failed'")) {
                task.status = "failed";
                task.errorMessage = this._bindings[0] as string;
              }
            }
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
  return app;
}

describe("Canvas Tasks API", () => {
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
    userId = "test-user-1"
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
    } as unknown as Env);
  };

  describe("POST /api/canvas/tasks", () => {
    it("returns 400 when missing required fields", async () => {
      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing required");
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
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("creates task with valid project and sufficient credits", async () => {
      const projectId = "proj-1";
      
      // Mock the DB to have this project and credits
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('FROM "canvas_project"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: projectId,
                userId: "test-user-1",
              }),
            }),
          };
        }
        if (sql.includes('FROM "user_credits"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: "credits-1",
                userId: "test-user-1",
                balance: 100,
                free_balance: 50,
                purchased_balance: 50,
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      const res = await makeRequest("/api/canvas/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          nodeId: "node-1",
          taskType: "txt2img",
          inputParams: { prompt: "beautiful sunset" },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.taskId).toBeTruthy();
      expect(data.status).toBe("pending");
      expect(data.creditsDeducted).toBe(10);
    });
  });

  describe("GET /api/canvas/tasks", () => {
    it("lists task history with prompt, params, results, and timestamps", async () => {
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('COUNT(*)') && sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              first: async () => ({ count: 1 }),
            }),
          };
        }
        if (sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              all: async () => ({
                results: [
                  {
                    id: "task-1",
                    projectId: "proj-1",
                    canvasId: "canvas-1",
                    nodeId: "node-1",
                    taskType: "txt2img",
                    status: "success",
                    inputParams: JSON.stringify({ prompt: "beautiful sunset", size: "1:1" }),
                    outputData: JSON.stringify({
                      url: "https://example.com/result.png",
                      urls: ["https://example.com/result.png"],
                      assets: [{ id: "asset-1" }],
                    }),
                    createdAt: "2026-05-27T06:00:00.000Z",
                    completedAt: "2026-05-27T06:01:00.000Z",
                  },
                ],
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      const historyRes = await makeRequest("/api/canvas/tasks?projectId=proj-1&canvasId=canvas-1");
      expect(historyRes.status).toBe(200);
      const data = await historyRes.json();
      expect(data.total).toBe(1);
      expect(data.items[0]).toMatchObject({
        id: "task-1",
        projectId: "proj-1",
        canvasId: "canvas-1",
        prompt: "beautiful sunset",
        inputParams: { prompt: "beautiful sunset", size: "1:1" },
        outputUrls: ["https://example.com/result.png"],
        createdAt: "2026-05-27T06:00:00.000Z",
        completedAt: "2026-05-27T06:01:00.000Z",
      });
    });
  });

  describe("GET /api/canvas/tasks/:id", () => {
    it("returns 404 for nonexistent task", async () => {
      const res = await makeRequest("/api/canvas/tasks/nonexistent");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("prevents access to other user's tasks", async () => {
      // Create a task for user-1
      const taskId = "task-1";
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: taskId,
                userId: "test-user-1",
                status: "running",
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      // Try to access as user-2
      const res = await makeRequest(`/api/canvas/tasks/${taskId}`, {}, "test-user-2");
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied");
    });

    it("returns task status for owner", async () => {
      const taskId = "task-1";
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: taskId,
                userId: "test-user-1",
                status: "success",
                outputData: JSON.stringify({ url: "https://..." }),
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      const res = await makeRequest(`/api/canvas/tasks/${taskId}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("success");
      expect(data.outputData).toBeDefined();
    });
  });

  describe("POST /api/canvas/tasks/:id/cancel", () => {
    it("returns 404 for nonexistent task", async () => {
      const res = await makeRequest("/api/canvas/tasks/nonexistent/cancel", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("prevents cancelling other user's tasks", async () => {
      const taskId = "task-1";
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: taskId,
                userId: "test-user-1",
                taskType: "txt2img",
                status: "pending",
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      const res = await makeRequest(
        `/api/canvas/tasks/${taskId}/cancel`,
        { method: "POST" },
        "test-user-2"
      );
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied");
    });
  });
});
