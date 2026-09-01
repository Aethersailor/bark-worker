import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./worker/src", import.meta.url).href),
    },
  },
  test: {
    include: ["worker/test-integration/**/*.test.ts"],
  },
});
