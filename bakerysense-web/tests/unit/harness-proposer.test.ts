import { describe, it, expect } from "vitest";
import { propose, budgetFromRules, type ProposerBudget } from "@/lib/harness/proposer";
import type { Diagnosis } from "@/lib/harness/diagnoser";
import type { Rules } from "@/lib/harness/resolver";

const BUDGET: ProposerBudget = {
	maxOps: 3,
	maxDeltaPerOp: 0.2,
	floor: 0.5,
	ceiling: 2.0,
	minEvidenceRows: 3, // lower for compact tests
};

const FRESH_RULES: Rules = {
	post_forecast_adjustments: { dow_multipliers: {}, event_overrides: {}, sku_adjustments: {} },
	guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0, max_delta_per_op: 0.2, max_ops_per_proposal: 3 },
	evidence: { min_evidence_rows: 3 },
};

// Build a learnable skill_error diagnosis: forecast over realized sales.
function skillError(sku: string, date: string, forecast: number, actualSales: number): Diagnosis {
	return {
		cause: "skill_error",
		reasonCode: "unexplained_miss",
		reasonPayload: { sku, date, forecast, actualSales, direction: forecast > actualSales ? "over" : "under" },
		learnable: true,
		escalate: false,
	};
}

function operatorCorrection(sku: string, date: string, forecast: number, actualBake: number): Diagnosis {
	return {
		cause: "operator_correction",
		reasonCode: "operator_bake_closer_to_demand",
		reasonPayload: { sku, date, forecast, actualBake },
		learnable: true,
		escalate: false,
	};
}

function nonLearnable(sku: string, date: string): Diagnosis {
	return {
		cause: "stockout_capped",
		reasonCode: "sold_ge_bake_zero_waste",
		reasonPayload: { sku, date, forecast: 100, actualSales: 100 },
		learnable: false,
		escalate: false,
	};
}

describe("budgetFromRules", () => {
	it("reads guardrails + evidence, falling back to defaults", () => {
		const b = budgetFromRules(FRESH_RULES);
		expect(b).toEqual({ maxOps: 3, maxDeltaPerOp: 0.2, floor: 0.5, ceiling: 2.0, minEvidenceRows: 3 });
	});
	it("defaults when sections missing", () => {
		const b = budgetFromRules({});
		expect(b.maxOps).toBe(3);
		expect(b.floor).toBe(0.5);
	});
});

describe("propose", () => {
	// Three consecutive Wednesdays, forecast 100 but only ~82 sold → ~0.82 ratio.
	const wedMisses = [
		skillError("banana_cake", "2026-05-13", 100, 82), // Wed
		skillError("banana_cake", "2026-05-20", 100, 83), // Wed
		skillError("banana_cake", "2026-05-27", 100, 81), // Wed
	];

	it("proposes a downward sku_adjustment for systematic over-forecast", () => {
		const p = propose(FRESH_RULES, wedMisses, BUDGET);
		expect(p.edits).toHaveLength(1);
		const e = p.edits[0];
		expect(e.op).toBe("add"); // no existing entry on fresh rules
		expect(e.path).toBe("/post_forecast_adjustments/sku_adjustments/banana_cake|Wed");
		const val = e.value as { multiplier: number; reason: string };
		// median ratio ~0.82 → new multiplier ~0.82, within the 0.2 delta cap.
		expect(val.multiplier).toBeGreaterThan(0.8);
		expect(val.multiplier).toBeLessThan(0.85);
		expect(val.reason).toContain("over-forecast");
		expect(p.details[0].dow).toBe("Wed");
		expect(p.details[0].rows).toBe(3);
	});

	it("replaces when an entry already exists, and respects the per-op delta cap", () => {
		const rules: Rules = {
			...FRESH_RULES,
			post_forecast_adjustments: {
				dow_multipliers: {}, event_overrides: {},
				sku_adjustments: { "banana_cake|Wed": { multiplier: 1.0 } },
			},
		};
		// Severe over-forecast: only 50 sold of 100 → ratio 0.5. current 1.0,
		// target 0.5, but delta capped at 0.2 → proposed 0.8.
		const severe = [
			skillError("banana_cake", "2026-05-13", 100, 50),
			skillError("banana_cake", "2026-05-20", 100, 50),
			skillError("banana_cake", "2026-05-27", 100, 50),
		];
		const p = propose(rules, severe, BUDGET);
		expect(p.edits[0].op).toBe("replace");
		expect((p.edits[0].value as { multiplier: number }).multiplier).toBeCloseTo(0.8, 5);
	});

	it("learns from operator_correction using the operator's bake as truth", () => {
		const corrections = [
			operatorCorrection("curry_puff", "2026-05-15", 100, 118), // Fri, operator baked higher
			operatorCorrection("curry_puff", "2026-05-22", 100, 120),
			operatorCorrection("curry_puff", "2026-05-29", 100, 119),
		];
		const p = propose(FRESH_RULES, corrections, BUDGET);
		expect(p.edits).toHaveLength(1);
		expect(p.details[0].dow).toBe("Fri");
		// median ratio of [1.18, 1.20, 1.19] = 1.19; within the +0.2 cap → 1.19.
		expect((p.edits[0].value as { multiplier: number }).multiplier).toBeCloseTo(1.19, 5);
		expect(p.details[0].rationale).toContain("raise");
	});

	it("ignores non-learnable diagnoses", () => {
		const p = propose(FRESH_RULES, [nonLearnable("x", "2026-05-13"), nonLearnable("x", "2026-05-20"), nonLearnable("x", "2026-05-27")], BUDGET);
		expect(p.edits).toHaveLength(0);
	});

	it("requires minimum evidence rows", () => {
		const p = propose(FRESH_RULES, wedMisses.slice(0, 2), BUDGET); // only 2 < 3
		expect(p.edits).toHaveLength(0);
	});

	it("skips groups with inconsistent direction", () => {
		const mixed = [
			skillError("x", "2026-05-13", 100, 70), // over
			skillError("x", "2026-05-20", 100, 130), // under
			skillError("x", "2026-05-27", 100, 72), // over (2/3 over = 0.67 < 0.7)
		];
		const p = propose(FRESH_RULES, mixed, BUDGET);
		expect(p.edits).toHaveLength(0);
	});

	it("skips negligible bias (< 5%)", () => {
		const tiny = [
			skillError("x", "2026-05-13", 100, 98),
			skillError("x", "2026-05-20", 100, 97),
			skillError("x", "2026-05-27", 100, 98),
		];
		const p = propose(FRESH_RULES, tiny, BUDGET);
		expect(p.edits).toHaveLength(0);
	});

	it("ranks by strength and trims to maxOps", () => {
		// Two groups, both qualify; cap maxOps at 1 → only the stronger survives.
		const tightBudget = { ...BUDGET, maxOps: 1 };
		const diags = [
			// banana_cake|Wed: ratio ~0.6 (strong)
			skillError("banana_cake", "2026-05-13", 100, 60),
			skillError("banana_cake", "2026-05-20", 100, 60),
			skillError("banana_cake", "2026-05-27", 100, 60),
			// croissant|Fri: ratio ~0.9 (weaker)
			skillError("croissant", "2026-05-15", 100, 90),
			skillError("croissant", "2026-05-22", 100, 90),
			skillError("croissant", "2026-05-29", 100, 90),
		];
		const p = propose(FRESH_RULES, diags, tightBudget);
		expect(p.edits).toHaveLength(1);
		expect(p.details[0].sku).toBe("banana_cake");
	});
});
