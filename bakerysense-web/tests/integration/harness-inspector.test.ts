import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { getDb } from "../../src/db/client";
import { tenants, branches, dailyActuals, evolutionProposals, skillVersions } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { inspectBranch } from "../../src/lib/harness/inspector";

const ASOF = "2026-06-01";

function isoMinusDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}
function dayOfWeekUTC(iso: string): number {
	return new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun..3=Wed
}

async function seedTenantBranch(tenantId: string, branchId: string) {
	const db = getDb(env);
	const now = Date.now();
	await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: tenantId.toUpperCase(), vertical: "bakery", plan: "free", createdAt: now });
	await db.insert(branches).values({ id: branchId, tenantId, name: "Main", createdAt: now });
}

/** Seed 112 days of banana_cake actuals. Wednesdays are systematically
 *  over-forecast (recommend 100, sell 80, 20 waste). Other days sell out
 *  exactly (sold == baked, zero waste → stockout-censored, excluded). */
async function seedOverforecastWednesdays(tenantId: string, branchId: string) {
	const db = getDb(env);
	const now = Date.now();
	const rows: (typeof dailyActuals.$inferInsert)[] = [];
	for (let d = 1; d <= 112; d++) {
		const date = isoMinusDays(ASOF, d);
		const isWed = dayOfWeekUTC(date) === 3;
		rows.push({
			id: `da_${d}`,
			tenantId,
			branchId,
			family: "banana_cake",
			date,
			recommendedBake: 100,
			actualBake: 100,
			actualSales: isWed ? 80 : 100,
			wasteUnits: isWed ? 20 : 0,
			source: "manual",
			capturedAt: now,
		});
	}
	// Insert in small chunks to stay within D1's SQL-variable limit
	// (~100 bound params per statement; 11 cols → max ~8 rows/insert).
	for (let i = 0; i < rows.length; i += 8) {
		await db.insert(dailyActuals).values(rows.slice(i, i + 8));
	}
}

describe("inspectBranch — end-to-end self-inspection", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
	});

	it("proposes a pending downward Wednesday correction for systematic over-forecast", async () => {
		await seedTenantBranch("t1", "b1");
		await seedOverforecastWednesdays("t1", "b1");

		const outcome = await inspectBranch(env, { tenantId: "t1", branchId: "b1", asOf: ASOF });

		expect(outcome.status).toBe("proposed");
		expect(outcome.editCount).toBe(1);
		expect(outcome.learnableCount).toBeGreaterThanOrEqual(5);
		expect(outcome.beforeWape).toBeGreaterThan(outcome.afterWape!);

		// A pending proposal row was written with the expected edit.
		const db = getDb(env);
		const proposals = await db.select().from(evolutionProposals).where(eq(evolutionProposals.id, outcome.proposalId!)).all();
		expect(proposals).toHaveLength(1);
		const p = proposals[0];
		expect(p.status).toBe("pending");
		expect(p.validationPassed).toBe(1);
		expect(p.branchId).toBe("b1");
		const edits = JSON.parse(p.editOpsJson) as Array<{ op: string; path: string; value: { multiplier: number } }>;
		expect(edits).toHaveLength(1);
		expect(edits[0].path).toBe("/post_forecast_adjustments/sku_adjustments/banana_cake|Wed");
		// median ratio 0.8, delta capped at -0.2 from 1.0 → exactly 0.8.
		expect(edits[0].value.multiplier).toBeCloseTo(0.8, 5);

		// A brand-level skill_versions row was bootstrapped as the parent.
		const brand = await db.select().from(skillVersions).where(eq(skillVersions.tenantId, "t1")).all();
		expect(brand.length).toBeGreaterThanOrEqual(1);
		expect(brand[0].skillId).toBe("forecast");
		expect(p.parentSkillVersionId).toBe(brand.find((b) => b.branchId === null)!.id);
	});

	it("returns no_evidence when forecasts are accurate", async () => {
		await seedTenantBranch("t2", "b2");
		const db = getDb(env);
		const now = Date.now();
		for (let d = 1; d <= 112; d++) {
			const date = isoMinusDays(ASOF, d);
			await db.insert(dailyActuals).values({
				id: `ok_${d}`, tenantId: "t2", branchId: "b2", family: "sourdough", date,
				recommendedBake: 50, actualBake: 55, actualSales: 50, wasteUnits: 5, source: "manual", capturedAt: now,
			});
		}
		const outcome = await inspectBranch(env, { tenantId: "t2", branchId: "b2", asOf: ASOF });
		expect(outcome.status).toBe("no_evidence");
		expect(outcome.editCount).toBe(0);
	});
});
