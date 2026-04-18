import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { resolveTenantBySlug } from "@/lib/tenant";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";

describe("tenant slug resolution", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		const db = getDb(env);
		await db.delete(tenants);
		await db.insert(tenants).values({
			id: "tid-abc", slug: "favorita", name: "Favorita", vertical: "bakery", plan: "free",
			createdAt: Date.now(),
		});
	});
	it("finds by slug", async () => {
		const t = await resolveTenantBySlug(env, "favorita");
		expect(t?.id).toBe("tid-abc");
	});
	it("returns null for unknown slug", async () => {
		const t = await resolveTenantBySlug(env, "nope");
		expect(t).toBeNull();
	});
});
