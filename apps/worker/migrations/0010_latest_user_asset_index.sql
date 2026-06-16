-- Migration 0010: Optimize lookup of each user's latest generated asset

CREATE INDEX IF NOT EXISTS "idx_canvas_task_user_success_asset_created"
  ON "canvas_task"("userId", "completedAt" DESC, "createdAt" DESC)
  WHERE "status" = 'success' AND "outputData" IS NOT NULL;
