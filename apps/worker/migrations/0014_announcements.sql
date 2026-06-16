-- Migration 0014: Site-wide announcement system
-- Stores notices such as service downtime and maintenance windows.
-- that are surfaced to end users via a banner on the web app.

CREATE TABLE IF NOT EXISTS "announcement" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    -- info | success | warning | critical
    "level" TEXT NOT NULL DEFAULT 'info',
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "isDismissible" INTEGER NOT NULL DEFAULT 1,
    -- Optional ISO 8601 UTC display window. NULL means "no bound".
    "startsAt" TEXT,
    "endsAt" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "idx_announcement_active"
    ON "announcement"("isActive", "startsAt", "endsAt");
