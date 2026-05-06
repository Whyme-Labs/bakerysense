import { describe, it, expect } from "vitest";
import { generatePlanOptions } from "@/lib/plan-options";

describe("plan options generator", () => {
	it("emits three options ordered conservative ≤ balanced ≤ aggressive", () => {
		const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const opts = generatePlanOptions(q, { cu: 1, co: 1 });
		expect(opts.conservative.bakeQuantity).toBeLessThanOrEqual(opts.balanced.bakeQuantity);
		expect(opts.balanced.bakeQuantity).toBeLessThanOrEqual(opts.aggressive.bakeQuantity);
	});

	it("each option carries a simulated outcome", () => {
		const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const opts = generatePlanOptions(q, { cu: 1, co: 1 });
		for (const o of [opts.conservative, opts.balanced, opts.aggressive]) {
			expect(o.outcome.expectedWasteUnits).toBeGreaterThanOrEqual(0);
			expect(o.outcome.expectedStockoutProb).toBeGreaterThanOrEqual(0);
			expect(o.outcome.expectedStockoutProb).toBeLessThanOrEqual(1);
		}
	});

	it("balanced shifts down when waste is more painful (Cu=1,Co=3 vs Cu=3,Co=1)", () => {
		// Cu=1, Co=3 → target quantile = 1/(1+3) = 0.25 → lower bake
		// Cu=3, Co=1 → target quantile = 3/(3+1) = 0.75 → higher bake
		const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const highWasteCost = generatePlanOptions(q, { cu: 1, co: 3 });
		const highStockoutCost = generatePlanOptions(q, { cu: 3, co: 1 });
		expect(highWasteCost.balanced.bakeQuantity).toBeLessThan(
			highStockoutCost.balanced.bakeQuantity,
		);
	});

	it("kind labels are correct on each option", () => {
		const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const opts = generatePlanOptions(q, { cu: 1, co: 1 });
		expect(opts.conservative.kind).toBe("conservative");
		expect(opts.balanced.kind).toBe("balanced");
		expect(opts.aggressive.kind).toBe("aggressive");
	});
});
