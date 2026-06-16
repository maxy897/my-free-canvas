-- Migration 0007: Associate generation tasks with a canvas document

ALTER TABLE "canvas_task" ADD COLUMN "canvasId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_canvas_task_user_created"
  ON "canvas_task"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "idx_canvas_task_canvas_created"
  ON "canvas_task"("canvasId", "createdAt" DESC);
