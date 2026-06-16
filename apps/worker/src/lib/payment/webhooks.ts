/**
 * Payment Webhook Handlers
 *
 * Processes Stripe webhook events to deliver credits and manage subscriptions.
 */

import type { Env } from "../../types";
import { PACK_CREDITS } from "./config";
import { getOrCreateUserCredits } from "../credits";
import { resetDailyCredits } from "../credits";

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Process payment webhook (dispatcher)
 */
export async function processPaymentWebhook(
  env: Env,
  provider: string,
  event: WebhookEvent
): Promise<void> {
  console.log(`Processing ${provider} webhook: ${event.type}`);

  if (provider === "stripe") {
    await handleStripeWebhook(env, event);
  }
}

/**
 * Handle Stripe webhook events
 */
async function handleStripeWebhook(
  env: Env,
  event: WebhookEvent
): Promise<void> {
  const data = event.data;

  switch (event.type) {
    case "checkout.session.completed": {
      const mode = data.mode as string;
      if (mode === "payment") {
        await handleCreditPurchaseCompleted(env, data);
      } else if (mode === "subscription") {
        await handleSubscriptionCheckoutCompleted(env, data);
      }
      break;
    }

    case "customer.subscription.updated":
      await handleSubscriptionUpdated(env, data);
      break;

    case "customer.subscription.deleted":
      await handleSubscriptionCancelled(env, data);
      break;

    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(env, data);
      break;

    case "invoice.payment_failed":
      console.warn("Invoice payment failed:", data.id);
      break;

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }
}

/**
 * Credit pack purchase completed via Stripe Checkout
 */
async function handleCreditPurchaseCompleted(
  env: Env,
  data: Record<string, unknown>
): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.userId;
  const packId = metadata?.packId;

  if (!userId || !packId) {
    console.error("Missing userId or packId in checkout metadata");
    return;
  }

  const credits = PACK_CREDITS[packId];
  if (!credits) {
    console.error(`Unknown pack: ${packId}`);
    return;
  }

  // Idempotency: check if this session was already processed
  const sessionId = data.id as string;
  const existing = await env.DB.prepare(
    `SELECT id FROM "credit_transaction" WHERE INSTR(description, ?) > 0`
  )
    .bind(sessionId)
    .first();

  if (existing) {
    console.log(`Session ${sessionId} already processed, skipping`);
    return;
  }

  // Ensure user credits row exists
  await getOrCreateUserCredits(env, userId);

  // Add credits to purchased_balance
  await env.DB.prepare(
    `UPDATE "user_credits"
     SET "purchased_balance" = "purchased_balance" + ?,
         balance = balance + ?,
         "updatedAt" = datetime('now')
     WHERE "userId" = ?`
  )
    .bind(credits, credits, userId)
    .run();

  // Record transaction
  const transactionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO "credit_transaction"
     (id, "userId", amount, type, description)
     VALUES (?, ?, ?, 'purchase', ?)`
  )
    .bind(
      transactionId,
      userId,
      credits,
      `Purchased ${packId} (${credits} credits) [${sessionId}]`
    )
    .run();

  // Store Stripe customer ID if not already stored
  const customerId = data.customer as string | null;
  if (customerId) {
    await env.DB.prepare(
      `UPDATE "user" SET "stripeCustomerId" = ? WHERE id = ? AND "stripeCustomerId" IS NULL`
    )
      .bind(customerId, userId)
      .run();
  }

  console.log(`Added ${credits} credits to user ${userId} (pack: ${packId})`);
}

/**
 * Subscription checkout completed — activate subscription
 */
async function handleSubscriptionCheckoutCompleted(
  env: Env,
  data: Record<string, unknown>
): Promise<void> {
  const metadata = data.metadata as Record<string, string> | undefined;
  const userId = metadata?.userId;
  const tier = metadata?.tier as "pro" | "premium" | undefined;
  const billing = metadata?.billing || "monthly";
  const stripeSubscriptionId = data.subscription as string | null;
  const customerId = data.customer as string | null;

  if (!userId || !tier) {
    console.error("Missing userId or tier in subscription checkout metadata");
    return;
  }

  const now = new Date().toISOString();
  const end = new Date();
  end.setDate(end.getDate() + (billing === "yearly" ? 365 : 30));
  const periodEnd = end.toISOString();

  // Upsert subscription
  const existing = await env.DB.prepare(
    `SELECT id FROM "subscription" WHERE "userId" = ? AND status = 'active'`
  )
    .bind(userId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE "subscription"
       SET tier = ?, "currentPeriodStart" = ?, "currentPeriodEnd" = ?,
           "stripeSubscriptionId" = ?, "billingCycle" = ?, "updatedAt" = ?
       WHERE id = ?`
    )
      .bind(tier, now, periodEnd, stripeSubscriptionId, billing, now, existing.id)
      .run();
  } else {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO "subscription"
       (id, "userId", tier, "currentPeriodStart", "currentPeriodEnd", status, "stripeSubscriptionId", "billingCycle")
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(id, userId, tier, now, periodEnd, stripeSubscriptionId, billing)
      .run();
  }

  // Store Stripe customer ID
  if (customerId) {
    await env.DB.prepare(
      `UPDATE "user" SET "stripeCustomerId" = ? WHERE id = ? AND "stripeCustomerId" IS NULL`
    )
      .bind(customerId, userId)
      .run();
  }

  // Reset daily credits so next request uses new tier allowance
  await resetDailyCredits(env, userId);

  console.log(`Subscription activated: user=${userId}, tier=${tier}, billing=${billing}`);
}

