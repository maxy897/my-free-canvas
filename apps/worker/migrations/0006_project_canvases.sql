-- Migration 0006: Split canvas documents from projects

CREATE TABLE IF NOT EXISTS "canvas" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "canvas_project"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL DEFAULT 'Untitled Canvas',
    "flowData" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}',
    "thumbnailUrl" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "idx_canvas_projectId" ON "canvas"("projectId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_canvas_userId" ON "canvas"("userId", "updatedAt" DESC);
