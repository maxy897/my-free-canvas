import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";
import { toIsoUtc } from "../lib/datetime";

function normalizeTimestamps<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    ...(row.createdAt !== undefined ? { createdAt: toIsoUtc(row.createdAt as string | null) } : {}),
    ...(row.updatedAt !== undefined ? { updatedAt: toIsoUtc(row.updatedAt as string | null) } : {}),
  };
}

const DEFAULT_FLOW_DATA: CanvasFlowData = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
const ID_BYTES = 8;
const STANDALONE_GENERATION_PROJECT_PREFIX = "standalone-generation-";

type CanvasRouteEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

interface CanvasFlowData {
  nodes: unknown[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
}

interface ProjectMetadata {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const canvasRoutes = new Hono<CanvasRouteEnv>();

canvasRoutes.use("*", authMiddleware);

function createCompactId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createDefaultName(suffix: "项目" | "画布", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  function partValue(type: Intl.DateTimeFormatPartTypes): string {
    return parts.find((part) => part.type === type)?.value || "";
  }

  return `${partValue("year")}${partValue("month")}${partValue("day")}_${partValue("hour")}${partValue("minute")}${partValue("second")}_${suffix}`;
}

function resolveName(name: string | undefined, suffix: "项目" | "画布"): string {
  const trimmed = name?.trim();
  return trimmed || createDefaultName(suffix);
}

async function findProject(c: Context<CanvasRouteEnv>, projectId: string): Promise<ProjectMetadata | null> {
  return c.env.DB.prepare(
    `SELECT id, name, "thumbnailUrl", "createdAt", "updatedAt"
     FROM "canvas_project" WHERE id = ? AND "userId" = ?`
  )
    .bind(projectId, c.get("userId"))
    .first<ProjectMetadata>();
}

function parseFlowData(value: unknown): unknown {
  if (typeof value !== "string") return DEFAULT_FLOW_DATA;
  try {
    return JSON.parse(value);
  } catch {
    return DEFAULT_FLOW_DATA;
  }
}

// GET /api/canvas/projects — list user's projects
canvasRoutes.get("/projects", async (c) => {
  const userId = c.get("userId");

  const result = await c.env.DB.prepare(
    `SELECT id, name, "thumbnailUrl", "createdAt", "updatedAt"
     FROM "canvas_project"
     WHERE "userId" = ? AND id NOT LIKE ?
     ORDER BY "updatedAt" DESC`
  )
    .bind(userId, `${STANDALONE_GENERATION_PROJECT_PREFIX}%`)
    .all<Record<string, unknown>>();

  return c.json({ projects: (result.results || []).map(normalizeTimestamps) });
});

// POST /api/canvas/projects — create a new project
canvasRoutes.post("/projects", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string; thumbnailUrl?: string | null }>();
  const id = createCompactId();
  const name = resolveName(body.name, "项目");
  const thumbnailUrl = body.thumbnailUrl ?? null;

  await c.env.DB.prepare(
    `INSERT INTO "canvas_project" (id, "userId", name, "thumbnailUrl") VALUES (?, ?, ?, ?)`
  )
    .bind(id, userId, name, thumbnailUrl)
    .run();

  return c.json({ id, name, thumbnailUrl }, 201);
});

