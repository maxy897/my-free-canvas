import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorTrackingMiddleware } from "./middleware/error-tracking";
import { authRoutes } from "./routes/auth";
import { creditsRoutes } from "./routes/credits";
import { subscriptionRoutes } from "./routes/subscription";
import { paymentRoutes } from "./routes/payments";
import { webhookRoutes } from "./routes/webhooks";
import { quotaRoutes } from "./routes/quota";
import { canvasRoutes } from "./routes/canvas";
import { canvasTaskRoutes } from "./routes/canvas-tasks";
import { canvasWebhookRoutes } from "./routes/canvas-webhooks";
import { canvasFileRoutes } from "./routes/canvas-files";
import { redeemRoutes } from "./routes/redeem";
import { promptTemplateRoutes } from "./routes/prompt-templates";
import { announcementRoutes } from "./routes/announcements";
import { getErrorMessage, internalServerError } from "./lib/error-handler";
import type { AppContext, Env } from "./types";

const app = new Hono<AppContext>();

// Error tracking and request ID middleware (first in chain)
app.use("*", errorTrackingMiddleware);

// CORS
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = [
        c.env.FRONTEND_URL,
        "http://localhost:4321",
      ].filter(Boolean);
      return allowed.includes(origin) ? origin : allowed[0];
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/api/health", (c) =>
  c.json({ status: "ok", version: "0.1.0", ts: Date.now() })
);

// Global error handler
app.onError(async (err, c) => {
  const requestId = c.get("requestId");
  const message = getErrorMessage(err);

  console.error("Unhandled error:", {
    message,
    stack: err?.stack?.split("\n").slice(0, 5),
    requestId,
    path: c.req.path,
    method: c.req.method,
  });

  const errorResponse = internalServerError(
    c.env.ENVIRONMENT === "production"
      ? "Internal server error"
      : message
  );

  return c.json(
    {
      ...errorResponse,
      requestId,
    },
    500
  );
});

// Routes
app.route("/api/auth", authRoutes);
app.route("/api/credits", creditsRoutes);
app.route("/api/subscription", subscriptionRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/webhooks", webhookRoutes);
app.route("/api/quota", quotaRoutes);
app.route("/api/canvas/tasks", canvasTaskRoutes);
app.route("/api/canvas/webhooks", canvasWebhookRoutes);
app.route("/api/canvas/files", canvasFileRoutes);
app.route("/api/canvas", canvasRoutes);
app.route("/api/redeem", redeemRoutes);
app.route("/api/prompt-templates", promptTemplateRoutes);
app.route("/api/announcements", announcementRoutes);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    // Add your scheduled tasks here (e.g. expire trials, send reminders)
  },
};
