import { Hono } from "hono";
import type { Env } from "../types";
import { verifyWebhookSignature } from "../lib/payment/stripe";
import { processPaymentWebhook } from "../lib/payment/webhooks";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// POST /api/webhooks/stripe - Stripe webhook handler
webhookRoutes.post("/stripe", async (c) => {
  try {
    const payload = await c.req.text();
    const signature = c.req.header("stripe-signature");

    if (!signature) {
      return c.json({ error: "Missing signature" }, 401);
    }

    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return c.json({ error: "Webhook secret not configured" }, 500);
    }

    const isValid = await verifyWebhookSignature(payload, signature, webhookSecret);
    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(payload) as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    await processPaymentWebhook(c.env, "stripe", {
      type: event.type,
      data: event.data.object,
      timestamp: Date.now(),
    });

    return c.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});
