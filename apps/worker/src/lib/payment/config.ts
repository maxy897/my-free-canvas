/**
 * Stripe Payment Configuration
 *
 * Maps internal IDs to Stripe Price IDs and provides lookup helpers.
 */

import { PRICING } from "@shared/types";
import type { Env } from "../../types";

export interface StripePriceMap {
  testPack: string;
  starterPack: string;
  standardPack: string;
  proPack: string;
  pro_monthly: string;
  pro_yearly: string;
  premium_monthly: string;
  premium_yearly: string;
}

/** Credit amounts for each pack (derived from shared PRICING constant) */
export const PACK_CREDITS: Record<string, number> = {
  testPack: PRICING.testPack.credits,
  starterPack: PRICING.starterPack.credits,
  standardPack: PRICING.standardPack.credits,
  proPack: PRICING.proPack.credits,
};

/** Reverse lookup: given a Stripe metadata tier+billing, get the subscription info */
export const SUBSCRIPTION_TIER_MAP: Record<
  string,
  { tier: "pro" | "premium"; billing: "monthly" | "yearly" }
> = {
  pro_monthly: { tier: "pro", billing: "monthly" },
  pro_yearly: { tier: "pro", billing: "yearly" },
  premium_monthly: { tier: "premium", billing: "monthly" },
  premium_yearly: { tier: "premium", billing: "yearly" },
};

/** Load Stripe Price map from KV (set once by scripts/stripe-setup.ts) */
export async function getStripePriceMap(env: Env): Promise<StripePriceMap> {
  const cached = await env.KV.get("stripe:price_map", "json");
  if (!cached) {
    throw new Error(
      "Stripe price map not configured. Run: npx tsx scripts/stripe-setup.ts"
    );
  }
  return cached as StripePriceMap;
}
