import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { canvasRoutes } from "../routes/canvas";
import type { Env } from "../types";

interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CanvasRow {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  flowData: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// Minimal D1 mock using in-memory Maps
function createMockDB(): D1Database {
  const projects = new Map<string, ProjectRow>();
  const canvases = new Map<string, CanvasRow>();

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
            const id = this._bindings[0] as string;
            const userId = this._bindings[1] as string;
            const row = projects.get(id);
            if (!row || row.userId !== userId) return null;
            return row as T;
          }

          if (this._sql.includes('FROM "canvas"')) {
            const id = this._bindings[0] as string;
            const projectId = this._bindings[1] as string;
            const userId = this._bindings[2] as string;
            const row = canvases.get(id);
            if (!row || row.projectId !== projectId || row.userId !== userId) return null;
            return row as T;
          }

          return null;
        },
        async all() {
          if (this._sql.includes('FROM "canvas_project"')) {
            const userId = this._bindings[0] as string;
            return { results: [...projects.values()].filter((row) => row.userId === userId) };
          }

          if (this._sql.includes('FROM "canvas"')) {
            const projectId = this._bindings[0] as string;
            const userId = this._bindings[1] as string;
            return {
              results: [...canvases.values()].filter(
                (row) => row.projectId === projectId && row.userId === userId
              ),
            };
          }

          return { results: [] };
        },
        async run() {
          if (this._sql.includes('INSERT INTO "canvas_project"')) {
            const [id, userId, name, thumbnailUrl] = this._bindings as [string, string, string, string | null];
            projects.set(id, {
              id,
              userId,
              name,
              thumbnailUrl,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } else if (this._sql.includes('INSERT INTO "canvas"')) {
            const [id, projectId, userId, name, flowData, thumbnailUrl] = this._bindings as [
              string,
              string,
              string,
              string,
              string,
              string | null,
            ];
            canvases.set(id, {
              id,
              projectId,
              userId,
              name,
              flowData,
              thumbnailUrl,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } else if (this._sql.includes('UPDATE "canvas_project"')) {
            const bindings = this._bindings;
            const id = bindings[bindings.length - 2] as string;
            const userId = bindings[bindings.length - 1] as string;
            const row = projects.get(id);
            if (row && row.userId === userId) {
              let index = 0;
              if (this._sql.includes("name = ?")) row.name = bindings[index++] as string;
              if (this._sql.includes('"thumbnailUrl" = ?')) row.thumbnailUrl = bindings[index++] as string | null;
              row.updatedAt = new Date().toISOString();
            }
          } else if (this._sql.includes('UPDATE "canvas"')) {
            const bindings = this._bindings;
            const id = bindings[bindings.length - 3] as string;
            const projectId = bindings[bindings.length - 2] as string;
            const userId = bindings[bindings.length - 1] as string;
            const row = canvases.get(id);
            if (row && row.projectId === projectId && row.userId === userId) {
              let index = 0;
              if (this._sql.includes("name = ?")) row.name = bindings[index++] as string;
              if (this._sql.includes('"flowData" = ?')) row.flowData = bindings[index++] as string;
              if (this._sql.includes('"thumbnailUrl" = ?')) row.thumbnailUrl = bindings[index++] as string | null;
              row.updatedAt = new Date().toISOString();
            }
          } else if (this._sql.includes('DELETE FROM "canvas_project"')) {
            const id = this._bindings[0] as string;
            const userId = this._bindings[1] as string;
            const row = projects.get(id);
            if (row && row.userId === userId) {
              projects.delete(id);
              for (const [canvasId, canvas] of canvases) {
                if (canvas.projectId === id) canvases.delete(canvasId);
              }
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          } else if (this._sql.includes('DELETE FROM "canvas"')) {
            const [id, projectId, userId] = this._bindings as [string, string, string];
            const row = canvases.get(id);
            if (row && row.projectId === projectId && row.userId === userId) {
              canvases.delete(id);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }

          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as D1Database;
}

function createTestApp(): Hono<{ Bindings: Env; Variables: { userId: string } }> {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

  // Inject test userId middleware
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user-id") || "test-user-1");
    await next();
  });

  app.route("/api/canvas", canvasRoutes);
  return app;
}

describe("Canvas Projects API", () => {
  let app: ReturnType<typeof createTestApp>;
  let mockDB: D1Database;

  beforeEach(() => {
    app = createTestApp();
    mockDB = createMockDB();
  });

  function makeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    return app.request(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "test-user-1",
        ...(options.headers || {}),
      },
    }, { DB: mockDB, ENVIRONMENT: "test" } as unknown as Env);
  }

  async function createProject(name = "Test Project"): Promise<{ id: string; name: string }> {
    const res = await makeRequest("/api/canvas/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return (await res.json()) as { id: string; name: string };
  }

  it("POST /api/canvas/projects — creates a project", async () => {
    const res = await makeRequest("/api/canvas/projects", {
      method: "POST",
      body: JSON.stringify({ name: "My Project" }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("My Project");
    expect(data.id).toBeTruthy();
    expect(data.flowData).toBeUndefined();
  });

  it("uses Beijing-time default names and compact ids", async () => {
    const projectRes = await makeRequest("/api/canvas/projects", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(projectRes.status).toBe(201);
    const project = await projectRes.json();
    expect(project.id).toMatch(/^[0-9a-f]{16}$/);
    expect(project.name).toMatch(/^\d{8}_\d{6}_项目$/);

    const canvasRes = await makeRequest(`/api/canvas/projects/${project.id}/canvases`, {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    expect(canvasRes.status).toBe(201);
    const canvas = await canvasRes.json();
    expect(canvas.id).toMatch(/^[0-9a-f]{16}$/);
    expect(canvas.name).toMatch(/^\d{8}_\d{6}_画布$/);
  });

  it("GET /api/canvas/projects — lists projects", async () => {
    await createProject("Test");

    const res = await makeRequest("/api/canvas/projects");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projects.length).toBe(1);
  });

  it("GET /api/canvas/projects/:id — returns project metadata", async () => {
    const { id } = await createProject("Detail Test");

    const res = await makeRequest(`/api/canvas/projects/${id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Detail Test");
    expect(data.flowData).toBeUndefined();
  });

  it("PUT /api/canvas/projects/:id — updates project metadata", async () => {
    const { id } = await createProject("Update Test");

    const res = await makeRequest(`/api/canvas/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Updated", thumbnailUrl: "data:image/svg+xml,test" }),
    });
    expect(res.status).toBe(200);

    const getRes = await makeRequest(`/api/canvas/projects/${id}`);
    const data = await getRes.json();
    expect(data.name).toBe("Updated");
    expect(data.thumbnailUrl).toBe("data:image/svg+xml,test");
  });

  it("DELETE /api/canvas/projects/:id — deletes project", async () => {
    const { id } = await createProject("Delete Me");

    const res = await makeRequest(`/api/canvas/projects/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const getRes = await makeRequest(`/api/canvas/projects/${id}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for another user's project", async () => {
    const { id } = await createProject("Private");

    const res = await app.request(`/api/canvas/projects/${id}`, {
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "test-user-2",
      },
    }, { DB: mockDB, ENVIRONMENT: "test" } as unknown as Env);
    expect(res.status).toBe(404);
  });

  it("supports CRUD for canvases under a project", async () => {
    const { id: projectId } = await createProject("Project With Canvases");
    const flowData = { nodes: [{ id: "n1" }], edges: [], viewport: { x: 10, y: 20, zoom: 2 } };

    const createCanvasRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases`, {
      method: "POST",
      body: JSON.stringify({ name: "Main Canvas", flowData }),
    });
    expect(createCanvasRes.status).toBe(201);
    const canvas = await createCanvasRes.json();
    expect(canvas.projectId).toBe(projectId);
    expect(canvas.flowData).toEqual(flowData);

    const listRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.canvases).toHaveLength(1);

    const updatedFlowData = { nodes: [{ id: "n2" }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const updateRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`, {
      method: "PUT",
      body: JSON.stringify({ flowData: updatedFlowData, thumbnailUrl: "data:image/svg+xml,thumb" }),
    });
    expect(updateRes.status).toBe(200);

    const getRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`);
    const updated = await getRes.json();
    expect(updated.flowData).toEqual(updatedFlowData);
    expect(updated.thumbnailUrl).toBe("data:image/svg+xml,thumb");

    const deleteRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const goneRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`);
    expect(goneRes.status).toBe(404);
  });

  it("returns 404 for another user's canvas", async () => {
    const { id: projectId } = await createProject("Private Project");
    const createCanvasRes = await makeRequest(`/api/canvas/projects/${projectId}/canvases`, {
      method: "POST",
      body: JSON.stringify({ name: "Private Canvas" }),
    });
    const canvas = await createCanvasRes.json();

    const res = await app.request(`/api/canvas/projects/${projectId}/canvases/${canvas.id}`, {
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "test-user-2",
      },
    }, { DB: mockDB, ENVIRONMENT: "test" } as unknown as Env);
    expect(res.status).toBe(404);
  });
});
