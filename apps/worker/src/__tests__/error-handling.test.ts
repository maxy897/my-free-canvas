import { describe, it, expect } from "vitest";
import {
  ErrorCategory,
  authenticationError,
  authorizationError,
  validationError,
  notFoundError,
  insufficientCreditsError,
  rateLimitError,
  externalServiceError,
  databaseError,
  internalServerError,
  createErrorResponse,
  generateRequestId,
  getErrorMessage,
} from "../lib/error-handler";

describe("Error Handler", () => {
  describe("Error creation helpers", () => {
    it("creates authentication error with correct status code", () => {
      const error = authenticationError("Invalid credentials");
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("AUTH_ERROR");
      expect(error.error).toContain("Invalid");
    });

    it("creates authorization error with correct status code", () => {
      const error = authorizationError("You do not have permission");
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("AUTHZ_ERROR");
      expect(error.error).toContain("permission");
    });

    it("creates validation error with details", () => {
      const error = validationError("Invalid request", { field: "email", reason: "Invalid format" });
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.details).toEqual({ field: "email", reason: "Invalid format" });
    });

    it("creates not found error", () => {
      const error = notFoundError("User");
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.error).toContain("User");
    });

    it("creates insufficient credits error with amounts", () => {
      const error = insufficientCreditsError(50, 30);
      expect(error.statusCode).toBe(402);
      expect(error.details).toEqual({ required: 50, available: 30 });
    });

    it("creates rate limit error with retry info", () => {
      const error = rateLimitError(60);
      expect(error.statusCode).toBe(429);
      expect(error.details).toEqual({ retryAfter: 60 });
    });

    it("creates external service error", () => {
      const error = externalServiceError("Stripe", "Payment gateway unavailable");
      expect(error.statusCode).toBe(503);
      expect(error.details).toEqual({ service: "Stripe" });
      expect(error.error).toContain("unavailable");
    });

    it("creates database error", () => {
      const error = databaseError("Connection timeout");
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe("DATABASE_ERROR");
    });

    it("creates internal server error", () => {
      const error = internalServerError("Something went wrong");
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("Custom error response creation", () => {
    it("creates error response with all fields", () => {
      const response = createErrorResponse(
        "Test error",
        "TEST_CODE",
        400,
        { extra: "data" },
        "req-123"
      );

      expect(response.error).toBe("Test error");
      expect(response.code).toBe("TEST_CODE");
      expect(response.statusCode).toBe(400);
      expect(response.details).toEqual({ extra: "data" });
      expect(response.requestId).toBe("req-123");
    });

    it("creates error response without optional fields", () => {
      const response = createErrorResponse("Simple error", "SIMPLE", 400);
      expect(response.error).toBe("Simple error");
      expect(response.requestId).toBeUndefined();
      expect(response.details).toBeUndefined();
    });
  });

  describe("Utility functions", () => {
    it("generates request IDs with unique format", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-f0-9-]+$/);
      expect(id2).toMatch(/^req_\d+_[a-f0-9-]+$/);
      expect(id1).not.toBe(id2);
    });

    it("extracts error message from Error object", () => {
      const error = new Error("Test error message");
      const message = getErrorMessage(error);
      expect(message).toBe("Test error message");
    });

    it("extracts error message from string", () => {
      const message = getErrorMessage("String error");
      expect(message).toBe("String error");
    });

    it("extracts error message from object with message property", () => {
      const error = { message: "Object error" };
      const message = getErrorMessage(error);
      expect(message).toBe("Object error");
    });

    it("returns default message for unknown error types", () => {
      const message = getErrorMessage(123);
      expect(message).toBe("Unknown error");
    });
  });

  describe("Error categories", () => {
    it("has all required error categories", () => {
      expect(ErrorCategory.AUTHENTICATION).toBe("AUTH_ERROR");
      expect(ErrorCategory.AUTHORIZATION).toBe("AUTHZ_ERROR");
      expect(ErrorCategory.VALIDATION).toBe("VALIDATION_ERROR");
      expect(ErrorCategory.NOT_FOUND).toBe("NOT_FOUND");
      expect(ErrorCategory.RATE_LIMITED).toBe("RATE_LIMIT");
      expect(ErrorCategory.EXTERNAL_SERVICE).toBe("EXTERNAL_SERVICE_ERROR");
      expect(ErrorCategory.DATABASE).toBe("DATABASE_ERROR");
      expect(ErrorCategory.PAYMENT).toBe("PAYMENT_ERROR");
      expect(ErrorCategory.INTERNAL).toBe("INTERNAL_ERROR");
    });
  });

  describe("HTTP status codes", () => {
    it("maps errors to correct HTTP status codes", () => {
      expect(authenticationError().statusCode).toBe(401);
      expect(authorizationError().statusCode).toBe(403);
      expect(validationError("").statusCode).toBe(400);
      expect(notFoundError("").statusCode).toBe(404);
      expect(insufficientCreditsError(0, 0).statusCode).toBe(402);
      expect(rateLimitError().statusCode).toBe(429);
      expect(externalServiceError("").statusCode).toBe(503);
      expect(databaseError().statusCode).toBe(500);
      expect(internalServerError().statusCode).toBe(500);
    });
  });
});
