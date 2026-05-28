// Inspector — the nightly orchestrator that turns a branch's recent
// execution traces into a gated, owner-reviewable evolution proposal.
//
// Pipeline (see docs/architecture/self-evolving-harness.md §6):
//   1. Pull the last ~30 days of daily_actuals for (tenant, branch).
//   2. Split into a disjoint evidence window [-7,-1] and holdout [-30,-8].
//   3. Diagnose evidence-window misses (7-cause priority classifier).
//   4. Feed learnable diagnoses to the proposer → bounded edits.
//   5. Build holdout observations (reconstructing the pre-overlay base
//      forecast and flagging stockout-censored days) and validate the
//      edits against them.
//   6. Write an evolution_proposals row: "pending" if validation passed,
//      "rejected_validation" otherwise (still recorded for audit).
//
// v1 scope notes:
//   - operatorDeviated is inferred from daily_actuals (actualBake vs
//     recommendedBake); no bake_plan_decisions join yet.
//   - recurringEvents is empty (historical event-correlation analysis is
//     deferred), so events classify as one-off in v1.
//   - Holdout base is reconstructed as recommendedBake / currentOverlay,
//     which is exact under v1 assumptions (dow/event overlays are identity;
//     only sku_adjustments evolve) and assumes rules were stable across the
//     holdout window.
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals, branches } from "@/db/schema";
import { festivalFeatures } from "@/lib/festivals";
import { loadEffectiveRules, type SkillId } from "@/lib/harness/registry";
import { diagnoseMiss, type Diagnosis } from "@/lib/harness/diagnoser";
import { propose, budgetFromRules } from "@/lib/harness/proposer";
import { computeForecastMultiplier } from "@/lib/harness/overlay";
import { validateProposal, type HoldoutObservation } from "@/lib/harness/validator";
import { getAtPointer } from "@/lib/harness/patch";
import { resolveParentVersionId } from "@/lib/skill-versions";
import { insertProposal } from "@/lib/evolution-proposals";

export interface InspectOptions {
	tenantId: string;
	branchId: string;
	skillId?: SkillId;
	/** ISO date the windows are measured back from. Defaults to today (UTC). */
	asOf?: string;
	/** Override locale for festival resolution; defaults to the branch row. */
	locale?: string | null;
}

export interface InspectionOutcome {
	status: "no_evidence" | "no_proposal" | "proposed" | "rejected_validation";
	proposalId?: string;
	learnableCount: number;
	editCount: number;
	beforeWape?: number;
	afterWape?: number;
}

