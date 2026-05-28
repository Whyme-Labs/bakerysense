import { describe, it, expect } from "vitest";
import {
	dayOfWeek,
	computeForecastMultiplier,
	applyForecastOverlay,
	resolveCostRatio,
} from "@/lib/harness/overlay";
import type { Rules } from "@/lib/harness/resolver";

describe("dayOfWeek", () => {
	it("maps ISO dates to weekday labels in UTC", () => {
		expect(dayOfWeek("2026-05-27")).toBe("Wed");
		expect(dayOfWeek("2026-05-28")).toBe("Thu");
		expect(dayOfWeek("2026-05-31")).toBe("Sun");
	});
});

describe("computeForecastMultiplier", () => {
	const baseRules: Rules = {
		post_forecast_adjustments: {
			dow_multipliers: { Mon: 1.0, Tue: 1.0, Wed: 0.85, Thu: 1.0, Fri: 1.18, Sat: 1.3, Sun: 0.9 },
			event_overrides: { school_holiday: { multiplier: 1.12, scope: "all" } },
			sku_adjustments: { "banana_cake|Wed": { multiplier: 0.9 } },
		},
		guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0 },
	};

	it("applies day-of-week factor", () => {
		const o = computeForecastMultiplier(baseRules, "croissant", "2026-05-29"); // Fri
		expect(o.factors.dow).toBe(1.18);
		expect(o.multiplier).toBeCloseTo(1.18);
	});

	it("stacks sku adjustment on top of dow when dow matches", () => {
		const o = computeForecastMultiplier(baseRules, "banana_cake", "2026-05-27"); // Wed
		expect(o.factors.dow).toBe(0.85);
		expect(o.factors.sku).toBe(0.9);
		expect(o.multiplier).toBeCloseTo(0.85 * 0.9);
	});

	it("ignores sku adjustment when dow filter does not match", () => {
		const o = computeForecastMultiplier(baseRules, "banana_cake", "2026-05-29"); // Fri
		expect(o.factors.sku).toBe(1);
		expect(o.multiplier).toBeCloseTo(1.18);
	});

	it("applies event override only when event is active", () => {
		const without = computeForecastMultiplier(baseRules, "croissant", "2026-05-25"); // Mon
		expect(without.factors.events).toBe(1);
		const withEvent = computeForecastMultiplier(baseRules, "croissant", "2026-05-25", ["school_holiday"]);
		expect(withEvent.factors.events).toBe(1.12);
		expect(withEvent.multiplier).toBeCloseTo(1.12);
	});

	it("clamps a runaway stack to the ceiling and flags it", () => {
		const rules: Rules = {
			post_forecast_adjustments: {
				dow_multipliers: { Sat: 1.8 },
				event_overrides: { festival: { multiplier: 1.8, scope: "all" } },
				sku_adjustments: {},
			},
			guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0 },
		};
		const o = computeForecastMultiplier(rules, "croissant", "2026-05-30", ["festival"]); // Sat
		// raw = 1.8 * 1.8 = 3.24 → clamped to 2.0
		expect(o.multiplier).toBe(2.0);
		expect(o.factors.clamped).toBe(true);
	});

	it("returns 1.0 no-op for fresh tenant rules (all defaults)", () => {
		const fresh: Rules = {
			post_forecast_adjustments: {
				dow_multipliers: { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1, Sun: 1 },
				event_overrides: {},
				sku_adjustments: {},
			},
			guardrails: { multiplier_floor: 0.5, multiplier_ceiling: 2.0 },
		};
		const o = computeForecastMultiplier(fresh, "anything", "2026-05-27");
		expect(o.multiplier).toBe(1);
		expect(o.factors.clamped).toBe(false);
	});

	it("tolerates missing/malformed rule sections (defaults to 1.0)", () => {
		expect(computeForecastMultiplier({}, "x", "2026-05-27").multiplier).toBe(1);
		expect(computeForecastMultiplier({ post_forecast_adjustments: "junk" } as Rules, "x", "2026-05-27").multiplier).toBe(1);
	});
});

describe("applyForecastOverlay", () => {
	it("multiplies every quantile and clamps at zero", () => {
		const q = { "q0.5": 100, "q0.7": 120, "q0.9": 150 };
		const out = applyForecastOverlay(q, { multiplier: 0.85, factors: { dow: 0.85, events: 1, sku: 1, clamped: false } });
		expect(out).toEqual({ "q0.5": 85, "q0.7": 102, "q0.9": 127.5 });
	});

	it("returns a copy unchanged when multiplier is 1.0", () => {
		const q = { "q0.5": 100 };
		const out = applyForecastOverlay(q, { multiplier: 1, factors: { dow: 1, events: 1, sku: 1, clamped: false } });
		expect(out).toEqual(q);
		expect(out).not.toBe(q);
	});
});

describe("resolveCostRatio", () => {
	const fallback = { cu: 2, co: 1 };
	it("uses rule value when valid", () => {
		expect(resolveCostRatio({ newsvendor_cost_ratio: { cu: 3, co: 1 } }, fallback)).toEqual({ cu: 3, co: 1 });
	});
	it("falls back when missing", () => {
		expect(resolveCostRatio({}, fallback)).toEqual(fallback);
	});
	it("falls back when non-positive or malformed", () => {
		expect(resolveCostRatio({ newsvendor_cost_ratio: { cu: 0, co: 1 } }, fallback)).toEqual(fallback);
		expect(resolveCostRatio({ newsvendor_cost_ratio: { cu: "x", co: 1 } } as Rules, fallback)).toEqual(fallback);
	});
});
