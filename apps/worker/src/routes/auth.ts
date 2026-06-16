import { Hono } from "hono";
import { createAuthEnhanced, getAvailableProviders } from "../lib/auth-enhanced";
import { getAuthBaseURL } from "../lib/auth-base-url";
import {
  getRegistrationSettings,
  isRegistrationDisabledError,
} from "../lib/registration-settings";
import type { Env } from "../types";

export const authRoutes = new Hono<{ Bindings: Env }>();

// OAuth provider discovery endpoint
authRoutes.get("/providers", async (c) => {
  const providers = getAvailableProviders(c.env);
  const settings = await getRegistrationSettings(c.env);
  return c.json({ providers, ...settings });
});

// Main auth handler
authRoutes.all("/*", async (c) => {
  const auth = createAuthEnhanced(
    c.env,
    (c.req.raw as any).cf || {},
    getAuthBaseURL(c.env, c.req.url)
  );
  try {
    return await auth.handler(c.req.raw);
  } catch (e: any) {
    if (isRegistrationDisabledError(e)) {
      return c.json(
        {
          error: "Registration is currently disabled",
          code: "REGISTRATION_DISABLED",
        },
        403
      );
    }

    console.error("Auth error:", e?.message, e?.stack);
    return c.json({ error: e?.message, stack: e?.stack }, 500);
  }
});
