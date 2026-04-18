import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = DrizzleD1Database<typeof schema>;

export function getDb(env: CloudflareEnv): DB {
	return drizzle(env.DB, { schema });
}