// GET /api/canvas/projects/:projectId/canvases — list canvases in a project
canvasRoutes.get("/projects/:projectId/canvases", async (c) => {
  const projectId = c.req.param("projectId");
  const project = await findProject(c, projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = await c.env.DB.prepare(
    `SELECT id, "projectId", name, "thumbnailUrl", "createdAt", "updatedAt"
     FROM "canvas"
     WHERE "projectId" = ? AND "userId" = ?
     ORDER BY "updatedAt" DESC`
  )
    .bind(projectId, c.get("userId"))
    .all<Record<string, unknown>>();

  return c.json({ canvases: (result.results || []).map(normalizeTimestamps) });
});

// POST /api/canvas/projects/:projectId/canvases — create a canvas in a project
canvasRoutes.post("/projects/:projectId/canvases", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const project = await findProject(c, projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const body = await c.req.json<{ name?: string; flowData?: unknown; thumbnailUrl?: string | null }>();
  const id = createCompactId();
  const name = resolveName(body.name, "画布");
  const flowData = body.flowData ?? DEFAULT_FLOW_DATA;
  const thumbnailUrl = body.thumbnailUrl ?? null;

  await c.env.DB.prepare(
    `INSERT INTO "canvas" (id, "projectId", "userId", name, "flowData", "thumbnailUrl")
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, projectId, userId, name, JSON.stringify(flowData), thumbnailUrl)
    .run();

  return c.json({ id, projectId, name, flowData, thumbnailUrl }, 201);
});

// GET /api/canvas/projects/:projectId/canvases/:canvasId — get canvas flow data
canvasRoutes.get("/projects/:projectId/canvases/:canvasId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const canvasId = c.req.param("canvasId");

  const canvas = await c.env.DB.prepare(
    `SELECT * FROM "canvas" WHERE id = ? AND "projectId" = ? AND "userId" = ?`
  )
    .bind(canvasId, projectId, userId)
    .first<Record<string, unknown>>();

  if (!canvas) return c.json({ error: "Canvas not found" }, 404);

  return c.json({ ...normalizeTimestamps(canvas), flowData: parseFlowData(canvas.flowData) });
});

// PUT /api/canvas/projects/:projectId/canvases/:canvasId — save canvas flow data
canvasRoutes.put("/projects/:projectId/canvases/:canvasId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const canvasId = c.req.param("canvasId");
  const body = await c.req.json<{ name?: string; flowData?: unknown; thumbnailUrl?: string | null }>();

  const existing = await c.env.DB.prepare(
    `SELECT id FROM "canvas" WHERE id = ? AND "projectId" = ? AND "userId" = ?`
  )
    .bind(canvasId, projectId, userId)
    .first();

  if (!existing) return c.json({ error: "Canvas not found" }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push(`name = ?`);
    values.push(body.name);
  }
  if (body.flowData !== undefined) {
    updates.push(`"flowData" = ?`);
    values.push(JSON.stringify(body.flowData));
  }
  if (body.thumbnailUrl !== undefined) {
    updates.push(`"thumbnailUrl" = ?`);
    values.push(body.thumbnailUrl);
  }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  updates.push(`"updatedAt" = datetime('now')`);
  values.push(canvasId, projectId, userId);

  await c.env.DB.prepare(
    `UPDATE "canvas" SET ${updates.join(", ")} WHERE id = ? AND "projectId" = ? AND "userId" = ?`
  )
    .bind(...values)
    .run();

  return c.json({ success: true });
});

// DELETE /api/canvas/projects/:projectId/canvases/:canvasId — delete a canvas
canvasRoutes.delete("/projects/:projectId/canvases/:canvasId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const canvasId = c.req.param("canvasId");

  const result = await c.env.DB.prepare(
    `DELETE FROM "canvas" WHERE id = ? AND "projectId" = ? AND "userId" = ?`
  )
    .bind(canvasId, projectId, userId)
    .run();

  if (!result.meta.changes) return c.json({ error: "Canvas not found" }, 404);

  return c.json({ success: true });
});

// GET /api/canvas/projects/:projectId — get project metadata
canvasRoutes.get("/projects/:projectId", async (c) => {
  const project = await findProject(c, c.req.param("projectId"));
  if (!project) return c.json({ error: "Project not found" }, 404);

  return c.json(project);
});

// PUT /api/canvas/projects/:projectId — update project metadata
canvasRoutes.put("/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ name?: string; thumbnailUrl?: string | null }>();

  const existing = await findProject(c, projectId);
  if (!existing) return c.json({ error: "Project not found" }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push(`name = ?`);
    values.push(body.name);
  }
  if (body.thumbnailUrl !== undefined) {
    updates.push(`"thumbnailUrl" = ?`);
    values.push(body.thumbnailUrl);
  }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  updates.push(`"updatedAt" = datetime('now')`);
  values.push(projectId, c.get("userId"));

  await c.env.DB.prepare(
    `UPDATE "canvas_project" SET ${updates.join(", ")} WHERE id = ? AND "userId" = ?`
  )
    .bind(...values)
    .run();

  return c.json({ success: true });
});

// DELETE /api/canvas/projects/:projectId — delete project and its canvases
canvasRoutes.delete("/projects/:projectId", async (c) => {
  const result = await c.env.DB.prepare(
    `DELETE FROM "canvas_project" WHERE id = ? AND "userId" = ?`
  )
    .bind(c.req.param("projectId"), c.get("userId"))
    .run();

  if (!result.meta.changes) return c.json({ error: "Project not found" }, 404);

  return c.json({ success: true });
});
