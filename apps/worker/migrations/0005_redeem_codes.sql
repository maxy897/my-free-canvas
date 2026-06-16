-- Migration 0005: Redeem Codes
-- Table: redeem_code

CREATE TABLE "redeem_code" (
    "id" TEXT PRIMARY KEY,
    "code" TEXT NOT NULL UNIQUE,
    "credits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unused',
    "usedBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
    "usedAt" TEXT,
    "expiresAt" TEXT,
    "note" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX "idx_redeem_code_code" ON "redeem_code"("code");
CREATE INDEX "idx_redeem_code_status" ON "redeem_code"("status");
