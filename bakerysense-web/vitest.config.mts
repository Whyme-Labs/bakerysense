import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
		}),
	],
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/unit/**"],
		testTimeout: 30000,
		globalSetup: ["tests/globalSetup.ts"],
		setupFiles: ["tests/vitestSetup.ts"],
	},
	resolve: {
		alias: { "@": "/src" },
	},
});
