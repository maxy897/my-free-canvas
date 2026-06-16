import type { Env } from "../types";
import type { CreditTransactionType } from "@shared/types";
import { getTaskCost } from "./task-costs";

interface CreditDeductionResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  creditsDeducted?: number;
  /**
   * True when a transaction row for (taskId, type) already existed and the
   * balance was therefore not touched again. Callers can treat this as a
   * benign no-op (e.g. webhook re-delivery after cancel-then-failed).
   */
  alreadyApplied?: boolean;
}

/**
 * Attempt to deduct credits from a user's balance.
 *
 * Idempotency contract: the (relatedTaskId, type='use') row is unique
 * (migration 0018). We INSERT OR IGNORE the transaction first; only when a
 * new row was inserted do we mutate user_credits.balance. Repeated calls for
 * the same taskId become safe no-ops returning alreadyApplied=true.
 *
 * Priority order: free credits first, then purchased.
 */
export async function deductCreditsForTask(
  env: Env,
  userId: string,
  taskType: string,
  taskId: string
): Promise<CreditDeductionResult> {
  try {
    const cost = getTaskCost(taskType);

    // Get current balance
    const credits = await env.DB.prepare(
      `SELECT id, balance, free_balance, purchased_balance FROM "user_credits" WHERE "userId" = ?`
    )
      .bind(userId)
      .first<{
        id: string;
        balance: number;
        free_balance: number;
        purchased_balance: number;
      }>();

    if (!credits) {
      return {
        success: false,
        error: "User credits not initialized",
      };
    }

    // Check if sufficient balance
    if (credits.balance < cost) {
      return {
        success: false,
        error: `Insufficient credits. Need ${cost}, have ${credits.balance}`,
      };
    }

    // Deduct from free balance first, then purchased
    const freeDeduction = Math.min(cost, credits.free_balance);
    const purchasedDeduction = cost - freeDeduction;

    // Reserve the (taskId, 'use') slot first. If another caller already
    // recorded the deduction the INSERT is ignored and we leave the balance
    // alone — guarded by the partial unique index on credit_transaction.
    const transactionId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO "credit_transaction"
       (id, "userId", amount, type, "relatedTaskId", description)
       VALUES (?, ?, ?, 'use', ?, ?)`
    )
      .bind(
        transactionId,
        userId,
        cost,
        taskId,
        `Canvas ${taskType} task execution`
      )
      .run();

    if (!inserted.meta.changes) {
      return {
        success: true,
        creditsDeducted: cost,
        alreadyApplied: true,
      };
    }

    // Update balance (atomic-ish in D1)
    await env.DB.prepare(
      `UPDATE "user_credits"
       SET balance = balance - ?,
           free_balance = free_balance - ?,
           purchased_balance = purchased_balance - ?,
           "updatedAt" = datetime('now')
       WHERE "userId" = ?`
    )
      .bind(cost, freeDeduction, purchasedDeduction, userId)
      .run();

    return {
      success: true,
      transactionId,
      creditsDeducted: cost,
    };
  } catch (error) {
    console.error("Error deducting credits:", error);
    return {
      success: false,
      error: "Failed to process credit deduction",
    };
  }
}

/**
 * Refund credits to a user if a task failed or was cancelled-then-failed.
 *
 * Idempotency: see deductCreditsForTask. We INSERT OR IGNORE the (taskId,
 * 'refund') row first; the balance only moves when a new row was inserted.
 * This is what lets the cancel handler stay simple — if a webhook later
 * lands with status=failed, the refund is applied exactly once regardless
 * of webhook re-deliveries or pre-existing cancel-side refunds.
 */
export async function refundCreditsForTask(
  env: Env,
  userId: string,
  taskType: string,
  taskId: string
): Promise<CreditDeductionResult> {
  try {
    const cost = getTaskCost(taskType);

    // Reserve the (taskId, 'refund') slot first.
    const transactionId = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO "credit_transaction"
       (id, "userId", amount, type, "relatedTaskId", description)
       VALUES (?, ?, ?, 'refund', ?, ?)`
    )
      .bind(
        transactionId,
        userId,
        cost,
        taskId,
        `Canvas ${taskType} task refund`
      )
      .run();

    if (!inserted.meta.changes) {
      return {
        success: true,
        creditsDeducted: cost,
        alreadyApplied: true,
      };
    }

    // Refund to purchased balance (return what was spent)
    await env.DB.prepare(
      `UPDATE "user_credits"
       SET balance = balance + ?,
           purchased_balance = purchased_balance + ?,
           "updatedAt" = datetime('now')
       WHERE "userId" = ?`
    )
      .bind(cost, cost, userId)
      .run();

    return {
      success: true,
      transactionId,
      creditsDeducted: cost,
    };
  } catch (error) {
    console.error("Error refunding credits:", error);
    return {
      success: false,
      error: "Failed to process credit refund",
    };
  }
}

/**
 * Check if a user has sufficient credits without deducting.
 * Returns available balance and whether they can afford the task.
 */
export async function checkAvailableCredits(
  env: Env,
  userId: string,
  taskType?: string
): Promise<{
  available: number;
  canAfford: boolean;
  requiredForTask?: number;
}> {
  try {
    const credits = await env.DB.prepare(
      `SELECT balance FROM "user_credits" WHERE "userId" = ?`
    )
      .bind(userId)
      .first<{ balance: number }>();

    if (!credits) {
      return { available: 0, canAfford: false };
    }

    if (!taskType) {
      return { available: credits.balance, canAfford: false };
    }

    const cost = getTaskCost(taskType);
    return {
      available: credits.balance,
      canAfford: credits.balance >= cost,
      requiredForTask: cost,
    };
  } catch (error) {
    console.error("Error checking available credits:", error);
    return { available: 0, canAfford: false };
  }
}
