import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { withCloudflare } from "better-auth-cloudflare";
import { genericOAuth } from "better-auth/plugins";
import { getOrCreateUserCredits } from "./credits";
import type { Env } from "../types";

/**
 * OAuth Provider Configuration
 */
export interface OAuthProvider {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectURI?: string;
  scope?: string[];
  discoveryUrl?: string;
}

export interface OAuthConfig {
  google?: OAuthProvider;
  github?: OAuthProvider;
  microsoft?: OAuthProvider;
  discord?: OAuthProvider;
  linuxdo?: OAuthProvider;
}

const LINUXDO_PROVIDER_ID = "linuxdo";
const LINUXDO_SYNTHETIC_EMAIL_DOMAIN = "linuxdo-connect.invalid";

function readPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function firstString(source: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

export function buildLinuxDoSyntheticEmail(subject: string): string {
  const safeSubject = subject.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  return `${LINUXDO_PROVIDER_ID}-${safeSubject}@${LINUXDO_SYNTHETIC_EMAIL_DOMAIN}`;
}

export function mapLinuxDoUserInfo(profile: unknown) {
  const subject = firstString(profile, ["sub", "id", "user_id", "uid", "user.id"]);
  if (!subject) return null;

  const username = firstString(profile, [
    "username",
    "preferred_username",
    "name",
    "user.username",
    "user.name",
  ]);
  const displayName = username || `LinuxDo User ${subject}`;
  const image = firstString(profile, [
    "avatar",
    "avatar_url",
    "image",
    "picture",
    "user.avatar",
    "user.avatar_url",
    "user.image",
  ]);

  return {
    id: subject,
    email: buildLinuxDoSyntheticEmail(subject),
    name: displayName,
    image,
    emailVerified: false,
  };
}

/**
 * Build OAuth configuration from environment variables
 */
export function buildOAuthConfig(env: Env, baseURL: string): OAuthConfig {
  const config: OAuthConfig = {};

  // Google OAuth
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    config.google = {
      enabled: true,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectURI: `${baseURL}/api/auth/callback/google`,
    };
  }

  // GitHub OAuth
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    config.github = {
      enabled: true,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      redirectURI: `${baseURL}/api/auth/callback/github`,
      scope: ["user:email"],
    };
  }

  // Microsoft OAuth
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    config.microsoft = {
      enabled: true,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      redirectURI: `${baseURL}/api/auth/callback/microsoft`,
      scope: ["openid", "profile", "email"],
    };
  }

  // Discord OAuth
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    config.discord = {
      enabled: true,
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectURI: `${baseURL}/api/auth/callback/discord`,
      scope: ["identify", "email"],
    };
  }

  // LinuxDo Connect OAuth
  if (env.LINUXDO_CLIENT_ID && env.LINUXDO_CLIENT_SECRET) {
    config.linuxdo = {
      enabled: true,
      clientId: env.LINUXDO_CLIENT_ID,
      clientSecret: env.LINUXDO_CLIENT_SECRET,
      redirectURI:
        env.LINUXDO_REDIRECT_URI ||
        `${baseURL}/api/auth/oauth2/callback/${LINUXDO_PROVIDER_ID}`,
      scope: (env.LINUXDO_SCOPES || "user")
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    };
  }

  return config;
}

/**
 * Build social providers configuration for better-auth
 */
function buildSocialProviders(oauthConfig: OAuthConfig) {
  const providers: Record<string, any> = {};

  if (oauthConfig.google?.enabled) {
    providers.google = {
      clientId: oauthConfig.google.clientId,
      clientSecret: oauthConfig.google.clientSecret,
      redirectURI: oauthConfig.google.redirectURI,
    };
  }

  if (oauthConfig.github?.enabled) {
    providers.github = {
      clientId: oauthConfig.github.clientId,
      clientSecret: oauthConfig.github.clientSecret,
      redirectURI: oauthConfig.github.redirectURI,
    };
  }

  if (oauthConfig.microsoft?.enabled) {
    providers.microsoft = {
      clientId: oauthConfig.microsoft.clientId,
      clientSecret: oauthConfig.microsoft.clientSecret,
      redirectURI: oauthConfig.microsoft.redirectURI,
    };
  }

  if (oauthConfig.discord?.enabled) {
    providers.discord = {
      clientId: oauthConfig.discord.clientId,
      clientSecret: oauthConfig.discord.clientSecret,
      redirectURI: oauthConfig.discord.redirectURI,
    };
  }

  return providers;
}

