import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getOrCreateUserCredits } from "../lib/credits";
import type { Env } from "../types";

export const redeemRoutes = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

redeemRoutes.use("*", authMiddleware);

// POST /api/redeem — redeem a code
redeemRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ code: string }>();

  if (!body.code || typeof body.code !== "string") {
    return c.json({ error: "Missing code" }, 400);
  }

  const code = body.code.trim();

  // Look up the code
  const redeemCode = await c.env.DB.prepare(
    `SELECT * FROM "redeem_code" WHERE "code" = ?`
  )
    .bind(code)
    .first<{
      id: string;
      code: string;
      credits: number;
      status: string;
      expiresAt: string | null;
    }>();

  if (!redeemCode) {
    return c.json({ error: "兑换码不存在" }, 404);
  }

  if (redeemCode.status === "used") {
    return c.json({ error: "兑换码已被使用" }, 409);
  }

  if (redeemCode.status === "disabled") {
    return c.json({ error: "兑换码已被禁用" }, 409);
  }

  // Check expiration
  if (redeemCode.expiresAt && new Date(redeemCode.expiresAt) < new Date()) {
    return c.json({ error: "兑换码已过期" }, 410);
  }

  // Ensure user_credits row exists
  await getOrCreateUserCredits(c.env, userId);

  // Mark code as used
  await c.env.DB.prepare(
    `UPDATE "redeem_code"
     SET "status" = 'used', "usedBy" = ?, "usedAt" = datetime('now')
     WHERE "id" = ? AND "status" = 'unused'`
  )
    .bind(userId, redeemCode.id)
    .run();

  // Add credits to user
  await c.env.DB.prepare(
    `UPDATE "user_credits"
     SET "purchased_balance" = "purchased_balance" + ?,
         "balance" = "balance" + ?,
         "updatedAt" = datetime('now')
     WHERE "userId" = ?`
  )
    .bind(redeemCode.credits, redeemCode.credits, userId)
    .run();

  // Record transaction
  const transactionId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO "credit_transaction" (id, "userId", amount, type, description)
     VALUES (?, ?, ?, 'redeem', ?)`
  )
    .bind(transactionId, userId, redeemCode.credits, `兑换码充值: ${code}`)
    .run();

  // Get updated balance
  const updated = await c.env.DB.prepare(
    `SELECT "balance" FROM "user_credits" WHERE "userId" = ?`
  )
    .bind(userId)
    .first<{ balance: number }>();

  return c.json({
    success: true,
    credits: redeemCode.credits,
    newBalance: updated?.balance ?? 0,
  });
});
