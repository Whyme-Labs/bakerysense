import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/components/**/*.test.tsx", "tests/unit/components/**/*.test.ts"],
    environment: "happy-dom",
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
