-- Migration 0011: Enable Better Auth email/password accounts

ALTER TABLE "account" ADD COLUMN "refreshTokenExpiresAt" TEXT;
ALTER TABLE "account" ADD COLUMN "password" TEXT;
