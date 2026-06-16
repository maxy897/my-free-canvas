import { createMiddleware } from "hono/factory";
import type { Subscription, SubscriptionTier } from "@shared/types";
import type { Env } from "../types";
import { getAvailableCredits } from "../lib/credits";

export const quotaMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string; subscription?: Subscription };
}>(async (c, next) => {
  if (c.req.method !== "POST") {
    await next();
    return;
  }

  const userId = c.get("userId");

  try {
    // Get user's subscription tier
    const subscriptionResult = await c.env.DB.prepare(
      `SELECT * FROM "subscription" WHERE "userId" = ? AND status = 'active'`
    )
      .bind(userId)
      .first<Subscription>();

    const subscription = subscriptionResult || {
      id: "",
      userId,
      tier: "free" as const,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store subscription in context for use in routes
    c.set("subscription", subscription);

    // Check total available credits
    const available = await getAvailableCredits(c.env, userId, subscription.tier);

    if (available.total <= 0) {
      return c.json(
        {
          error: "Insufficient credits",
          dailyCredits: available.daily,
          purchasedCredits: available.purchased,
          freeCredits: available.free,
          totalAvailable: 0,
        },
        402
      );
    }

    await next();
  } catch (error) {
    console.error("Quota middleware error:", error);
    try {
      const credits = await c.env.DB.prepare(
        `SELECT ("free_balance" + "purchased_balance") as total FROM "user_credits" WHERE "userId" = ?`
      )
        .bind(userId)
        .first<{ total: number }>();

      if (!credits || credits.total <= 0) {
        return c.json(
          { error: "Insufficient credits", totalAvailable: 0 },
          402
        );
      }
    } catch {
      // If even fallback fails, let the request through
    }

    await next();
  }
});
