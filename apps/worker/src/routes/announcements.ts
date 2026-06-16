import { Hono } from "hono";
import type { Announcement, AnnouncementLevel } from "@shared/types";
import type { Env } from "../types";
import { toIsoUtc } from "../lib/datetime";

// --- Announcement system ---
// Public route: read currently-active announcements (web banner).

export const announcementRoutes = new Hono<{ Bindings: Env }>();

const VALID_LEVELS: AnnouncementLevel[] = ["info", "success", "warning", "critical"];

interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  level: string;
  isActive: number;
  isDismissible: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeLevel(value: unknown): AnnouncementLevel {
  return VALID_LEVELS.includes(value as AnnouncementLevel)
    ? (value as AnnouncementLevel)
    : "info";
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    level: normalizeLevel(row.level),
    isActive: row.isActive === 1,
    isDismissible: row.isDismissible === 1,
    startsAt: toIsoUtc(row.startsAt),
    endsAt: toIsoUtc(row.endsAt),
    createdAt: toIsoUtc(row.createdAt),
    updatedAt: toIsoUtc(row.updatedAt),
  };
}

// GET /api/announcements — active announcements within their display window.
// GET /api/announcements?history=1 — recent announcements (incl. dismissed /
// ended / disabled) for the user-facing "announcement center" entry. Only
// future-scheduled drafts (startsAt > now) are hidden.
announcementRoutes.get("/", async (c) => {
  const history = c.req.query("history") === "1" || c.req.query("history") === "true";

  if (history) {
    const result = await c.env.DB.prepare(
      `SELECT * FROM "announcement"
       WHERE "startsAt" IS NULL OR "startsAt" <= datetime('now')
       ORDER BY "createdAt" DESC
       LIMIT 30`
    ).all<AnnouncementRow>();

    return c.json({ announcements: (result.results || []).map(toAnnouncement) });
  }

  const result = await c.env.DB.prepare(
    `SELECT * FROM "announcement"
     WHERE "isActive" = 1
       AND ("startsAt" IS NULL OR "startsAt" <= datetime('now'))
       AND ("endsAt" IS NULL OR "endsAt" >= datetime('now'))
     ORDER BY
       CASE "level"
         WHEN 'critical' THEN 0
         WHEN 'warning' THEN 1
         WHEN 'success' THEN 2
         ELSE 3
       END ASC,
       "createdAt" DESC`
  ).all<AnnouncementRow>();

  const announcements = (result.results || []).map(toAnnouncement);
  return c.json({ announcements });
});
