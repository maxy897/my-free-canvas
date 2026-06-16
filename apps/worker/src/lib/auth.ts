import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import type { Env } from "../types";

export function createAuth(env: Env, cf: any, baseURL: string) {
  return betterAuth({
    baseURL,
    ...withCloudflare(
      {
        d1Native: env.DB,
        cf: cf || {},
        kv: env.KV as any,
      },
      {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID || "",
            clientSecret: env.GOOGLE_CLIENT_SECRET || "",
            redirectURI: `${baseURL}/api/auth/callback/google`,
          },
        },
        trustedOrigins: [
          env.FRONTEND_URL,
          "http://localhost:4321",
        ],
      }
    ),
    secret: env.BETTER_AUTH_SECRET,
  });
}

export type Auth = ReturnType<typeof createAuth>;
