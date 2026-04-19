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

// Minimal synthetic forecast bundle — lets the dashboard + forecast tools
// return non-empty results without requiring a trained Python model uploaded
// to R2. Each quantile is a single-leaf tree returning a per-family base.
// For a real demo, `scripts/seed_demo_bundle.py` produces the proper
// LightGBM-trained bundle; this is the "just make it work" fallback.
const FAMILY_BASE: Record<string, number> = {
	"TRADITIONAL BAGUETTE": 140,
	"CROISSANT": 95,
	"PAIN AU CHOCOLAT": 80,
};
const QUANTILE_SCALES: Record<string, number> = {
	"0.1": 0.82, "0.3": 0.91, "0.5": 1.0, "0.6": 1.05, "0.7": 1.1, "0.8": 1.15, "0.9": 1.22,
};

async function seedForecastBundle(
	env: CloudflareEnv,
	tenantId: string,
	branchIds: string[],
): Promise<{ treesKey: string; featuresKey: string } | null> {
	const treesKey = `tenant:${tenantId}/trees/latest.json`;
	const featuresKey = `tenant:${tenantId}/features/latest.json`;

	const treesExists = await env.MODELS.head(treesKey);
	const featuresExists = await env.MODELS.head(featuresKey);
	if (treesExists && featuresExists) return null;

	// Trees: per-quantile single-leaf model; leaf value = base-per-family-average * scale.
	const meanBase = Object.values(FAMILY_BASE).reduce((a, b) => a + b, 0) / Object.keys(FAMILY_BASE).length;
	const quantiles: Record<string, unknown> = {};
	for (const [q, scale] of Object.entries(QUANTILE_SCALES)) {
		quantiles[q] = {
			feature_names: ["lag_7"],
			num_trees: 1,
			trees: [{
				split_feature: [],
				threshold: [],
				decision_type: [],
				left_child: [],
				right_child: [],
				leaf_value: [meanBase * scale],
			}],
		};
	}
	await env.MODELS.put(treesKey, JSON.stringify({ quantiles }));

	// Features: per branch × family × recent-date, use the family base as the single feature.
	const perBranchFamilyDate: Record<string, Record<string, number>> = {};
	const today = new Date();
	const dates: string[] = [];
	for (let d = 0; d < 7; d++) {
		dates.push(new Date(today.getTime() - d * 86400_000).toISOString().slice(0, 10));
	}
	for (const branchId of branchIds) {
		for (const family of Object.keys(FAMILY_BASE)) {
			for (const date of dates) {
				perBranchFamilyDate[`${branchId}|${family}|${date}`] = { lag_7: FAMILY_BASE[family] };
			}
		}
	}
	await env.MODELS.put(featuresKey, JSON.stringify({
		last_date: dates[0],
		per_branch_family_date: perBranchFamilyDate,
	}));

	return { treesKey, featuresKey };
}

// Clear rate-limit counters so re-seeding during Playwright runs doesn't
// trip signin/signup throttles (keys live in KV under `rate:<type>:<key>`).
async function clearRateLimits(env: CloudflareEnv): Promise<number> {
	let total = 0;
	let cursor: string | undefined;
	do {
		const page = await env.KV.list({ prefix: "rate:", cursor });
		await Promise.all(page.keys.map((k) => env.KV.delete(k.name)));
		total += page.keys.length;
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return total;
}

export async function seedDemo(env: CloudflareEnv): Promise<{
	tenantId: string;
	tenantSlug: string;
	adminUserId: string;
	managerUserId: string;
	branchIds: string[];
	connectorId: string;
	seededRows: number;
	bundleUploaded: boolean;
}> {
	await clearRateLimits(env);
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
	const bundle = await seedForecastBundle(env, tenantId, branchIds);
	return {
		tenantId,
		tenantSlug: DEMO_SLUG,
		adminUserId,
		managerUserId,
		branchIds,
		connectorId,
		seededRows,
		bundleUploaded: bundle !== null,
	};
}
