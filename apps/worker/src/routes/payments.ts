import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";
import { retrieveCheckoutSession } from "../lib/payment/stripe";
import { PACK_CREDITS } from "../lib/payment/config";
import { getOrCreateUserCredits } from "../lib/credits";
import { resetDailyCredits } from "../lib/credits";

export const paymentRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

paymentRoutes.use("*", authMiddleware);

/**
 * POST /api/payments/verify-session
 *
 * Called by the frontend success page to verify a Stripe Checkout Session
 * and fulfill the order. Idempotent: calling multiple times won't double-deliver.
 */
paymentRoutes.post("/verify-session", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ sessionId: string }>();

  if (!body.sessionId) {
    return c.json({ error: "Missing sessionId" }, 400);
  }

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Stripe not configured" }, 500);
  }

  try {
    const session = await retrieveCheckoutSession(c.env, body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const status = session.payment_status as string;
    if (status !== "paid") {
      return c.json({ status: "unpaid", message: "Payment not completed" });
    }

    const metadata = session.metadata as Record<string, string> | undefined;
    const sessionUserId = metadata?.userId;

    if (sessionUserId !== userId) {
      return c.json({ error: "Session does not belong to this user" }, 403);
    }

    const mode = session.mode as string;

    if (mode === "payment") {
      const packId = metadata?.packId;
      if (!packId) return c.json({ error: "Missing packId in session" }, 400);

      const credits = PACK_CREDITS[packId];
      if (!credits) return c.json({ error: `Unknown pack: ${packId}` }, 400);

      // Idempotency check
      const existing = await c.env.DB.prepare(
        `SELECT id FROM "credit_transaction" WHERE INSTR(description, ?) > 0`
      )
        .bind(body.sessionId)
        .first();

      if (existing) {
        return c.json({ status: "already_fulfilled", credits });
      }

      await getOrCreateUserCredits(c.env, userId);

      await c.env.DB.prepare(
        `UPDATE "user_credits"
         SET "purchased_balance" = "purchased_balance" + ?,
             balance = balance + ?,
             "updatedAt" = datetime('now')
         WHERE "userId" = ?`
      )
        .bind(credits, credits, userId)
        .run();

      const transactionId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO "credit_transaction"
         (id, "userId", amount, type, description)
         VALUES (?, ?, ?, 'purchase', ?)`
      )
        .bind(transactionId, userId, credits, `Purchased ${packId} (${credits} credits) [${body.sessionId}]`)
        .run();

      const customerId = session.customer as string | null;
      if (customerId) {
        await c.env.DB.prepare(
          `UPDATE "user" SET "stripeCustomerId" = ? WHERE id = ? AND "stripeCustomerId" IS NULL`
        )
          .bind(customerId, userId)
          .run();
      }

      return c.json({ status: "fulfilled", credits });
    }

    if (mode === "subscription") {
      const tier = metadata?.tier as "pro" | "premium" | undefined;
      const billing = metadata?.billing || "monthly";
      const stripeSubscriptionId = session.subscription as string | null;

      if (!tier) return c.json({ error: "Missing tier in session" }, 400);

      if (stripeSubscriptionId) {
        const existing = await c.env.DB.prepare(
          `SELECT id FROM "subscription" WHERE "stripeSubscriptionId" = ?`
        )
          .bind(stripeSubscriptionId)
          .first();

        if (existing) {
          return c.json({ status: "already_fulfilled", tier });
        }
      }

      const now = new Date().toISOString();
      const end = new Date();
      end.setDate(end.getDate() + (billing === "yearly" ? 365 : 30));
      const periodEnd = end.toISOString();

      const existingSub = await c.env.DB.prepare(
        `SELECT id FROM "subscription" WHERE "userId" = ? AND status = 'active'`
      )
        .bind(userId)
        .first<{ id: string }>();

      if (existingSub) {
        await c.env.DB.prepare(
          `UPDATE "subscription"
           SET tier = ?, "currentPeriodStart" = ?, "currentPeriodEnd" = ?,
               "stripeSubscriptionId" = ?, "billingCycle" = ?, "updatedAt" = ?
           WHERE id = ?`
        )
          .bind(tier, now, periodEnd, stripeSubscriptionId, billing, now, existingSub.id)
          .run();
      } else {
        const id = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO "subscription"
           (id, "userId", tier, "currentPeriodStart", "currentPeriodEnd", status, "stripeSubscriptionId", "billingCycle")
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
        )
          .bind(id, userId, tier, now, periodEnd, stripeSubscriptionId, billing)
          .run();
      }

      const customerId = session.customer as string | null;
      if (customerId) {
        await c.env.DB.prepare(
          `UPDATE "user" SET "stripeCustomerId" = ? WHERE id = ? AND "stripeCustomerId" IS NULL`
        )
          .bind(customerId, userId)
          .run();
      }

      await resetDailyCredits(c.env, userId);
      return c.json({ status: "fulfilled", tier });
    }

    return c.json({ error: "Unknown session mode" }, 400);
  } catch (error) {
    console.error("Error verifying session:", error);
    return c.json({ error: "Failed to verify session" }, 500);
  }
});
