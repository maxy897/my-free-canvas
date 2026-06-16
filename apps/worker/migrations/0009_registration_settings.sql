-- Migration 0009: Runtime registration controls

CREATE TABLE IF NOT EXISTS "app_setting" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "app_setting" ("key", "value")
VALUES ('registration_enabled', 'true');

CREATE TRIGGER IF NOT EXISTS "block_user_insert_when_registration_disabled"
BEFORE INSERT ON "user"
WHEN COALESCE(
    (SELECT "value" FROM "app_setting" WHERE "key" = 'registration_enabled'),
    'true'
) = 'false'
BEGIN
    SELECT RAISE(ABORT, 'registration_disabled');
END;
