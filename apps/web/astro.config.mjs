import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      headers: {
        "Cache-Control": "no-store",
      },
    },
    optimizeDeps: {
      force: true,
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
});
