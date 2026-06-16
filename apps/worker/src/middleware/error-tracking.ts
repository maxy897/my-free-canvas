import type { Context, Next } from "hono";
import { generateRequestId, logError, ErrorCategory, getErrorMessage } from "../lib/error-handler";
import type { AppContext } from "../types";

/**
 * Middleware to track errors and add request IDs to responses
 * Should be used early in the middleware stack
 */
export async function errorTrackingMiddleware(
  c: Context<AppContext>,
  next: Next
): Promise<void> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Add request ID to context for use in error handlers
  c.set("requestId", requestId);

  // Add request ID to response headers
  c.res.headers.set("X-Request-ID", requestId);

  try {
    await next();

    // Log slow requests (> 5 seconds)
    const duration = Date.now() - startTime;
    if (duration > 5000) {
      console.warn(`[SLOW_REQUEST] ${c.req.method} ${c.req.path} took ${duration}ms`);
    }
  } catch (error) {
    // Log uncaught errors
    const message = getErrorMessage(error);
    const category = categorizeError(message);

    await logError(c.env, category, message, 500, {
      userId: c.get("userId"),
      path: c.req.path,
      method: c.req.method,
      requestId,
      error: error instanceof Error ? error : undefined,
    });

    throw error;
  }
}

/**
 * Categorize error based on message or type
 */
function categorizeError(message: string): ErrorCategory {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("invalid token") ||
    lowerMessage.includes("authentication")
  ) {
    return ErrorCategory.AUTHENTICATION;
  }

  if (
    lowerMessage.includes("forbidden") ||
    lowerMessage.includes("access denied") ||
    lowerMessage.includes("not authorized")
  ) {
    return ErrorCategory.AUTHORIZATION;
  }

  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("does not exist")
  ) {
    return ErrorCategory.NOT_FOUND;
  }

  if (lowerMessage.includes("rate limit") || lowerMessage.includes("too many")) {
    return ErrorCategory.RATE_LIMITED;
  }

  if (
    lowerMessage.includes("database") ||
    lowerMessage.includes("query") ||
    lowerMessage.includes("transaction")
  ) {
    return ErrorCategory.DATABASE;
  }

  if (
    lowerMessage.includes("payment") ||
    lowerMessage.includes("stripe") ||
    lowerMessage.includes("credit")
  ) {
    return ErrorCategory.PAYMENT;
  }

  if (
    lowerMessage.includes("external") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("network")
  ) {
    return ErrorCategory.EXTERNAL_SERVICE;
  }

  if (lowerMessage.includes("validation") || lowerMessage.includes("invalid")) {
    return ErrorCategory.VALIDATION;
  }

  return ErrorCategory.INTERNAL;
}

/**
 * Get request ID from context
 */
export function getRequestId(c: Context<AppContext>): string {
  return c.get("requestId") || generateRequestId();
}
