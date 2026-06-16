import { Hono } from "hono";
import type { PromptTemplate } from "@shared/types";
import type { Env } from "../types";
import { toIsoUtc } from "../lib/datetime";

// --- Built-in prompt template library (read-only) ---

export const promptTemplateRoutes = new Hono<{ Bindings: Env }>();

interface PromptTemplateRow {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string | null;
  coverUrl: string | null;
  needsReference: number;
  sortOrder: number;
  createdAt: string;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function toPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    tags: parseTags(row.tags),
    coverUrl: row.coverUrl,
    needsReference: row.needsReference === 1,
    sortOrder: row.sortOrder,
    createdAt: toIsoUtc(row.createdAt),
  };
}

// GET /api/prompt-templates — list built-in templates (optionally filter by category / keyword)
promptTemplateRoutes.get("/", async (c) => {
  const category = c.req.query("category")?.trim();
  const q = c.req.query("q")?.trim();

  const where: string[] = [];
  const binds: unknown[] = [];

  if (category) {
    where.push(`"category" = ?`);
    binds.push(category);
  }
  if (q) {
    where.push(`("title" LIKE ? OR "content" LIKE ? OR "tags" LIKE ?)`);
    const like = `%${q}%`;
    binds.push(like, like, like);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await c.env.DB.prepare(
    `SELECT * FROM "prompt_template" ${whereClause} ORDER BY "sortOrder" ASC, "createdAt" ASC`
  )
    .bind(...binds)
    .all<PromptTemplateRow>();

  const templates = (result.results || []).map(toPromptTemplate);

  const categories = Array.from(
    new Set(templates.map((t) => t.category).filter((cat): cat is string => Boolean(cat)))
  );

  return c.json({ templates, categories });
});
