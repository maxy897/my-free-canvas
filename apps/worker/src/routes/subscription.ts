import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";
import type { Subscription, SubscriptionTier } from "@shared/types";
import { resetDailyCredits } from "../lib/credits";
import {
  createSubscriptionCheckoutSession,
  cancelStripeSubscription,
} from "../lib/payment/stripe";

export const subscriptionRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

subscriptionRoutes.use("*", authMiddleware);

function getSubscriptionPeriodEnd(): string {
  const end = new Date();
  end.setDate(end.getDate() + 30);
  return end.toISOString();
}

// GET /api/subscription - Get user's subscription info
subscriptionRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  try {
    let subscription = await c.env.DB.prepare(
      `SELECT * FROM "subscription" WHERE "userId" = ? AND status = 'active'`
    )
      .bind(userId)
      .first<Subscription>();

    if (!subscription) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const end = getSubscriptionPeriodEnd();

      await c.env.DB.prepare(
        `INSERT INTO "subscription"
         (id, "userId", tier, "currentPeriodStart", "currentPeriodEnd", status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(id, userId, "free", now, end, "active")
        .run();

      subscription = {
        id,
        userId,
        tier: "free",
        currentPeriodStart: now,
        currentPeriodEnd: end,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
    }

    return c.json(subscription);
  } catch (error) {
    console.error("Error getting subscription:", error);
    return c.json({ error: "Failed to get subscription" }, 500);
  }
});

// POST /api/subscription/upgrade - Upgrade or change subscription tier
subscriptionRoutes.post("/upgrade", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    tier: SubscriptionTier;
    billing?: "monthly" | "yearly";
  }>();

  try {
    if (!body.tier) {
      return c.json({ error: "Missing tier" }, 400);
    }

    const validTiers: SubscriptionTier[] = ["free", "pro", "premium"];
    if (!validTiers.includes(body.tier)) {
      return c.json({ error: "Invalid tier" }, 400);
    }

    // Downgrade to free = cancel subscription
    if (body.tier === "free") {
      const subscription = await c.env.DB.prepare(
        `SELECT * FROM "subscription" WHERE "userId" = ? AND status = 'active'`
      )
        .bind(userId)
        .first<Subscription & { stripeSubscriptionId?: string }>();

      if (subscription?.stripeSubscriptionId && c.env.STRIPE_SECRET_KEY) {
        await cancelStripeSubscription(c.env, subscription.stripeSubscriptionId);
      }

      if (subscription) {
        const now = new Date().toISOString();
        await c.env.DB.prepare(
          `UPDATE "subscription" SET tier = 'free', "updatedAt" = ? WHERE id = ?`
        )
          .bind(now, subscription.id)
          .run();
      }

      await resetDailyCredits(c.env, userId);
      return c.json({ success: true, message: "Downgraded to free" });
    }

    // Paid upgrade — use Stripe Checkout
    const billing = body.billing || "monthly";

    // If Stripe not configured, fall back to mock mode (dev only)
    if (!c.env.STRIPE_SECRET_KEY) {
      let subscription = await c.env.DB.prepare(
        `SELECT * FROM "subscription" WHERE "userId" = ? AND status = 'active'`
      )
        .bind(userId)
        .first<Subscription>();

      const now = new Date().toISOString();
      const end = getSubscriptionPeriodEnd();

      if (!subscription) {
        const id = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO "subscription"
           (id, "userId", tier, "currentPeriodStart", "currentPeriodEnd", status)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(id, userId, body.tier, now, end, "active")
          .run();
      } else {
        await c.env.DB.prepare(
          `UPDATE "subscription"
           SET tier = ?, "currentPeriodStart" = ?, "currentPeriodEnd" = ?, "updatedAt" = ?
           WHERE id = ?`
        )
          .bind(body.tier, now, end, now, subscription.id)
          .run();
      }

      await resetDailyCredits(c.env, userId);
      return c.json({ success: true, message: "Subscription updated (mock)" });
    }

    // Real Stripe Checkout flow
    const user = await c.env.DB.prepare(
      `SELECT email FROM "user" WHERE id = ?`
    )
      .bind(userId)
      .first<{ email: string }>();

    if (!user?.email) {
      return c.json({ error: "User email not found" }, 400);
    }

    const session = await createSubscriptionCheckoutSession(
      c.env,
      userId,
      user.email,
      body.tier,
      billing,
      `${c.env.FRONTEND_URL}/payment/success?type=subscription`,
      `${c.env.FRONTEND_URL}/payment/cancel`
    );

    return c.json({ status: "pending", url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Error upgrading subscription:", error);
    return c.json({ error: "Failed to upgrade subscription" }, 500);
  }
});

// POST /api/subscription/cancel - Cancel subscription
subscriptionRoutes.post("/cancel", async (c) => {
  const userId = c.get("userId");

  try {
    const subscription = await c.env.DB.prepare(
      `SELECT * FROM "subscription" WHERE "userId" = ? AND status = 'active'`
    )
      .bind(userId)
      .first<Subscription & { stripeSubscriptionId?: string }>();

    if (!subscription) {
      return c.json({ error: "No active subscription found" }, 404);
    }

    if (subscription.stripeSubscriptionId && c.env.STRIPE_SECRET_KEY) {
      await cancelStripeSubscription(c.env, subscription.stripeSubscriptionId);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE "subscription" SET status = 'cancelled', "updatedAt" = ? WHERE id = ?`
    )
      .bind(now, subscription.id)
      .run();

    return c.json({ success: true, message: "Subscription cancelled" });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return c.json({ error: "Failed to cancel subscription" }, 500);
  }
});
