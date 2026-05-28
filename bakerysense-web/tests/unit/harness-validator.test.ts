import { describe, it, expect } from "vitest";
import {
	wape,
	validateProposal,
	minImprovementFromRules,
	type HoldoutObservation,
} from "@/lib/harness/validator";
import type { Rules } from "@/lib/harness/resolver";
import type { EditOp } from "@/lib/harness/patch";

const FRESH_RULES: Rules = {
	post_forecast_adjustments: { dow_multipliers: {}, event_overrides: {}, sku_adjustments: {} },
	guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0 },
	evidence: { min_improvement_wape: 0.01 },
};

// Three Wednesdays where the unadjusted forecast (100) overshoots sales (~80).
function overforecastHoldout(): HoldoutObservation[] {
	return [
		{ sku: "banana_cake", date: "2026-04-29", baseForecast: 100, actualSales: 80 }, // Wed
		{ sku: "banana_cake", date: "2026-05-06", baseForecast: 100, actualSales: 82 }, // Wed
		{ sku: "banana_cake", date: "2026-05-13", baseForecast: 100, actualSales: 78 }, // Wed
	];
}

// An edit that lowers the banana_cake Wednesday multiplier to 0.8.
const downEdit: EditOp[] = [
	{ op: "add", path: "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed", value: { multiplier: 0.8 } },
];

describe("minImprovementFromRules", () => {
	it("reads the rule, defaulting to 0.01", () => {
		expect(minImprovementFromRules(FRESH_RULES)).toBe(0.01);
		expect(minImprovementFromRules({})).toBe(0.01);
		expect(minImprovementFromRules({ evidence: { min_improvement_wape: 0.05 } })).toBe(0.05);
	});
});

describe("wape", () => {
	it("computes weighted absolute percentage error at multiplier 1.0", () => {
		// |100-80| + |100-82| + |100-78| = 20+18+22 = 60; den = 240 → 0.25
		expect(wape(overforecastHoldout(), FRESH_RULES)).toBeCloseTo(60 / 240, 6);
	});

	it("applies the overlay multiplier from rules", () => {
		const rules: Rules = {
			...FRESH_RULES,
			post_forecast_adjustments: {
				dow_multipliers: {}, event_overrides: {},
				sku_adjustments: { "banana_cake|Wed": { multiplier: 0.8 } },
			},
		};
		// forecast → 80 each: |80-80|+|80-82|+|80-78| = 0+2+2 = 4; den 240 → 0.0167
		expect(wape(overforecastHoldout(), rules)).toBeCloseTo(4 / 240, 6);
	});

	it("returns 0 for empty / zero-demand holdout", () => {
		expect(wape([], FRESH_RULES)).toBe(0);
		expect(wape([{ sku: "x", date: "2026-05-01", baseForecast: 10, actualSales: 0 }], FRESH_RULES)).toBe(0);
	});

	it("skips censored rows", () => {
		const obs: HoldoutObservation[] = [
			{ sku: "x", date: "2026-05-01", baseForecast: 100, actualSales: 100, censored: true },
			{ sku: "x", date: "2026-05-02", baseForecast: 100, actualSales: 80 },
		];
		// Only the second row scored: |100-80|/80 = 0.25
		expect(wape(obs, FRESH_RULES)).toBeCloseTo(0.25, 6);
	});
});

describe("validateProposal", () => {
	it("passes a downward edit that lowers WAPE on over-forecast holdout", () => {
		const r = validateProposal(FRESH_RULES, downEdit, overforecastHoldout());
		expect(r.beforeWape).toBeCloseTo(0.25, 4);
		expect(r.afterWape).toBeLessThan(r.beforeWape);
		expect(r.improvement).toBeGreaterThan(0.01);
		expect(r.passed).toBe(true);
		expect(r.scoredRows).toBe(3);
	});

	it("fails a no-op edit (no improvement)", () => {
		const noop: EditOp[] = [
			{ op: "add", path: "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed", value: { multiplier: 1.0 } },
		];
		const r = validateProposal(FRESH_RULES, noop, overforecastHoldout());
		expect(r.improvement).toBe(0);
		expect(r.passed).toBe(false);
	});

	it("fails an edit that makes WAPE worse", () => {
		const upEdit: EditOp[] = [
			{ op: "add", path: "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed", value: { multiplier: 1.3 } },
		];
		const r = validateProposal(FRESH_RULES, upEdit, overforecastHoldout());
		expect(r.afterWape).toBeGreaterThan(r.beforeWape);
		expect(r.passed).toBe(false);
	});

	it("fails when holdout is empty", () => {
		const r = validateProposal(FRESH_RULES, downEdit, []);
		expect(r.passed).toBe(false);
		expect(r.scoredRows).toBe(0);
	});

	it("fails when improvement is below the min threshold", () => {
		// Tiny over-forecast (101 vs 100) → an 0.8 multiplier overshoots the
		// other way; pick an edit with marginal benefit and a high threshold.
		const nearPerfect: HoldoutObservation[] = [
			{ sku: "banana_cake", date: "2026-04-29", baseForecast: 100, actualSales: 99 },
			{ sku: "banana_cake", date: "2026-05-06", baseForecast: 100, actualSales: 99 },
			{ sku: "banana_cake", date: "2026-05-13", baseForecast: 100, actualSales: 99 },
		];
		const smallEdit: EditOp[] = [
			{ op: "add", path: "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed", value: { multiplier: 0.99 } },
		];
		const r = validateProposal(FRESH_RULES, smallEdit, nearPerfect, { minImprovement: 0.05 });
		expect(r.passed).toBe(false);
	});

	it("excludes censored rows from the gate (anti-spiral guard)", () => {
		// All holdout rows are stockout-censored → nothing scorable → fail.
		const censored: HoldoutObservation[] = overforecastHoldout().map((o) => ({ ...o, censored: true }));
		const r = validateProposal(FRESH_RULES, downEdit, censored);
		expect(r.scoredRows).toBe(0);
		expect(r.passed).toBe(false);
	});
});
