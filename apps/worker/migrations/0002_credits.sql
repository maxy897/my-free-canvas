-- Migration 0002: Credits & Subscriptions
-- Tables: user_credits, subscription, credit_transaction

CREATE TABLE "user_credits" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "free_balance" INTEGER NOT NULL DEFAULT 0,
    "purchased_balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE "subscription" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "currentPeriodStart" TEXT NOT NULL,
    "currentPeriodEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "billingCycle" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
    "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE "credit_transaction" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "relatedTaskId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX "idx_user_credits_userId" ON "user_credits"("userId");
CREATE INDEX "idx_subscription_userId" ON "subscription"("userId");
CREATE INDEX "idx_subscription_stripe_sub" ON "subscription"("stripeSubscriptionId");
CREATE INDEX "idx_credit_transaction_userId" ON "credit_transaction"("userId");
