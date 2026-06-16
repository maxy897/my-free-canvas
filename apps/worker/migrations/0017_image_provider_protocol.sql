-- Migration 0017: Track each upstream's wire protocol
-- Lets the relay dispatch chatgpt2api-async (async task / poll-based —
-- client_task_id + poll loop) and openai-compat (POST /v1/images/generations
-- with synchronous b64_json) through the same provider table.
--
-- Existing rows default to openai-compat — that is the only protocol
-- migration 0016 supported, so the upgrade is a no-op for current data.

ALTER TABLE "image_provider"
    ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'openai-compat';
