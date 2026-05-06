import { describe, it, expect } from "vitest";
import { simulateOutcome, type Quantiles } from "@/lib/simulation";

describe("simulation engine", () => {
	it("returns zero stockout when bake exceeds q0.9", () => {
		const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const out = simulateOutcome(q, 200);
		expect(out.expectedStockoutProb).toBeLessThan(0.05);
		expect(out.expectedWasteUnits).toBeGreaterThan(80); // bake 200, demand ~100 → ~100 wasted
		expect(out.expectedUnitsSold).toBeLessThan(120);
	});

	it("returns ~zero waste when bake is below q0.1", () => {
		const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const out = simulateOutcome(q, 50);
		expect(out.expectedWasteUnits).toBeLessThan(1);
		expect(out.expectedStockoutProb).toBeGreaterThan(0.95);
	});

	it("balances at the median for symmetric forecast", () => {
		const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const out = simulateOutcome(q, 100);
		expect(out.expectedStockoutProb).toBeCloseTo(0.5, 1);
	});

	it("monotonic — higher bake => lower stockout, higher waste", () => {
		const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
		const lo = simulateOutcome(q, 80);
		const hi = simulateOutcome(q, 120);
		expect(hi.expectedStockoutProb).toBeLessThan(lo.expectedStockoutProb);
		expect(hi.expectedWasteUnits).toBeGreaterThan(lo.expectedWasteUnits);
	});
});
