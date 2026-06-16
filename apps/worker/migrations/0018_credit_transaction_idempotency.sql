-- Migration 0018: Idempotent credit transactions for task-related debits/refunds
--
-- Background: cancel and webhook handlers can both call deductCreditsForTask /
-- refundCreditsForTask for the same (taskId, type). Without uniqueness the
-- balance can drift (double refund / double deduct). After this migration,
-- INSERT OR IGNORE on credit_transaction is the source of truth — only the
-- first writer per (relatedTaskId, type) actually records the transaction,
-- and the lib code only mutates user_credits.balance when the insert took.
--
-- Scope is narrowed by a partial index so manual adjustments such as bonus
-- grants and Stripe purchases (which carry no relatedTaskId, or use other
-- type values) are unaffected.

-- Existing production data may already contain duplicate task transactions
-- from the legacy non-idempotent code path. Keep the first transaction in each
-- (relatedTaskId, type) group and reverse the balance impact of the duplicate
-- rows before creating the unique index.
WITH "ranked_task_transactions" AS (
    SELECT
        "id",
        "userId",
        "amount",
        "type",
        ROW_NUMBER() OVER (
            PARTITION BY "relatedTaskId", "type"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS "rowNumber"
    FROM "credit_transaction"
    WHERE "relatedTaskId" IS NOT NULL
      AND "type" IN ('use', 'refund')
),
"duplicate_totals" AS (
    SELECT
        "userId",
        SUM(CASE WHEN "type" = 'use' THEN "amount" ELSE 0 END) AS "duplicateUseAmount",
        SUM(CASE WHEN "type" = 'refund' THEN "amount" ELSE 0 END) AS "duplicateRefundAmount"
    FROM "ranked_task_transactions"
    WHERE "rowNumber" > 1
    GROUP BY "userId"
)
UPDATE "user_credits"
SET "balance" = "balance"
        + COALESCE((SELECT "duplicateUseAmount" FROM "duplicate_totals" WHERE "duplicate_totals"."userId" = "user_credits"."userId"), 0)
        - COALESCE((SELECT "duplicateRefundAmount" FROM "duplicate_totals" WHERE "duplicate_totals"."userId" = "user_credits"."userId"), 0),
    "purchased_balance" = "purchased_balance"
        + COALESCE((SELECT "duplicateUseAmount" FROM "duplicate_totals" WHERE "duplicate_totals"."userId" = "user_credits"."userId"), 0)
        - COALESCE((SELECT "duplicateRefundAmount" FROM "duplicate_totals" WHERE "duplicate_totals"."userId" = "user_credits"."userId"), 0),
    "updatedAt" = datetime('now')
WHERE EXISTS (
    SELECT 1
    FROM "duplicate_totals"
    WHERE "duplicate_totals"."userId" = "user_credits"."userId"
);

WITH "ranked_task_transactions" AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "relatedTaskId", "type"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS "rowNumber"
    FROM "credit_transaction"
    WHERE "relatedTaskId" IS NOT NULL
      AND "type" IN ('use', 'refund')
)
DELETE FROM "credit_transaction"
WHERE "id" IN (
    SELECT "id"
    FROM "ranked_task_transactions"
    WHERE "rowNumber" > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_credit_transaction_task_type"
    ON "credit_transaction" ("relatedTaskId", "type")
    WHERE "relatedTaskId" IS NOT NULL
      AND "type" IN ('use', 'refund');
