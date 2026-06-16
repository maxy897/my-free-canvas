import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { canvasTaskRoutes } from "../routes/canvas-tasks";
import type { Env } from "../types";

// Mock implementations
function createMockDB() {
  const tasks: Map<string, Record<string, unknown>> = new Map();

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
          if (this._sql.includes('FROM "canvas_task"')) {
            const taskId = this._bindings[0] as string;
            const task = tasks.get(taskId);
            return task as T | null;
          }
          return null;
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

describe("Canvas Tasks SSE Streaming", () => {
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

  describe("GET /api/canvas/tasks/:id/stream", () => {
    it("returns 404 for nonexistent task", async () => {
      const res = await makeRequest("/api/canvas/tasks/nonexistent/stream");
      expect(res.status).toBe(404);
    });

    it("prevents access to other user's tasks", async () => {
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

      const res = await makeRequest(
        `/api/canvas/tasks/${taskId}/stream`,
        {},
        "test-user-2"
      );
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Access denied");
    });

    it("allows task owner to access stream", async () => {
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
                outputData: JSON.stringify({ url: "https://example.com/image.jpg" }),
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      const res = await makeRequest(`/api/canvas/tasks/${taskId}/stream`);
      // Note: streamText may not work properly in test, but it should at least not be 403
      expect(res.status).not.toBe(403);
    });

    it("returns 404 when task doesn't exist on initial load", async () => {
      const res = await makeRequest("/api/canvas/tasks/nonexistent/stream");
      expect(res.status).toBe(404);
    });

    it("prevents non-owners from accessing stream", async () => {
      const taskId = "task-user1";
      const originalPrepare = mockDB.prepare.bind(mockDB);
      (mockDB as any).prepare = function(sql: string) {
        if (sql.includes('FROM "canvas_task"')) {
          return {
            bind: () => ({
              first: async () => ({
                id: taskId,
                userId: "test-user-1",
                status: "pending",
              }),
            }),
          };
        }
        return originalPrepare(sql);
      };

      // Try to access as user-2
      const res = await makeRequest(
        `/api/canvas/tasks/${taskId}/stream`,
        {},
        "test-user-2"
      );
      expect(res.status).toBe(403);
    });
  });
});
