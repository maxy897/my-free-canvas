import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";
import { PRICING, type SubscriptionTier } from "@shared/types";
import { getOrCreateUserCredits, getAvailableCredits } from "../lib/credits";
import { createCheckoutSession } from "../lib/payment/stripe";
import { toIsoUtc } from "../lib/datetime";

export const creditsRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

creditsRoutes.use("*", authMiddleware);

// GET /api/credits - Get current credit balance (full breakdown)
creditsRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  try {
    await getOrCreateUserCredits(c.env, userId);

    const sub = await c.env.DB.prepare(
      `SELECT tier FROM "subscription" WHERE "userId" = ? AND status = 'active'`
    )
      .bind(userId)
      .first<{ tier: SubscriptionTier }>();
    const tier: SubscriptionTier = sub?.tier || "free";

    const available = await getAvailableCredits(c.env, userId, tier);

    return c.json({
      dailyCredits: available.daily,
      dailyLimit: available.dailyLimit,
      purchasedCredits: available.purchased,
      freeCredits: available.free,
      totalAvailable: available.total,
    });
  } catch (error) {
    console.error("Error getting credits:", error);
    return c.json({ error: "Failed to get credits" }, 500);
  }
});

// GET /api/credits/transactions - Get transaction history
creditsRoutes.get("/transactions", async (c) => {
  const userId = c.get("userId");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  try {
    const transactions = await c.env.DB.prepare(
      `SELECT * FROM "credit_transaction"
       WHERE "userId" = ?
       ORDER BY "createdAt" DESC
       LIMIT ? OFFSET ?`
    )
      .bind(userId, limit, offset)
      .all<Record<string, unknown>>();

    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM "credit_transaction" WHERE "userId" = ?`
    )
      .bind(userId)
      .first<{ count: number }>();

    return c.json({
      transactions: (transactions.results || []).map((row) => ({
        ...row,
        createdAt: toIsoUtc(row.createdAt as string | null),
      })),
      total: total?.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error getting transactions:", error);
    return c.json({ error: "Failed to get transactions" }, 500);
  }
});

// POST /api/credits/purchase - Purchase credits via Stripe Checkout
creditsRoutes.post("/purchase", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ packId: string }>();

  try {
    if (!body.packId) {
      return c.json({ error: "Missing packId" }, 400);
    }

    const pack = PRICING[body.packId as keyof typeof PRICING];
    if (!pack) {
      return c.json({ error: "Invalid pack" }, 400);
    }

    // If Stripe not configured, fall back to mock mode (dev only)
    if (!c.env.STRIPE_SECRET_KEY) {
      const credits = await getOrCreateUserCredits(c.env, userId);
      await c.env.DB.prepare(
        `UPDATE "user_credits"
         SET "purchased_balance" = "purchased_balance" + ?,
             balance = balance + ?,
             "updatedAt" = datetime('now')
         WHERE "userId" = ?`
      )
        .bind(pack.credits, pack.credits, userId)
        .run();

      const transactionId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO "credit_transaction" (id, "userId", amount, type, description) VALUES (?, ?, ?, 'purchase', ?)`
      )
        .bind(transactionId, userId, pack.credits, `Purchased ${pack.description}`)
        .run();

      return c.json({
        status: "completed",
        credits: pack.credits,
        balance: credits.purchased_balance + credits.free_balance + pack.credits,
      });
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

    const session = await createCheckoutSession(
      c.env,
      userId,
      user.email,
      body.packId,
      `${c.env.FRONTEND_URL}/payment/success`,
      `${c.env.FRONTEND_URL}/payment/cancel`
    );

    return c.json({ status: "pending", url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Error processing purchase:", error);
    return c.json({ error: "Failed to process purchase" }, 500);
  }
});

// POST /api/credits/add - Internal endpoint to add credits
creditsRoutes.post("/add", async (c) => {
  const body = await c.req.json<{
    userId: string;
    amount: number;
    type: string;
    description: string;
    target?: "free" | "purchased";
  }>();

  try {
    const { userId, amount, type, description, target = "purchased" } = body;

    if (!userId || !amount || !type) {
      return c.json(
        { error: "Missing required fields: userId, amount, type" },
        400
      );
    }

    await getOrCreateUserCredits(c.env, userId);

    const column = target === "free" ? "free_balance" : "purchased_balance";
    await c.env.DB.prepare(
      `UPDATE "user_credits"
       SET "${column}" = "${column}" + ?,
           balance = balance + ?,
           "updatedAt" = datetime('now')
       WHERE "userId" = ?`
    )
      .bind(amount, amount, userId)
      .run();

    const transactionId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO "credit_transaction"
       (id, "userId", amount, type, description)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(transactionId, userId, amount, type, description)
      .run();

    return c.json({ success: true, transactionId });
  } catch (error) {
    console.error("Error adding credits:", error);
    return c.json({ error: "Failed to add credits" }, 500);
  }
});
