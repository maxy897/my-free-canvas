-- Migration 0016: Image generation upstream providers
-- Stores multiple OpenAI-compatible image generation upstreams and
-- per-provider call counts. Multi-provider failover is driven by
-- `priority` (lower runs first) and `isActive` (passive disable after
-- consecutive failures).

CREATE TABLE IF NOT EXISTS "image_provider" (
    "id"                    TEXT PRIMARY KEY,
    "name"                  TEXT NOT NULL,
    "baseUrl"               TEXT NOT NULL,
    "apiKey"                TEXT NOT NULL,
    "model"                 TEXT NOT NULL DEFAULT 'gpt-image-2',
    "defaultSize"           TEXT NOT NULL DEFAULT '1024x1024',
    "defaultQuality"        TEXT NOT NULL DEFAULT 'medium',
    -- Lower priority dispatched first; tie-breaker by createdAt.
    "priority"              INTEGER NOT NULL DEFAULT 100,
    "isActive"              INTEGER NOT NULL DEFAULT 1,
    -- Auto-disabled at >= 5 consecutive failures.
    "consecutiveFailures"   INTEGER NOT NULL DEFAULT 0,
    "totalCount"            INTEGER NOT NULL DEFAULT 0,
    "successCount"          INTEGER NOT NULL DEFAULT 0,
    "failedCount"           INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt"            TEXT,
    "lastError"             TEXT,
    "lastErrorAt"           TEXT,
    "createdAt"             TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt"             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "idx_image_provider_active_priority"
    ON "image_provider"("isActive", "priority");

-- One row per (taskId, providerId). Webhook re-deliveries hit the PK
-- conflict and `INSERT OR IGNORE` keeps counters honest.
CREATE TABLE IF NOT EXISTS "image_provider_attempt" (
    "taskId"        TEXT NOT NULL,
    "providerId"    TEXT NOT NULL,
    "status"        TEXT NOT NULL,
    "latencyMs"     INTEGER,
    "errorMessage"  TEXT,
    "attemptedAt"   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY ("taskId", "providerId")
);

CREATE INDEX IF NOT EXISTS "idx_image_provider_attempt_provider"
    ON "image_provider_attempt"("providerId", "attemptedAt" DESC);

-- Tag each canvas_task with the provider that ultimately served it.
-- Nullable: legacy tasks pre-dating this feature, plus tasks dispatched
-- when no provider is configured (fallback to legacy code path).
ALTER TABLE "canvas_task" ADD COLUMN "providerId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_canvas_task_provider_created"
    ON "canvas_task"("providerId", "createdAt" DESC);
