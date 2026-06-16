export interface Env {
  // D1 Database
  DB: D1Database;
  // KV Namespace
  KV: KVNamespace;
  // R2 Bucket (optional — enable if your SaaS needs file storage)
  R2: R2Bucket;
  // Environment
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  // Auth (Better Auth)
  BETTER_AUTH_SECRET: string;
  // OAuth Providers
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  LINUXDO_CLIENT_ID?: string;
  LINUXDO_CLIENT_SECRET?: string;
  LINUXDO_AUTHORIZE_URL?: string;
  LINUXDO_TOKEN_URL?: string;
  LINUXDO_USERINFO_URL?: string;
  LINUXDO_SCOPES?: string;
  LINUXDO_REDIRECT_URI?: string;
  LINUXDO_TOKEN_AUTH_METHOD?: string;
  LINUXDO_USE_PKCE?: string;
  // Additional trusted origins (comma-separated)
  ADDITIONAL_TRUSTED_ORIGINS?: string;
  // Payment (Stripe)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  // R2 public custom domain (enables 302 redirect instead of proxy)
  R2_PUBLIC_URL?: string;
  // Canvas: Deno Relay
  DENO_RELAY_URL?: string;
  DENO_SECRET?: string;
  CANVAS_WEBHOOK_BASE_URL?: string;
  // Canvas: Telegram Bot (file storage)
  TELEGRAM_BOT_TOKEN?: string;
  // External asset service (server-side upload proxy)
  ASSET_SERVICE_URL?: string;
  ASSET_SERVICE_API_KEY?: string;
}

export interface Variables {
  requestId: string;
  userId?: string;
  userName?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: Variables;
};
