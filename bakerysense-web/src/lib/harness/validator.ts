// Validator — the SkillOpt gate. Before a proposed edit can reach owner
// approval, it must demonstrably lower forecast error (WAPE) on a holdout
// window that is STRICTLY DISJOINT from the evidence window that motivated
// the edit. Disjointness is the caller's (inspector's) responsibility —
// evidence is days [-7,-1], holdout is days [-30,-8] — so the validator
// can't confirm an edit using the same data that produced it.
//
// CRITICAL (pressure-test finding 1 + 5): holdout observations MUST exclude
// stockout-censored days. A censored actualSales is a lower bound on true
// demand; scoring against it rewards lower forecasts spuriously and is
// exactly how a self-evolving loop walks itself to zero. The inspector
// filters these when building the holdout; as defense-in-depth the scorer
// also skips any observation flagged `censored`.
//
// Pure module — scores baseForecast (the forecaster's pre-overlay output)
// × the candidate rules' overlay multiplier against realized sales. It
// never re-runs the GBM, so validation is cheap and deterministic.
import type { Rules } from "./resolver";
import { computeForecastMultiplier } from "./overlay";
import { applyEdits, getAtPointer, type EditOp } from "./patch";

export interface HoldoutObservation {
	sku: string;
	/** ISO date — must fall in the disjoint holdout window (caller ensures). */
	date: string;
	/** The forecaster's PRE-OVERLAY output for this sku-day (use the median /
	 *  q0.5, not the newsvendor bake quantity — we're scoring forecast
	 *  accuracy, not the service-level margin). The overlay multiplier is
	 *  applied uniformly to all quantiles, so scoring the median is
	 *  consistent with how the correction would move the bake quantity. */
	baseForecast: number;
	actualSales: number;
	/** Events active on the date — fed to the overlay so event corrections
	 *  score correctly. Default []. */
	activeEvents?: string[];
	/** True when this day was stockout-censored. Censored rows are skipped
	 *  by the scorer (their actualSales understates true demand). */
	censored?: boolean;
}

export interface ValidationResult {
	beforeWape: number;
	afterWape: number;
	/** beforeWape − afterWape. Positive = the edit reduced error. */
	improvement: number;
	passed: boolean;
	/** Non-censored rows actually scored. */
	scoredRows: number;
	minImprovement: number;
}

const DEFAULT_MIN_IMPROVEMENT = 0.01;

/** Read evidence.min_improvement_wape from rules, defaulting to 0.01. */
export function minImprovementFromRules(rules: Rules): number {
	const e = getAtPointer(rules, "/evidence");
	const v = e && typeof e === "object" && !Array.isArray(e)
		? (e as Record<string, unknown>).min_improvement_wape
		: undefined;
	return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_MIN_IMPROVEMENT;
}

/** Weighted absolute percentage error of the overlaid forecast against
 *  realized sales, over the (non-censored) holdout. Returns 0 when there is
 *  nothing to score. */
export function wape(observations: HoldoutObservation[], rules: Rules): number {
	let num = 0;
	let den = 0;
	for (const o of observations) {
		if (o.censored) continue;
		const m = computeForecastMultiplier(rules, o.sku, o.date, o.activeEvents ?? []).multiplier;
		const f = o.baseForecast * m;
		num += Math.abs(f - o.actualSales);
		den += o.actualSales;
	}
	return den > 0 ? num / den : 0;
}

/** Count non-censored, scorable rows. */
function scorableRows(observations: HoldoutObservation[]): number {
	return observations.reduce((n, o) => (o.censored ? n : n + (o.actualSales >= 0 ? 1 : 0)), 0);
}

export function validateProposal(
	rules: Rules,
	edits: EditOp[],
	holdout: HoldoutObservation[],
	opts: { minImprovement?: number } = {},
): ValidationResult {
	const minImprovement = opts.minImprovement ?? minImprovementFromRules(rules);
	const rows = scorableRows(holdout);

	const beforeWape = wape(holdout, rules);
	const afterRules = applyEdits(rules, edits);
	const afterWape = wape(holdout, afterRules);
	const improvement = beforeWape - afterWape;

	// Pass only with real evidence and a real improvement. No rows, or no
	// error to improve on (beforeWape 0), can never pass.
	const passed = rows > 0 && beforeWape > 0 && improvement >= minImprovement;

	return {
		beforeWape: round(beforeWape),
		afterWape: round(afterWape),
		improvement: round(improvement),
		passed,
		scoredRows: rows,
		minImprovement,
	};
}

function round(n: number): number {
	return Math.round(n * 10000) / 10000;
}