/**
 * Subscription updated (e.g. plan change)
 */
async function handleSubscriptionUpdated(
  env: Env,
  data: Record<string, unknown>
): Promise<void> {
  const stripeSubId = data.id as string;
  const status = data.status as string;

  const sub = await env.DB.prepare(
    `SELECT id, "userId" FROM "subscription" WHERE "stripeSubscriptionId" = ?`
  )
    .bind(stripeSubId)
    .first<{ id: string; userId: string }>();

  if (!sub) {
    console.log(`No local subscription found for Stripe sub: ${stripeSubId}`);
    return;
  }

  if (status === "canceled" || status === "unpaid") {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE "subscription" SET status = 'cancelled', tier = 'free', "updatedAt" = ? WHERE id = ?`
    )
      .bind(now, sub.id)
      .run();
    await resetDailyCredits(env, sub.userId);
  }
}

/**
 * Subscription deleted/cancelled
 */
async function handleSubscriptionCancelled(
  env: Env,
  data: Record<string, unknown>
): Promise<void> {
  const stripeSubId = data.id as string;

  const sub = await env.DB.prepare(
    `SELECT id, "userId" FROM "subscription" WHERE "stripeSubscriptionId" = ?`
  )
    .bind(stripeSubId)
    .first<{ id: string; userId: string }>();

  if (!sub) return;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE "subscription" SET status = 'cancelled', tier = 'free', "updatedAt" = ? WHERE id = ?`
  )
    .bind(now, sub.id)
    .run();

  await resetDailyCredits(env, sub.userId);
  console.log(`Subscription cancelled for user ${sub.userId}`);
}

/**
 * Invoice payment succeeded — extend subscription period
 */
async function handleInvoicePaymentSucceeded(
  env: Env,
  data: Record<string, unknown>
): Promise<void> {
  const stripeSubId = data.subscription as string | null;
  if (!stripeSubId) return;

  const billingReason = data.billing_reason as string;
  if (billingReason === "subscription_create") return;

  const sub = await env.DB.prepare(
    `SELECT id, "userId", "billingCycle" FROM "subscription" WHERE "stripeSubscriptionId" = ?`
  )
    .bind(stripeSubId)
    .first<{ id: string; userId: string; billingCycle: string }>();

  if (!sub) return;

  const now = new Date().toISOString();
  const end = new Date();
  end.setDate(end.getDate() + (sub.billingCycle === "yearly" ? 365 : 30));

  await env.DB.prepare(
    `UPDATE "subscription"
     SET "currentPeriodStart" = ?, "currentPeriodEnd" = ?, "updatedAt" = ?
     WHERE id = ?`
  )
    .bind(now, end.toISOString(), now, sub.id)
    .run();

  console.log(`Subscription period extended for user ${sub.userId}`);
}
