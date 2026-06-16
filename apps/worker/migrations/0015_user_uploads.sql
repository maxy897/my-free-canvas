-- Migration 0015: User uploads through external asset service
-- Records user uploads from POST /api/canvas/files/upload, which proxies
-- to the external asset service configured via ASSET_SERVICE_URL.
--
-- canvas_file is reserved for the legacy R2/Telegram storage path and is
-- semantically distinct (r2Key/telegramFileId/hash). user_upload tracks
-- assets that live on the external asset service so user-facing tooling can
-- list user-contributed material.

CREATE TABLE IF NOT EXISTS "user_upload" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "assetServiceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "downloadUrl" TEXT,
    "title" TEXT,
    "mimeType" TEXT,
    "type" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "projectId" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "idx_user_upload_userId_createdAt"
    ON "user_upload"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_user_upload_assetServiceId"
    ON "user_upload"("assetServiceId");
