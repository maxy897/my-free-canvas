import { DAILY_CREDITS, WELCOME_BONUS, type SubscriptionTier, type UserCredits } from "@shared/types";
import type { Env } from "../types";

// --- Types ---

export interface CreditBreakdown {
  daily: number;
  dailyLimit: number;
  purchased: number;
  free: number;
  total: number;
}

export interface DeductionResult {
  success: boolean;
  error?: string;
  deducted: { daily: number; purchased: number; free: number };
  remaining: CreditBreakdown;
}

// --- Daily Credits (KV-backed, lazy init) ---

function dailyKey(userId: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `daily_credits:${userId}:${today}`;
}

async function getDailyCredits(
  env: Env,
  userId: string,
  tier: SubscriptionTier
): Promise<{ remaining: number; limit: number }> {
  const limit = DAILY_CREDITS[tier] || 0;
  if (limit === 0) return { remaining: 0, limit: 0 };

  const key = dailyKey(userId);
  const stored = await env.KV.get(key);

  if (stored === null) {
    // First request today — initialize
    await env.KV.put(key, String(limit), { expirationTtl: 86400 });
    return { remaining: limit, limit };
  }

  return { remaining: parseInt(stored, 10), limit };
}

async function deductDailyCredits(
  env: Env,
  userId: string,
  amount: number
): Promise<void> {
  const key = dailyKey(userId);
  const current = parseInt((await env.KV.get(key)) || "0", 10);
  await env.KV.put(key, String(Math.max(0, current - amount)), { expirationTtl: 86400 });
}

// --- DB Credits ---

async function getOrCreateUserCredits(env: Env, userId: string): Promise<UserCredits> {
  let credits = await env.DB.prepare(
    `SELECT * FROM "user_credits" WHERE "userId" = ?`
  )
    .bind(userId)
    .first<UserCredits>();

  if (!credits) {
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO "user_credits" (id, "userId", balance, "free_balance", "purchased_balance") VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, userId, WELCOME_BONUS, WELCOME_BONUS, 0)
      .run();

    if (result.meta.changes > 0) {
      // Record the welcome bonus only for the request that actually created the balance row.
      const txId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO "credit_transaction" (id, "userId", amount, type, description) VALUES (?, ?, ?, 'bonus', ?)`
      )
        .bind(txId, userId, WELCOME_BONUS, `Welcome bonus: ${WELCOME_BONUS} free credits`)
        .run();
    }

    credits = await env.DB.prepare(
      `SELECT * FROM "user_credits" WHERE "userId" = ?`
    )
      .bind(userId)
      .first<UserCredits>();
  }

  if (!credits) {
    throw new Error(`Failed to initialize credits for user ${userId}`);
  }

  return credits;
}

// --- Public API ---

export async function getAvailableCredits(
  env: Env,
  userId: string,
  tier: SubscriptionTier
): Promise<CreditBreakdown> {
  const [userCredits, daily] = await Promise.all([
    getOrCreateUserCredits(env, userId),
    getDailyCredits(env, userId, tier),
  ]);

  return {
    daily: daily.remaining,
    dailyLimit: daily.limit,
    purchased: userCredits.purchased_balance,
    free: userCredits.free_balance,
    total: daily.remaining + userCredits.purchased_balance + userCredits.free_balance,
  };
}

export async function deductCredits(
  env: Env,
  userId: string,
  tier: SubscriptionTier,
  amount: number
): Promise<DeductionResult> {
  const available = await getAvailableCredits(env, userId, tier);

  if (available.total < amount) {
    return {
      success: false,
      error: "Insufficient credits",
      deducted: { daily: 0, purchased: 0, free: 0 },
      remaining: available,
    };
  }

  let remaining = amount;
  let fromDaily = 0;
  let fromPurchased = 0;
  let fromFree = 0;

  // 1. Deduct from daily subscription credits first (they expire)
  if (remaining > 0 && available.daily > 0) {
    fromDaily = Math.min(remaining, available.daily);
    remaining -= fromDaily;
  }

  // 2. Deduct from purchased credits (permanent)
  if (remaining > 0 && available.purchased > 0) {
    fromPurchased = Math.min(remaining, available.purchased);
    remaining -= fromPurchased;
  }

  // 3. Deduct from free credits (limited, last resort)
  if (remaining > 0 && available.free > 0) {
    fromFree = Math.min(remaining, available.free);
    remaining -= fromFree;
  }

  // Apply deductions
  if (fromDaily > 0) {
    await deductDailyCredits(env, userId, fromDaily);
  }

  if (fromPurchased > 0 || fromFree > 0) {
    await env.DB.prepare(
      `UPDATE "user_credits"
       SET "purchased_balance" = "purchased_balance" - ?,
           "free_balance" = "free_balance" - ?,
           balance = balance - ?,
           "updatedAt" = datetime('now')
       WHERE "userId" = ?`
    )
      .bind(fromPurchased, fromFree, fromPurchased + fromFree, userId)
      .run();
  }

  return {
    success: true,
    deducted: { daily: fromDaily, purchased: fromPurchased, free: fromFree },
    remaining: {
      daily: available.daily - fromDaily,
      dailyLimit: available.dailyLimit,
      purchased: available.purchased - fromPurchased,
      free: available.free - fromFree,
      total: available.total - amount,
    },
  };
}

export async function resetDailyCredits(env: Env, userId: string): Promise<void> {
  const key = dailyKey(userId);
  await env.KV.delete(key);
}

export { getOrCreateUserCredits };
