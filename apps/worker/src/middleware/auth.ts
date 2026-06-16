import { createMiddleware } from "hono/factory";
import { getAuthBaseURL } from "../lib/auth-base-url";
import { createAuthEnhanced } from "../lib/auth-enhanced";
import type { Env } from "../types";

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { userId: string; userName: string };
}>(async (c, next) => {
  // Test-only bypass: allow setting user via header in test environment
  if (c.env.ENVIRONMENT === "test") {
    const testUserId = c.req.header("x-test-user-id");
    if (testUserId) {
      c.set("userId", testUserId);
      c.set("userName", c.req.header("x-test-user-name") || "Test User");
      return next();
    }
  }

  const auth = createAuthEnhanced(
    c.env,
    (c.req.raw as any).cf || {},
    getAuthBaseURL(c.env, c.req.url)
  );
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", session.user.id);
  c.set("userName", session.user.name);
  await next();
});
