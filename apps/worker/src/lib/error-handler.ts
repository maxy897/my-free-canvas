import type { Env } from "../types";

/**
 * Error categories for monitoring and alerting
 */
export enum ErrorCategory {
  AUTHENTICATION = "AUTH_ERROR",
  AUTHORIZATION = "AUTHZ_ERROR",
  VALIDATION = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMITED = "RATE_LIMIT",
  EXTERNAL_SERVICE = "EXTERNAL_SERVICE_ERROR",
  DATABASE = "DATABASE_ERROR",
  PAYMENT = "PAYMENT_ERROR",
  INTERNAL = "INTERNAL_ERROR",
}

export interface ErrorLog {
  timestamp: string;
  category: ErrorCategory;
  message: string;
  statusCode: number;
  userId?: string;
  path?: string;
  method?: string;
  requestId?: string;
  errorDetails?: Record<string, unknown>;
  stackTrace?: string;
}

/**
 * Structured logging for monitoring systems (Datadog, LogRocket, Sentry, etc.)
 */
export async function logError(
  env: Env,
  category: ErrorCategory,
  message: string,
  statusCode: number,
  metadata?: {
    userId?: string;
    path?: string;
    method?: string;
    requestId?: string;
    errorDetails?: Record<string, unknown>;
    error?: Error;
  }
): Promise<void> {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    category,
    message,
    statusCode,
    userId: metadata?.userId,
    path: metadata?.path,
    method: metadata?.method,
    requestId: metadata?.requestId,
    errorDetails: metadata?.errorDetails,
    stackTrace: metadata?.error?.stack,
  };

  // Log to console (for local development and basic CloudFlare logging)
  const logLevel = statusCode >= 500 ? "error" : "warn";
  console[logLevel as "error" | "warn"](`[${category}]`, errorLog);

  // Store critical errors in KV for later analysis
  if (statusCode >= 500 && env.KV) {
    try {
      const key = `error:${Date.now()}:${crypto.randomUUID()}`;
      await env.KV.put(
        key,
        JSON.stringify(errorLog),
        { expirationTtl: 86400 } // Keep for 24 hours
      );
    } catch (kvError) {
      console.error("Failed to log error to KV:", kvError);
    }
  }

  // Could integrate with external services here:
  // - Sentry: captureException(error)
  // - Datadog: sendMetric(category, 1)
  // - LogRocket: captureMessage(message)
}

/**
 * Common error scenarios with standard responses
 */

export interface ApiErrorResponse {
  error: string;
  code: string;
  statusCode: number;
  requestId?: string;
  details?: Record<string, unknown>;
}

export function createErrorResponse(
  message: string,
  code: string,
  statusCode: number,
  details?: Record<string, unknown>,
  requestId?: string
): ApiErrorResponse {
  return {
    error: message,
    code,
    statusCode,
    ...(requestId && { requestId }),
    ...(details && { details }),
  };
}

/**
 * Authentication error (401)
 */
export const authenticationError = (message = "Authentication required") =>
  createErrorResponse(message, "AUTH_ERROR", 401);

/**
 * Authorization error (403)
 */
export const authorizationError = (message = "Access denied") =>
  createErrorResponse(message, "AUTHZ_ERROR", 403);

/**
 * Validation error (400)
 */
export const validationError = (message: string, details?: Record<string, unknown>) =>
  createErrorResponse(message, "VALIDATION_ERROR", 400, details);

/**
 * Not found error (404)
 */
export const notFoundError = (resource: string) =>
  createErrorResponse(`${resource} not found`, "NOT_FOUND", 404);

/**
 * Insufficient credits error (402)
 */
export const insufficientCreditsError = (required: number, available: number) =>
  createErrorResponse(
    `Insufficient credits`,
    "INSUFFICIENT_CREDITS",
    402,
    { required, available }
  );

/**
 * Rate limit error (429)
 */
export const rateLimitError = (retryAfter?: number) =>
  createErrorResponse(
    "Too many requests",
    "RATE_LIMIT",
    429,
    retryAfter ? { retryAfter } : undefined
  );

/**
 * External service error (503)
 */
export const externalServiceError = (service: string, message?: string) =>
  createErrorResponse(
    message || `${service} service unavailable`,
    "EXTERNAL_SERVICE_ERROR",
    503,
    { service }
  );

/**
 * Database error (500)
 */
export const databaseError = (message = "Database operation failed") =>
  createErrorResponse(message, "DATABASE_ERROR", 500);

/**
 * Internal server error (500)
 */
export const internalServerError = (message = "Internal server error") =>
  createErrorResponse(message, "INTERNAL_ERROR", 500);

/**
 * Generate request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${crypto.randomUUID()}`;
}

/**
 * Helper to safely extract error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}
