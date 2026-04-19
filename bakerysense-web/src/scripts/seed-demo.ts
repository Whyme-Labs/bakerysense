import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
	tenants,
	users,
	memberships,
	branches,
	branchAccess,
	dailyActuals,
	forecastSnapshots,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/argon2";
import { createConnector, setDefaultConnector, listConnectors } from "@/lib/connector";

const DEMO_SLUG = "favorita";
const DEMO_NAME = "Favorita";
const DEMO_VERTICAL = "bakery";
const DEMO_BRANCHES = [
	{ name: "Quito Centro", city: "Quito" },
	{ name: "Quito Norte", city: "Quito" },
	{ name: "Guayaquil Urdesa", city: "Guayaquil" },
	{ name: "Guayaquil Centro", city: "Guayaquil" },
	{ name: "Cuenca Rural", city: "Cuenca" },
];
const DEMO_FAMILIES = ["TRADITIONAL BAGUETTE", "CROISSANT", "PAIN AU CHOCOLAT"];
const DEMO_ADMIN = { email: "demo@bakerysense.app", password: "Demo2026DemoDemo" };
const DEMO_MANAGER = { email: "manager@bakerysense.app", password: "Manager2026Manager" };

function newId(prefix: string): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `${prefix}_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

// Tiny deterministic LCG for synthetic values (fixed seed, same output every run)
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

async function upsertTenant(env: CloudflareEnv): Promise<string> {
	const db = getDb(env);
	const existing = await db.select().from(tenants).where(eq(tenants.slug, DEMO_SLUG)).get();
	if (existing) return existing.id;
	const id = newId("tnt");
	await db.insert(tenants).values({
		id,
		slug: DEMO_SLUG,
		name: DEMO_NAME,
		vertical: DEMO_VERTICAL,
		plan: "free",
		createdAt: Date.now(),
	});
	return id;
}

async function upsertUser(
	env: CloudflareEnv,
	email: string,
	password: string,
): Promise<string> {
	const db = getDb(env);
	const existing = await db.select().from(users).where(eq(users.email, email)).get();
	if (existing) return existing.id;
	const id = newId("usr");
	const passwordHash = await hashPassword(password);
	await db.insert(users).values({
		id,
		email,
		passwordHash,
		emailVerified: 1,
		createdAt: Date.now(),
	});
	return id;
}

async function upsertMembership(
	env: CloudflareEnv,
	userId: string,
	tenantId: string,
	role: "tenant_admin" | "branch_manager",
): Promise<string> {
	const db = getDb(env);
	const existing = await db
		.select()
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
		.get();
	if (existing) return existing.id;
	const id = newId("mbr");
	await db.insert(memberships).values({ id, userId, tenantId, role, createdAt: Date.now() });
	return id;
}

async function upsertBranch(
	env: CloudflareEnv,
	tenantId: string,
	name: string,
	city: string,
): Promise<string> {
	const db = getDb(env);
	const existing = await db
		.select()
		.from(branches)
		.where(and(eq(branches.tenantId, tenantId), eq(branches.name, name)))
		.get();
	if (existing) return existing.id;
	const id = newId("brn");
	await db.insert(branches).values({ id, tenantId, name, city, createdAt: Date.now() });
	return id;
}

async function ensureConnector(env: CloudflareEnv, tenantId: string): Promise<string> {
	const list = await listConnectors(env, tenantId);
	if (list.length > 0) return list[0].id;
	const conn = await createConnector(env, tenantId, {
		preset: "openrouter",
		label: "OpenRouter (demo)",
		baseUrl: "https://openrouter.ai/api/v1",
		model: "google/gemma-4-e4b-it",
		authMethod: "api_key",
		credential: "sk-or-seed-demo-REPLACE-ME",
	});
	await setDefaultConnector(env, tenantId, conn.id);
	return conn.id;
}

async function seedActualsAndSnapshots(
	env: CloudflareEnv,
	tenantId: string,
	branchIds: string[],
): Promise<number> {
	const db = getDb(env);
	const rand = lcg(42);
	let count = 0;
	const today = new Date();
	for (let d = 0; d < 30; d++) {
		const date = new Date(today.getTime() - d * 86400_000).toISOString().slice(0, 10);
		for (const branchId of branchIds) {
			for (const family of DEMO_FAMILIES) {
				const predicted = Math.round(100 + rand() * 20);
				const actual = Math.round(predicted * (0.9 + rand() * 0.2));
				await db
					.insert(dailyActuals)
					.values({
						id: newId("act"),
						tenantId,
						branchId,
						family,
						date,
						actualBake: predicted,
						actualSales: actual,
						wasteUnits: Math.max(predicted - actual, 0),
						recommendedBake: predicted,
						source: "manual",
						capturedByUserId: null,
						capturedAt: Date.now(),
					})
					.onConflictDoNothing();
				await db
					.insert(forecastSnapshots)
					.values({
						id: newId("fcs"),
						tenantId,
						branchId,
						family,
						date,
						modelVersion: 0,
						bakeQuantity: predicted,
						quantilesJson: JSON.stringify({
							"q0.1": Math.round(predicted * 0.85),
							"q0.3": Math.round(predicted * 0.93),
							"q0.5": predicted,
							"q0.7": Math.round(predicted * 1.08),
							"q0.9": Math.round(predicted * 1.18),
						}),
						servedAt: Date.now(),
					})
					.onConflictDoNothing();
				count += 1;
			}
		}
	}
	return count;
}

export async function seedDemo(env: CloudflareEnv): Promise<{
	tenantId: string;
	tenantSlug: string;
	adminUserId: string;
	managerUserId: string;
	branchIds: string[];
	connectorId: string;
	seededRows: number;
}> {
	const tenantId = await upsertTenant(env);
	const adminUserId = await upsertUser(env, DEMO_ADMIN.email, DEMO_ADMIN.password);
	const managerUserId = await upsertUser(env, DEMO_MANAGER.email, DEMO_MANAGER.password);
	await upsertMembership(env, adminUserId, tenantId, "tenant_admin");
	const managerMembershipId = await upsertMembership(
		env,
		managerUserId,
		tenantId,
		"branch_manager",
	);
	const branchIds: string[] = [];
	for (const b of DEMO_BRANCHES) {
		branchIds.push(await upsertBranch(env, tenantId, b.name, b.city));
	}
	// Manager gets branch_access to first 2 branches only
	const db = getDb(env);
	for (let i = 0; i < 2; i++) {
		await db
			.insert(branchAccess)
			.values({
				membershipId: managerMembershipId,
				branchId: branchIds[i],
			})
			.onConflictDoNothing();
	}
	const connectorId = await ensureConnector(env, tenantId);
	const seededRows = await seedActualsAndSnapshots(env, tenantId, branchIds);
	return {
		tenantId,
		tenantSlug: DEMO_SLUG,
		adminUserId,
		managerUserId,
		branchIds,
		connectorId,
		seededRows,
	};
}