function buildGenericOAuthPlugins(env: Env, oauthConfig: OAuthConfig) {
  if (!oauthConfig.linuxdo?.enabled) {
    return [];
  }

  return [
    genericOAuth({
      config: [
        {
          providerId: LINUXDO_PROVIDER_ID,
          clientId: oauthConfig.linuxdo.clientId as string,
          clientSecret: oauthConfig.linuxdo.clientSecret as string,
          authorizationUrl:
            env.LINUXDO_AUTHORIZE_URL ||
            "https://connect.linux.do/oauth2/authorize",
          tokenUrl:
            env.LINUXDO_TOKEN_URL || "https://connect.linux.do/oauth2/token",
          userInfoUrl:
            env.LINUXDO_USERINFO_URL || "https://connect.linux.do/api/user",
          scopes: oauthConfig.linuxdo.scope || ["user"],
          redirectURI: oauthConfig.linuxdo.redirectURI,
          pkce: env.LINUXDO_USE_PKCE !== "false",
          authentication:
            env.LINUXDO_TOKEN_AUTH_METHOD === "client_secret_basic"
              ? "basic"
              : "post",
          getUserInfo: async (tokens) => {
            const accessToken = tokens.accessToken;
            const response = await fetch(
              env.LINUXDO_USERINFO_URL || "https://connect.linux.do/api/user",
              {
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!response.ok) {
              throw new Error(`LinuxDo userinfo request failed: ${response.status}`);
            }

            const profile = await response.json();
            const userInfo = mapLinuxDoUserInfo(profile);
            if (!userInfo) {
              throw new Error("LinuxDo userinfo response did not include a subject");
            }
            return userInfo;
          },
        },
      ],
    }),
  ];
}

/**
 * Create enhanced authentication with multiple OAuth providers
 */
export function createAuthEnhanced(env: Env, cf: any, baseURL: string) {
  const oauthConfig = buildOAuthConfig(env, baseURL);
  const socialProviders = buildSocialProviders(oauthConfig);
  const genericOAuthPlugins = buildGenericOAuthPlugins(env, oauthConfig);

  // Build trusted origins (allow multiple frontend URLs)
  const trustedOrigins = [
    env.FRONTEND_URL,
    "http://localhost:4321",
    "http://localhost:3000",
    ...(env.ADDITIONAL_TRUSTED_ORIGINS?.split(",").map(url => url.trim()) || []),
  ].filter(Boolean);

  return betterAuth({
    baseURL,
    ...withCloudflare(
      {
        d1Native: env.DB,
        cf: cf || {},
        kv: env.KV as any,
      },
      {
        socialProviders,
        trustedOrigins,
        advanced: {
          cookiePrefix: env.ENVIRONMENT === "development" ? "free-canvas-dev" : "better-auth",
        },
        // Additional security settings
        disableRedirectValidation: false,
        sessionConfig: {
          expiresIn: 7 * 24 * 60 * 60, // 7 days
          updateAge: 24 * 60 * 60, // Update every day
          absoluteTimeout: 30 * 24 * 60 * 60, // 30 days absolute
        },
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: false,
          minPasswordLength: 8,
          maxPasswordLength: 128,
        },
      }
    ),
    secret: env.BETTER_AUTH_SECRET,
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const userId = ctx.context.newSession?.user.id;
        if (!userId) return;

        try {
          await getOrCreateUserCredits(env, userId);
        } catch (error) {
          console.error("Failed to initialize welcome credits:", error);
        }
      }),
    },
    // Keep write-heavy auth flows protected without throttling routine session checks.
    rateLimit: {
      window: 60, // Better Auth expects seconds.
      max: 100,
      customRules: {
        "/get-session": false,
      },
    },
    plugins: genericOAuthPlugins,
  });
}

/**
 * Get available OAuth providers for frontend
 */
export function getAvailableProviders(env: Env): {
  provider: string;
  name: string;
  icon: string;
}[] {
  const providers = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({
      provider: "google",
      name: "Google",
      icon: "google",
    });
  }

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push({
      provider: "github",
      name: "GitHub",
      icon: "github",
    });
  }

  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    providers.push({
      provider: "microsoft",
      name: "Microsoft",
      icon: "microsoft",
    });
  }

  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    providers.push({
      provider: "discord",
      name: "Discord",
      icon: "discord",
    });
  }

  if (env.LINUXDO_CLIENT_ID && env.LINUXDO_CLIENT_SECRET) {
    providers.push({
      provider: LINUXDO_PROVIDER_ID,
      name: "LinuxDo",
      icon: LINUXDO_PROVIDER_ID,
    });
  }

  return providers;
}

export type Auth = ReturnType<typeof createAuthEnhanced>;
