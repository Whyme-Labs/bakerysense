import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { getDb } from "../../src/db/client";
import { tenants, branches, users, dailyActuals, skillVersions } from "../../src/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { inspectBranch } from "../../src/lib/harness/inspector";
import { approveProposal, rejectProposal } from "../../src/lib/harness/approval";
import { loadEffectiveRules } from "../../src/lib/harness/registry";
import { computeForecastMultiplier } from "../../src/lib/harness/overlay";
import { getAtPointer } from "../../src/lib/harness/patch";

const ASOF = "2026-06-01";

function isoMinusDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}
function isWedUTC(iso: string): boolean {
	return new Date(`${iso}T00:00:00Z`).getUTCDay() === 3;
}

async function seed(tenantId: string, branchId: string, userId: string) {
	const db = getDb(env);
	const now = Date.now();
	await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: tenantId.toUpperCase(), vertical: "bakery", plan: "free", createdAt: now });
	await db.insert(branches).values({ id: branchId, tenantId, name: "Main", createdAt: now });
	await db.insert(users).values({ id: userId, email: `${userId}@t.co`, passwordHash: "x", createdAt: now });

	const rows: (typeof dailyActuals.$inferInsert)[] = [];
	for (let d = 1; d <= 112; d++) {
		const date = isoMinusDays(ASOF, d);
		const wed = isWedUTC(date);
		rows.push({
			id: `da_${tenantId}_${d}`, tenantId, branchId, family: "banana_cake", date,
			recommendedBake: 100, actualBake: 100,
			actualSales: wed ? 80 : 100, wasteUnits: wed ? 20 : 0,
			source: "manual", capturedAt: now,
		});
	}
	for (let i = 0; i < rows.length; i += 8) {
		await db.insert(dailyActuals).values(rows.slice(i, i + 8));
	}
}

describe("approveProposal / rejectProposal — closing the loop", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
	});

	it("approval activates a branch override that loadEffectiveRules picks up", async () => {
		await seed("t1", "b1", "u1");

		// Before: fresh tenant, overlay is identity for banana_cake on a Wed.
		const before = await loadEffectiveRules(env, "t1", "b1", "forecast");
		expect(computeForecastMultiplier(before, "banana_cake", "2026-05-27").multiplier).toBe(1);

		const outcome = await inspectBranch(env, { tenantId: "t1", branchId: "b1", asOf: ASOF });
		expect(outcome.status).toBe("proposed");
		const proposalId = outcome.proposalId!;

		const res = await approveProposal(env, proposalId, "u1");
		expect(res.branchId).toBe("b1");

		// After: the branch override carries the learned correction, and the
		// effective overlay multiplier for banana_cake on a Wednesday is 0.8.
		const after = await loadEffectiveRules(env, "t1", "b1", "forecast");
		const learned = getAtPointer(after, "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed") as { multiplier: number };
		expect(learned.multiplier).toBeCloseTo(0.8, 5);
		expect(computeForecastMultiplier(after, "banana_cake", "2026-05-27").multiplier).toBeCloseTo(0.8, 5);
		// A non-Wednesday is untouched (inherits brand default 1.0).
		expect(computeForecastMultiplier(after, "banana_cake", "2026-05-28").multiplier).toBe(1);

		const db = getDb(env);
		// A new active branch version exists; brand version still active & untouched.
		const branchActive = await db.select().from(skillVersions).where(and(eq(skillVersions.tenantId, "t1"), eq(skillVersions.branchId, "b1"), eq(skillVersions.status, "active"))).all();
		expect(branchActive).toHaveLength(1);
		expect(branchActive[0].id).toBe(res.skillVersionId);
		const brandActive = await db.select().from(skillVersions).where(and(eq(skillVersions.tenantId, "t1"), isNull(skillVersions.branchId), eq(skillVersions.status, "active"))).all();
		expect(brandActive).toHaveLength(1);
	});

	it("re-approving the same proposal throws (pending-only guard)", async () => {
		await seed("t2", "b2", "u2");
		const outcome = await inspectBranch(env, { tenantId: "t2", branchId: "b2", asOf: ASOF });
		await approveProposal(env, outcome.proposalId!, "u2");
		await expect(approveProposal(env, outcome.proposalId!, "u2")).rejects.toThrow(/not_pending/);
	});

	it("rejection records the decision and leaves rules unchanged", async () => {
		await seed("t3", "b3", "u3");
		const outcome = await inspectBranch(env, { tenantId: "t3", branchId: "b3", asOf: ASOF });
		await rejectProposal(env, outcome.proposalId!, "u3");

		// No branch override created → overlay stays identity.
		const rules = await loadEffectiveRules(env, "t3", "b3", "forecast");
		expect(computeForecastMultiplier(rules, "banana_cake", "2026-05-27").multiplier).toBe(1);

		const db = getDb(env);
		const branchVersions = await db.select().from(skillVersions).where(and(eq(skillVersions.tenantId, "t3"), eq(skillVersions.branchId, "b3"))).all();
		expect(branchVersions).toHaveLength(0);
	});
});
