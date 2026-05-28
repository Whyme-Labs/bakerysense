// Proposer — turns learnable diagnoses into bounded, guardrail-clamped
// edits on a skill's rules.json. This is the SkillOpt contribution: a
// separate step that converts scored evidence into add/replace/remove ops,
// with a "textual learning rate" (per-op delta cap) so corrections move
// conservatively and a stack of edits can't run away.
//
// v1 scope: SKU × day-of-week corrections only (the demo's "banana cake is
// over-forecast on Wednesdays" shape). Pure dow-wide corrections are
// deferred — adjusting a dow multiplier moves every SKU, which is rarely
// what the evidence supports. Edits target the keyed `sku_adjustments`
// object: /post_forecast_adjustments/sku_adjustments/<sku>|<dow>.
//
// The proposer does NOT validate (that's the validator, on a disjoint
// holdout window) and does NOT apply (that's the inspector, on approval).
// It only proposes. Pure module.
import type { Rules } from "./resolver";
import type { Diagnosis } from "./diagnoser";
import { dayOfWeek } from "./overlay";
import { escapePointerToken, getAtPointer, hasPointer, type EditOp } from "./patch";

export interface ProposerBudget {
	/** Max number of edits per proposal (SkillOpt "epoch" cap). */
	maxOps: number;
	/** Max absolute change to any single multiplier per op (learning rate). */
	maxDeltaPerOp: number;
	/** Hard clamp band for any multiplier. */
	floor: number;
	ceiling: number;
	/** Min learnable rows in a (sku,dow) group before we propose for it. */
	minEvidenceRows: number;
}

export interface ProposedEdit {
	op: EditOp;
	sku: string;
	dow: string;
	current: number;
	proposed: number;
	medianRatio: number;
	rows: number;
	/** rows × |medianRatio − 1| — used to rank and trim to maxOps. */
	strength: number;
	rationale: string;
}

export interface Proposal {
	edits: EditOp[];
	details: ProposedEdit[];
}

const DEFAULT_BUDGET: ProposerBudget = {
	maxOps: 3,
	maxDeltaPerOp: 0.2,
	floor: 0.5,
	ceiling: 2.0,
	minEvidenceRows: 5,
};

/** Minimum systematic bias (|median ratio − 1|) worth correcting. Below
 *  this the noise isn't worth an edit. */
const MIN_BIAS = 0.05;
/** Fraction of a group's rows that must agree on direction (over vs under)
 *  for the bias to count as systematic rather than scattered. */
const MIN_DIRECTION_AGREEMENT = 0.7;
/** Minimum resulting change to bother emitting an edit. */
const MIN_EDIT_DELTA = 0.01;

/** Read the proposer budget from a skill's rules (guardrails + evidence),
 *  falling back to defaults for any missing field. */
export function budgetFromRules(rules: Rules): ProposerBudget {
	const g = asObject(getAtPointer(rules, "/guardrails")) ?? {};
	const e = asObject(getAtPointer(rules, "/evidence")) ?? {};
	return {
		maxOps: num(g.max_ops_per_proposal) ?? DEFAULT_BUDGET.maxOps,
		maxDeltaPerOp: num(g.max_delta_per_op) ?? DEFAULT_BUDGET.maxDeltaPerOp,
		floor: num(g.multiplier_floor) ?? DEFAULT_BUDGET.floor,
		ceiling: num(g.multiplier_ceiling) ?? DEFAULT_BUDGET.ceiling,
		minEvidenceRows: num(e.min_evidence_rows) ?? DEFAULT_BUDGET.minEvidenceRows,
	};
}

interface Group {
	sku: string;
	dow: string;
	ratios: number[];
	latestDate: string;
}

export function propose(
	rules: Rules,
	diagnoses: Diagnosis[],
	budget: ProposerBudget = DEFAULT_BUDGET,
): Proposal {
	// 1. Aggregate learnable rows into (sku, dow) groups, recording the ratio
	//    of realized truth to forecast. For skill_error the truth is realized
	//    sales; for operator_correction it's the operator's bake (their call
	//    is treated as ground truth — that's the knowledge we're capturing).
	const groups = new Map<string, Group>();
	for (const d of diagnoses) {
		if (!d.learnable) continue;
		const p = d.reasonPayload;
		const sku = typeof p.sku === "string" ? p.sku : undefined;
		const date = typeof p.date === "string" ? p.date : undefined;
		const forecast = num(p.forecast);
		if (!sku || !date || forecast === undefined || forecast <= 0) continue;
		const truth = d.cause === "operator_correction" ? num(p.actualBake) : num(p.actualSales);
		if (truth === undefined) continue;
		const dow = dayOfWeek(date);
		const key = `${sku}|${dow}`;
		const g = groups.get(key) ?? { sku, dow, ratios: [], latestDate: date };
		g.ratios.push(truth / forecast);
		if (date > g.latestDate) g.latestDate = date;
		groups.set(key, g);
	}

	// 2. Score each group; keep those with enough consistent evidence.
	const candidates: ProposedEdit[] = [];
	for (const g of groups.values()) {
		if (g.ratios.length < budget.minEvidenceRows) continue;
		const med = median(g.ratios);
		if (Math.abs(med - 1) < MIN_BIAS) continue;
		const below = g.ratios.filter((r) => r < 1).length;
		const above = g.ratios.filter((r) => r > 1).length;
		const agreement = Math.max(below, above) / g.ratios.length;
		if (agreement < MIN_DIRECTION_AGREEMENT) continue;

		const current = currentSkuMultiplier(rules, g.sku, g.dow);
		// New sku multiplier that would scale the (already-overlaid) forecast
		// by the observed median ratio: new = current × median.
		const target = current * med;
		const delta = clamp(target - current, -budget.maxDeltaPerOp, budget.maxDeltaPerOp);
		const proposed = round(clamp(current + delta, budget.floor, budget.ceiling), 3);
		if (Math.abs(proposed - current) < MIN_EDIT_DELTA) continue;

		const key = `${g.sku}|${g.dow}`;
		const path = `/post_forecast_adjustments/sku_adjustments/${escapePointerToken(key)}`;
		const op: EditOp["op"] = hasPointer(rules, path) ? "replace" : "add";
		const dir = med < 1 ? "over" : "under";
		const pct = Math.round(Math.abs(med - 1) * 100);
		candidates.push({
			op: {
				op,
				path,
				value: {
					multiplier: proposed,
					reason: `learned ${g.latestDate}: ${g.ratios.length} ${dir}-forecast days, median ratio ${round(med, 3)}`,
				},
			},
			sku: g.sku,
			dow: g.dow,
			current,
			proposed,
			medianRatio: round(med, 3),
			rows: g.ratios.length,
			strength: g.ratios.length * Math.abs(med - 1),
			rationale: `${g.sku} on ${g.dow}: forecast ${dir} by ~${pct}% across ${g.ratios.length} days → ${dir === "over" ? "lower" : "raise"} multiplier ${current} → ${proposed}`,
		});
	}

	// 3. Rank by evidence strength and trim to the budget.
	candidates.sort((a, b) => b.strength - a.strength);
	const details = candidates.slice(0, budget.maxOps);
	return { edits: details.map((d) => d.op), details };
}

function currentSkuMultiplier(rules: Rules, sku: string, dow: string): number {
	const key = `${sku}|${dow}`;
	const path = `/post_forecast_adjustments/sku_adjustments/${escapePointerToken(key)}`;
	const entry = asObject(getAtPointer(rules, path));
	return num(entry?.multiplier) ?? 1;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
	return typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}
function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}
function round(n: number, dp: number): number {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}
function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
