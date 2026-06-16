/**
 * Tests for FAL.ai provider
 * Note: These tests use Deno's test runner
 * Run with: deno test --allow-net --allow-env providers/fal.test.ts
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Note: Actual FAL tests would require mocking the fetch API
// For now, we'll just test that the module can be imported

Deno.test("FAL provider module exports txt2img function", async () => {
  const { txt2img } = await import("./fal.ts");
  assertExists(txt2img);
  assertEquals(typeof txt2img, "function");
});

Deno.test("FAL provider module exports img2img function", async () => {
  const { img2img } = await import("./fal.ts");
  assertExists(img2img);
  assertEquals(typeof img2img, "function");
});

Deno.test("FAL provider module exports healthCheck function", async () => {
  const { healthCheck } = await import("./fal.ts");
  assertExists(healthCheck);
  assertEquals(typeof healthCheck, "function");
});

// Test that healthCheck returns false without API key
Deno.test("healthCheck returns false without FAL_API_KEY", async () => {
  // Remove FAL_API_KEY if it exists
  const existingKey = Deno.env.get("FAL_API_KEY");
  Deno.env.delete("FAL_API_KEY");

  try {
    const { healthCheck } = await import("./fal.ts");
    const result = await healthCheck();
    assertEquals(result, false);
  } finally {
    // Restore the key if it existed
    if (existingKey) {
      Deno.env.set("FAL_API_KEY", existingKey);
    }
  }
});
