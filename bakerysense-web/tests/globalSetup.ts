import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Augment ProvidedContext so inject/provide are type-safe.
declare module "vitest" {
	interface ProvidedContext {
		migrations: D1Migration[];
	}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup(ctx: { provide<T extends keyof import("vitest").ProvidedContext & string>(key: T, value: import("vitest").ProvidedContext[T]): void }) {
	const migrationsPath = path.resolve(__dirname, "../drizzle");
	const migrations = await readD1Migrations(migrationsPath);
	ctx.provide("migrations", migrations);
}
