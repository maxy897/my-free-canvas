/**
 * Stripe Payment Provider Integration
 *
 * Uses Stripe REST API directly (no SDK) for Cloudflare Workers compatibility.
 */

import type { Env } from "../../types";
import { getStripePriceMap, PACK_CREDITS } from "./config";

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
}

// --- Helpers ---

function getStripeHeaders(secretKey: string) {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

// --- Webhook Signature Verification ---

/**
 * Verify Stripe webhook signature using Web Crypto API.
 * Stripe-Signature header format: t=<timestamp>,v1=<hash>
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<boolean> {
  try {
    const parts = signature.split(",");
    const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
    const v1Hash = parts.find((p) => p.startsWith("v1="))?.slice(3);

    if (!timestamp || !v1Hash) return false;

    // Reject if older than 5 minutes (replay protection)
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > 300) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${payload}`)
    );

    const expected = Array.from(new Uint8Array(signed))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (expected.length !== v1Hash.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ v1Hash.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

// --- Checkout Sessions ---

/**
 * Create Stripe Checkout Session for one-time credit pack purchase.
 */
export async function createCheckoutSession(
  env: Env,
  userId: string,
  email: string,
  packId: string,
  successUrl: string,
  cancelUrl: string
): Promise<StripeCheckoutSession> {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

  const priceMap = await getStripePriceMap(env);
  const priceId = priceMap[packId as keyof typeof priceMap];
  if (!priceId) throw new Error(`No Stripe price for pack: ${packId}`);

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("payment_method_types[]", "card");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${successUrl}?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", cancelUrl);
  params.append("customer_email", email);
  params.append("metadata[userId]", userId);
  params.append("metadata[packId]", packId);
  params.append("metadata[credits]", String(PACK_CREDITS[packId] || 0));

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: getStripeHeaders(stripeKey),
    body: params,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Stripe checkout error: ${err}`);
  }

  return (await response.json()) as StripeCheckoutSession;
}

/**
 * Create Stripe Checkout Session for subscription.
 */
export async function createSubscriptionCheckoutSession(
  env: Env,
  userId: string,
  email: string,
  tier: string,
  billing: string,
  successUrl: string,
  cancelUrl: string
): Promise<StripeCheckoutSession> {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

  const priceMap = await getStripePriceMap(env);
  const priceKey = `${tier}_${billing}` as keyof typeof priceMap;
  const priceId = priceMap[priceKey];
  if (!priceId) throw new Error(`No Stripe price for: ${priceKey}`);

  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("payment_method_types[]", "card");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", cancelUrl);
  params.append("customer_email", email);
  params.append("metadata[userId]", userId);
  params.append("metadata[tier]", tier);
  params.append("metadata[billing]", billing);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: getStripeHeaders(stripeKey),
    body: params,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Stripe subscription checkout error: ${err}`);
  }

  return (await response.json()) as StripeCheckoutSession;
}

/**
 * Cancel a Stripe subscription.
 */
export async function cancelStripeSubscription(
  env: Env,
  stripeSubscriptionId: string
): Promise<void> {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return;

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`,
    {
      method: "DELETE",
      headers: getStripeHeaders(stripeKey),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error(`Failed to cancel Stripe subscription: ${err}`);
  }
}

/**
 * Retrieve a Stripe Checkout Session by ID.
 * Used to verify payment status when user returns from checkout.
 */
export async function retrieveCheckoutSession(
  env: Env,
  sessionId: string
): Promise<Record<string, unknown> | null> {
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return null;

  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    { headers: getStripeHeaders(stripeKey) }
  );

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}
