-- Migration 0004: File Storage Enhancements
-- Adds hash column for deduplication and indexing improvements

ALTER TABLE "canvas_file" ADD COLUMN "hash" TEXT;

-- Add index for hash-based deduplication
CREATE INDEX "idx_canvas_file_hash_userId" ON "canvas_file"("hash", "userId");

-- Add composite index for listing files efficiently
CREATE INDEX "idx_canvas_file_userId_createdAt" ON "canvas_file"("userId", "createdAt" DESC);
