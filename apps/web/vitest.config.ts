import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared/types": path.resolve(__dirname, "../../packages/shared/src/types"),
    },
  },
});
