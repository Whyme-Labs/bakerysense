import { inject, beforeAll } from "vitest";
import { env } from "cloudflare:test";

// Augment ProvidedContext so inject is type-safe (must match globalSetup.ts).
declare module "vitest" {
	interface ProvidedContext {
		migrations: import("@cloudflare/vitest-pool-workers").D1Migration[];
	}
}

// Augment CloudflareEnv so env.MIGRATIONS is recognised.
declare global {
	interface CloudflareEnv {
		MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
	}
}

// Inject the migrations read on the Node.js/pool side into the Worker env.
beforeAll(() => {
	const migrations = inject("migrations");
	if (migrations) {
		(env as unknown as Record<string, unknown>).MIGRATIONS = migrations;
	}
});
