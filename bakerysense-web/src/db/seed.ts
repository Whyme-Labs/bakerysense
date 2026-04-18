import { getDb } from "./client";
import { tenants, users, memberships, branches, branchAccess } from "./schema";
import { hashPassword } from "@/lib/auth/argon2";

const DEMO = {
	tenant: { id: "ten_favorita", slug: "favorita", name: "La Boulangerie Favorita", vertical: "bakery", plan: "free" },
	admin:   { id: "usr_demoadmin",   email: "demo@bakerysense.app",     password: "Demo2026Demo!", role: "tenant_admin" as const },
	manager: { id: "usr_democlerk",   email: "manager@bakerysense.app",  password: "Manager2026!", role: "branch_manager" as const },
	branches: [
		{ id: "brn_quito_1", name: "Quito Centro",   city: "Quito",     cluster: "A", type: "urban" },
		{ id: "brn_quito_2", name: "Quito Norte",    city: "Quito",     cluster: "B", type: "urban" },
		{ id: "brn_guay_1",  name: "Guayaquil Sur",  city: "Guayaquil", cluster: "B", type: "urban" },
		{ id: "brn_guay_2",  name: "Guayaquil Malecón", city: "Guayaquil", cluster: "A", type: "tourist" },
		{ id: "brn_rural_1", name: "Santo Domingo",  city: "Santo Domingo", cluster: "C", type: "rural" },
	],
};

export async function seedDemo(env: CloudflareEnv): Promise<void> {
	const db = getDb(env);
	const now = Date.now();

	await db.insert(tenants).values({ ...DEMO.tenant, createdAt: now }).onConflictDoNothing();

	for (const b of DEMO.branches) {
		await db.insert(branches).values({ ...b, tenantId: DEMO.tenant.id, createdAt: now }).onConflictDoNothing();
	}

	await db.insert(users).values({
		id: DEMO.admin.id,
		email: DEMO.admin.email,
		passwordHash: await hashPassword(DEMO.admin.password),
		emailVerified: 1,
		createdAt: now,
	}).onConflictDoNothing();

	await db.insert(users).values({
		id: DEMO.manager.id,
		email: DEMO.manager.email,
		passwordHash: await hashPassword(DEMO.manager.password),
		emailVerified: 1,
		createdAt: now,
	}).onConflictDoNothing();

	const adminMembership = { id: "mem_admin", userId: DEMO.admin.id, tenantId: DEMO.tenant.id, role: DEMO.admin.role, createdAt: now };
	const managerMembership = { id: "mem_manager", userId: DEMO.manager.id, tenantId: DEMO.tenant.id, role: DEMO.manager.role, createdAt: now };
	await db.insert(memberships).values(adminMembership).onConflictDoNothing();
	await db.insert(memberships).values(managerMembership).onConflictDoNothing();

	// manager restricted to 2 branches
	await db.insert(branchAccess).values([
		{ membershipId: managerMembership.id, branchId: "brn_quito_1" },
		{ membershipId: managerMembership.id, branchId: "brn_guay_1" },
	]).onConflictDoNothing();
}
