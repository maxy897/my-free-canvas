-- Migration 0003: Canvas Projects, Canvases & Tasks
-- Tables: canvas_project, canvas, canvas_task, canvas_file

CREATE TABLE "canvas_project" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL DEFAULT 'Untitled',
    "thumbnailUrl" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX "idx_canvas_project_userId" ON "canvas_project"("userId", "updatedAt" DESC);

CREATE TABLE "canvas" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "canvas_project"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL DEFAULT 'Untitled Canvas',
    "flowData" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}',
    "thumbnailUrl" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX "idx_canvas_projectId" ON "canvas"("projectId", "updatedAt" DESC);
CREATE INDEX "idx_canvas_userId" ON "canvas"("userId", "updatedAt" DESC);

CREATE TABLE "canvas_task" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "canvas_project"("id") ON DELETE CASCADE,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputParams" TEXT NOT NULL,
    "outputData" TEXT,
    "errorMessage" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "completedAt" TEXT
);

CREATE INDEX "idx_canvas_task_projectId" ON "canvas_task"("projectId", "createdAt" DESC);
CREATE INDEX "idx_canvas_task_status" ON "canvas_task"("status") WHERE "status" IN ('pending', 'running');

CREATE TABLE "canvas_file" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "telegramFileId" TEXT,
    "r2Key" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX "idx_canvas_file_r2Key" ON "canvas_file"("r2Key");
