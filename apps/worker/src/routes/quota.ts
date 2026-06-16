import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { SubscriptionTier } from "@shared/types";
import type { Env } from "../types";
import { getAvailableCredits } from "../lib/credits";

export const quotaRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

quotaRoutes.use("*", authMiddleware);

// GET /api/quota - Get available credits breakdown
quotaRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  let tier: SubscriptionTier = "free";
  try {
    const sub = await c.env.DB.prepare(
      `SELECT tier FROM "subscription" WHERE "userId" = ? AND status = 'active'`
    )
      .bind(userId)
      .first<{ tier: string }>();
    if (sub && (sub.tier === "free" || sub.tier === "pro" || sub.tier === "premium")) {
      tier = sub.tier;
    }
  } catch {
    // Fall back to free tier
  }

  const available = await getAvailableCredits(c.env, userId, tier);

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  return c.json({
    dailyCredits: available.daily,
    dailyLimit: available.dailyLimit,
    purchasedCredits: available.purchased,
    freeCredits: available.free,
    totalAvailable: available.total,
    tier,
    resetsAt: tomorrow.toISOString(),
  });
});
