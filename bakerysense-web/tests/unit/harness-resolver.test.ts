import { describe, it, expect } from "vitest";
import { deepMergeRules } from "@/lib/harness/resolver";

describe("deepMergeRules — brand × branch inheritance", () => {
	it("branch primitive overrides brand primitive", () => {
		const brand = { a: 1, b: "x" };
		const branch = { a: 2 };
		expect(deepMergeRules(brand, branch)).toEqual({ a: 2, b: "x" });
	});

	it("branch missing key → brand value passes through", () => {
		const brand = { a: 1, b: 2 };
		expect(deepMergeRules(brand, {})).toEqual({ a: 1, b: 2 });
	});

	it("branch null/undefined → returns brand unchanged", () => {
		const brand = { a: 1 };
		expect(deepMergeRules(brand, null)).toEqual({ a: 1 });
		expect(deepMergeRules(brand, undefined)).toEqual({ a: 1 });
	});

	it("branch adds new keys not in brand", () => {
		const brand = { a: 1 };
		const branch = { b: 2 };
		expect(deepMergeRules(brand, branch)).toEqual({ a: 1, b: 2 });
	});

	it("nested plain objects merge per-key (branch overrides sibling, not all)", () => {
		const brand = { dow: { Mon: 1.0, Tue: 1.0, Wed: 1.0 } };
		const branch = { dow: { Wed: 0.85 } };
		expect(deepMergeRules(brand, branch)).toEqual({
			dow: { Mon: 1.0, Tue: 1.0, Wed: 0.85 },
		});
	});

	it("arrays replace wholesale — no concat, no per-index merge", () => {
		const brand = { events: [{ event: "school_holiday" }] };
		const branch = { events: [{ event: "ramadan" }] };
		expect(deepMergeRules(brand, branch)).toEqual({
			events: [{ event: "ramadan" }],
		});
	});

	it("empty branch array still replaces non-empty brand array", () => {
		const brand = { events: [{ event: "school_holiday" }] };
		const branch = { events: [] };
		expect(deepMergeRules(brand, branch)).toEqual({ events: [] });
	});

	it("type mismatch — branch object replaces brand array", () => {
		const brand = { a: [1, 2, 3] };
		const branch = { a: { x: 1 } };
		expect(deepMergeRules(brand, branch)).toEqual({ a: { x: 1 } });
	});

	it("type mismatch — branch array replaces brand object", () => {
		const brand = { a: { x: 1 } };
		const branch = { a: [1] };
		expect(deepMergeRules(brand, branch)).toEqual({ a: [1] });
	});

	it("branch null value replaces brand primitive", () => {
		const brand = { a: 1 };
		const branch = { a: null };
		expect(deepMergeRules(brand, branch)).toEqual({ a: null });
	});

	it("does not mutate either input", () => {
		const brand = { dow: { Mon: 1.0, Wed: 1.0 }, list: [1, 2] };
		const branch = { dow: { Wed: 0.85 } };
		const brandSnapshot = JSON.parse(JSON.stringify(brand));
		const branchSnapshot = JSON.parse(JSON.stringify(branch));
		deepMergeRules(brand, branch);
		expect(brand).toEqual(brandSnapshot);
		expect(branch).toEqual(branchSnapshot);
	});

	it("ignores __proto__ / constructor / prototype keys defensively", () => {
		const brand = { a: 1 };
		const malicious = JSON.parse('{"__proto__": {"polluted": true}, "a": 2}');
		const out = deepMergeRules(brand, malicious);
		expect(out).toEqual({ a: 2 });
		// And the global Object.prototype is unpolluted.
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("realistic forecast rules: sparse branch overlay on full brand baseline", () => {
		const brand = {
			post_forecast_adjustments: {
				dow_multipliers: { Mon: 1.0, Tue: 1.0, Wed: 1.0, Thu: 1.0, Fri: 1.0, Sat: 1.0, Sun: 1.0 },
				event_overrides: [],
				sku_adjustments: [],
			},
			newsvendor_cost_ratio: { cu: 2.0, co: 1.0 },
			guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0 },
		};
		// Branch has only learned a Wednesday banana_cake correction.
		const branch = {
			post_forecast_adjustments: {
				dow_multipliers: { Wed: 0.85 },
				sku_adjustments: [
					{ sku: "banana_cake", dow: "Wed", multiplier: 0.85, reason: "learned 2026-05-28" },
				],
			},
		};
		const effective = deepMergeRules(brand, branch);
		// Brand defaults preserved where branch didn't touch.
		expect(effective.newsvendor_cost_ratio).toEqual({ cu: 2.0, co: 1.0 });
		expect(effective.guardrails).toEqual({ multiplier_floor: 0.5, multiplier_ceiling: 2.0 });
		// Branch's Wed override applied; Mon..Sun siblings untouched.
		const adj = effective.post_forecast_adjustments as Record<string, unknown>;
		expect(adj.dow_multipliers).toEqual({
			Mon: 1.0, Tue: 1.0, Wed: 0.85, Thu: 1.0, Fri: 1.0, Sat: 1.0, Sun: 1.0,
		});
		// event_overrides not touched by branch → brand's empty array passes through.
		expect(adj.event_overrides).toEqual([]);
		// sku_adjustments replaced wholesale by branch (array semantics).
		expect(adj.sku_adjustments).toEqual([
			{ sku: "banana_cake", dow: "Wed", multiplier: 0.85, reason: "learned 2026-05-28" },
		]);
	});
});