function isoMinusDays(iso: string, n: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

/** Festival keys active on a date, excluding the soft-signal fields. */
function activeEventsFor(locale: string | null, date: string): string[] {
	const f = festivalFeatures(locale, date);
	return Object.entries(f)
		.filter(([k, v]) => v === 1 && k !== "is_pre_festival_eve")
		.map(([k]) => k);
}

export async function inspectBranch(env: CloudflareEnv, opts: InspectOptions): Promise<InspectionOutcome> {
	const skillId: SkillId = opts.skillId ?? "forecast";
	const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);

	const db = getDb(env);

	// Locale for festival resolution.
	let locale = opts.locale ?? null;
	if (locale === null && opts.locale === undefined) {
		const b = await db.select({ locale: branches.locale }).from(branches).where(eq(branches.id, opts.branchId)).limit(1).all();
		locale = b[0]?.locale ?? null;
	}

	const currentRules = await loadEffectiveRules(env, opts.tenantId, opts.branchId, skillId);
	const missThreshold = numAt(currentRules, "/evidence/miss_threshold", 0.15);

	// Window bounds (inclusive), read from rules.windows. Defaults are WEEKLY
	// scale, not daily: same-(sku,dow) aggregation needs several weeks of the
	// same weekday to reach min_evidence_rows. Evidence is the recent 8 weeks
	// [-56,-1]; holdout is the disjoint 8 weeks before it [-112,-57].
	const [evOff0, evOff1] = windowPair(currentRules, "/windows/evidence_days", [-56, -1]);
	const [hoOff0, hoOff1] = windowPair(currentRules, "/windows/holdout_days", [-112, -57]);
	const evidenceStart = isoMinusDays(asOf, -evOff0);
	const evidenceEnd = isoMinusDays(asOf, -evOff1);
	const holdoutStart = isoMinusDays(asOf, -hoOff0);
	const holdoutEnd = isoMinusDays(asOf, -hoOff1);
	// Earliest date we need to pull (the older of the two window starts).
	const pullSince = evidenceStart < holdoutStart ? evidenceStart : holdoutStart;

	// Pull everything from pullSince forward in one query, then bucket.
	const rows = await db
		.select()
		.from(dailyActuals)
		.where(
			and(
				eq(dailyActuals.tenantId, opts.tenantId),
				eq(dailyActuals.branchId, opts.branchId),
				gte(dailyActuals.date, pullSince),
			),
		)
		.all();

	// --- 3. Diagnose evidence-window misses ---
	const diagnoses: Diagnosis[] = [];
	const evidenceTraceIds: string[] = [];
	for (const r of rows) {
		if (r.date < evidenceStart || r.date > evidenceEnd) continue;
		if (r.recommendedBake == null || r.actualSales == null) continue;
		const operatorDeviated = r.actualBake != null && r.recommendedBake != null && r.actualBake !== r.recommendedBake;
		const d = diagnoseMiss(
			{
				sku: r.family,
				date: r.date,
				forecast: r.recommendedBake,
				actualSales: r.actualSales,
				actualBake: r.actualBake ?? null,
				wasteUnits: r.wasteUnits ?? null,
				operatorDeviated,
				activeEvents: activeEventsFor(locale, r.date),
				recurringEvents: [], // v1: historical correlation deferred
			},
			{ missThreshold },
		);
		diagnoses.push(d);
		if (d.learnable) evidenceTraceIds.push(`${r.family}@${r.date}`);
	}

	const learnableCount = diagnoses.filter((d) => d.learnable).length;
	if (learnableCount === 0) {
		return { status: "no_evidence", learnableCount: 0, editCount: 0 };
	}

	// --- 4. Propose ---
	const budget = budgetFromRules(currentRules);
	const proposal = propose(currentRules, diagnoses, budget);
	if (proposal.edits.length === 0) {
		return { status: "no_proposal", learnableCount, editCount: 0 };
	}

	// --- 5. Build holdout + validate ---
	const holdout: HoldoutObservation[] = [];
	for (const r of rows) {
		if (r.date < holdoutStart || r.date > holdoutEnd) continue;
		if (r.recommendedBake == null || r.actualSales == null) continue;
		const events = activeEventsFor(locale, r.date);
		const curMult = computeForecastMultiplier(currentRules, r.family, r.date, events).multiplier;
		const base = r.recommendedBake / Math.max(curMult, 0.01);
		const censored = r.actualBake != null && r.actualSales >= r.actualBake && (r.wasteUnits ?? 0) === 0;
		holdout.push({ sku: r.family, date: r.date, baseForecast: base, actualSales: r.actualSales, activeEvents: events, censored });
	}
	const validation = validateProposal(currentRules, proposal.edits, holdout, {});

	// --- 6. Persist ---
	const parentId = await resolveParentVersionId(env, opts.tenantId, opts.branchId, skillId);
	const status = validation.passed ? "pending" : "rejected_validation";
	const summary = proposal.details.map((d) => d.rationale).join("; ");
	const proposalId = await insertProposal(env, {
		tenantId: opts.tenantId,
		branchId: opts.branchId,
		skillId,
		parentSkillVersionId: parentId,
		edits: proposal.edits,
		evidenceTraceIds,
		diagnosisSummary: summary,
		diagnosisDetail: diagnoses.filter((d) => d.learnable),
		validationMetrics: validation,
		validationPassed: validation.passed,
		status,
	});

	return {
		status: validation.passed ? "proposed" : "rejected_validation",
		proposalId,
		learnableCount,
		editCount: proposal.edits.length,
		beforeWape: validation.beforeWape,
		afterWape: validation.afterWape,
	};
}

function numAt(rules: Record<string, unknown>, path: string, fallback: number): number {
	const v = getAtPointer(rules, path);
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Read a [startOffset, endOffset] day-offset pair from rules (both negative,
 *  start more negative). Falls back to `def` when missing/malformed. */
function windowPair(rules: Record<string, unknown>, path: string, def: [number, number]): [number, number] {
	const v = getAtPointer(rules, path);
	if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
		return [v[0], v[1]];
	}
	return def;
}
