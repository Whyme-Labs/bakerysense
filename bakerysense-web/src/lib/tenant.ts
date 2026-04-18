import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, memberships, branchAccess } from "@/db/schema";

export async function resolveTenantBySlug(
	env: CloudflareEnv,
	slug: string,
): Promise<typeof tenants.$inferSelect | null> {
	const db = getDb(env);
	const row = await db.select().from(tenants).where(eq(tenants.slug, slug)).get();
	return row ?? null;
}

export async function loadMembership(
	env: CloudflareEnv,
	userId: string,
	tenantId: string,
): Promise<typeof memberships.$inferSelect | null> {
	const db = getDb(env);
	const row = await db
		.select()
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
		.get();
	return row ?? null;
}

export async function loadPermittedBranches(
	env: CloudflareEnv,
	membershipId: string,
): Promise<string[] | null> {
	const db = getDb(env);
	const rows = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, membershipId)).all();
	return rows.length === 0 ? null : rows.map((r) => r.branchId);
}
