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

// Augment Cloudflare.Env so `env` from cloudflare:test (typed as Cloudflare.Env) carries DB, MIGRATIONS + secrets.
declare global {
	namespace Cloudflare {
		interface Env {
			DB: D1Database;
			KV: KVNamespace;
			JWKS_ENCRYPTION_KEY: string;
			CONNECTOR_MEK: string;
			SESSION_SIGNING_KEY: string;
			OPENROUTER_API_KEY?: string;
			OPENROUTER_OAUTH_CLIENT_ID?: string;
			OPENROUTER_OAUTH_CLIENT_SECRET?: string;
			OPS_ROTATE_SECRET?: string;
			MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
		}
	}
}

// Inject the migrations read on the Node.js/pool side into the Worker env.
beforeAll(() => {
	const migrations = inject("migrations");
	if (migrations) {
		(env as unknown as Record<string, unknown>).MIGRATIONS = migrations;
	}
});
