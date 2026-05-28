import { describe, it, expect } from "vitest";
import { diagnoseMiss, relativeError, type DiagnosisInput } from "@/lib/harness/diagnoser";

// Convenience: a baseline row that is a clear skill_error, which individual
// tests mutate to trigger other causes.
function row(over: Partial<DiagnosisInput> = {}): DiagnosisInput {
	return {
		sku: "banana_cake",
		date: "2026-05-27", // Wed
		forecast: 100,
		actualSales: 80, // 25% over-forecast → above 0.15 threshold
		actualBake: 100,
		wasteUnits: 20,
		operatorDeviated: false,
		activeEvents: [],
		recurringEvents: [],
		...over,
	};
}

describe("relativeError", () => {
	it("guards a zero denominator", () => {
		expect(relativeError(10, 0)).toBe(10); // /max(0,1)
	});
	it("computes symmetric absolute relative error", () => {
		expect(relativeError(120, 100)).toBeCloseTo(0.2);
		expect(relativeError(80, 100)).toBeCloseTo(0.2);
	});
});

describe("diagnoseMiss — priority-ordered classification", () => {
	it("7. insufficient_evidence when miss is below threshold", () => {
		const d = diagnoseMiss(row({ forecast: 105, actualSales: 100 })); // 5%
		expect(d.cause).toBe("insufficient_evidence");
		expect(d.learnable).toBe(false);
	});

	it("1. stockout_capped when sold == baked and zero waste", () => {
		const d = diagnoseMiss(row({ forecast: 100, actualSales: 80, actualBake: 80, wasteUnits: 0 }));
		expect(d.cause).toBe("stockout_capped");
		expect(d.learnable).toBe(false);
		expect(d.reasonCode).toBe("sold_ge_bake_zero_waste");
	});

	it("1. stockout_capped beats operator deviation (censored row can't be trusted)", () => {
		// Operator under-baked AND stocked out — both signals present.
		const d = diagnoseMiss(row({
			forecast: 100, actualSales: 60, actualBake: 60, wasteUnits: 0,
			operatorDeviated: true,
		}));
		expect(d.cause).toBe("stockout_capped");
	});

	it("2. operator_correction when operator bake is closer to realized demand", () => {
		// Forecast 100, operator baked 85, demand 80 (not stocked out: waste 5).
		const d = diagnoseMiss(row({
			forecast: 100, actualSales: 80, actualBake: 85, wasteUnits: 5,
			operatorDeviated: true,
		}));
		expect(d.cause).toBe("operator_correction");
		expect(d.learnable).toBe(true);
		expect(d.reasonPayload.operatorErr).toBe(5);
		expect(d.reasonPayload.forecastErr).toBe(20);
	});

	it("3. operator_override when operator deviated but was not closer", () => {
		// Operator baked 130 (err 50) vs forecast 100 (err 20) — worse.
		const d = diagnoseMiss(row({
			forecast: 100, actualSales: 80, actualBake: 130, wasteUnits: 50,
			operatorDeviated: true,
		}));
		expect(d.cause).toBe("operator_override");
		expect(d.learnable).toBe(false);
	});

	it("4. context_shock_recurring when an active event historically correlates", () => {
		const d = diagnoseMiss(row({
			activeEvents: ["school_holiday"],
			recurringEvents: ["school_holiday"],
		}));
		expect(d.cause).toBe("context_shock_recurring");
		expect(d.learnable).toBe(false);
		expect(d.escalate).toBe(true);
		expect(d.reasonPayload.events).toEqual(["school_holiday"]);
	});

	it("4. recurring beats one-off when both kinds of events are active", () => {
		const d = diagnoseMiss(row({
			activeEvents: ["heatwave", "school_holiday"],
			recurringEvents: ["school_holiday"],
		}));
		expect(d.cause).toBe("context_shock_recurring");
		expect(d.reasonPayload.events).toEqual(["school_holiday"]);
	});

	it("5. context_shock_one_off when an active event has no historical correlation", () => {
		const d = diagnoseMiss(row({ activeEvents: ["random_parade"], recurringEvents: [] }));
		expect(d.cause).toBe("context_shock_one_off");
		expect(d.learnable).toBe(false);
		expect(d.escalate).toBe(false);
	});

	it("6. skill_error for an unexplained miss above threshold", () => {
		const d = diagnoseMiss(row()); // forecast 100, sales 80, waste 20, no events, no deviation
		expect(d.cause).toBe("skill_error");
		expect(d.learnable).toBe(true);
		expect(d.reasonPayload.direction).toBe("over");
	});

	it("records under-forecast direction", () => {
		const d = diagnoseMiss(row({ forecast: 80, actualSales: 110, actualBake: 80, wasteUnits: 0 }));
		// sold(110) >= baked(80) & zero waste → stockout_capped (correct: censored)
		expect(d.cause).toBe("stockout_capped");
	});

	it("under-forecast with leftover waste is a learnable skill_error", () => {
		// Forecast 80, demand 110, but baked 130 so there's waste → not censored.
		const d = diagnoseMiss(row({ forecast: 80, actualSales: 110, actualBake: 130, wasteUnits: 20 }));
		expect(d.cause).toBe("skill_error");
		expect(d.reasonPayload.direction).toBe("under");
		expect(d.learnable).toBe(true);
	});

	it("operator deviation with null actualBake falls through to event/skill logic", () => {
		const d = diagnoseMiss(row({ operatorDeviated: true, actualBake: null }));
		expect(d.cause).toBe("skill_error"); // can't judge operator without a bake number
	});

	it("respects a custom miss threshold", () => {
		const d = diagnoseMiss(row({ forecast: 110, actualSales: 100, actualBake: 110, wasteUnits: 10 }), { missThreshold: 0.05 });
		expect(d.cause).toBe("skill_error"); // 10% > 5% threshold, not censored
	});

	it("only operator_correction and skill_error are learnable across all causes", () => {
		const cases: DiagnosisInput[] = [
			row({ forecast: 101, actualSales: 100, actualBake: 101, wasteUnits: 1 }), // insufficient
			row({ forecast: 100, actualSales: 80, actualBake: 80, wasteUnits: 0 }), // stockout
			row({ forecast: 100, actualSales: 80, actualBake: 85, wasteUnits: 5, operatorDeviated: true }), // correction
			row({ forecast: 100, actualSales: 80, actualBake: 130, wasteUnits: 50, operatorDeviated: true }), // override
			row({ activeEvents: ["x"], recurringEvents: ["x"] }), // recurring
			row({ activeEvents: ["y"] }), // one-off
			row(), // skill_error
		];
		const learnable = cases.map((c) => diagnoseMiss(c).cause).filter((_, i) => diagnoseMiss(cases[i]).learnable);
		expect(new Set(learnable)).toEqual(new Set(["operator_correction", "skill_error"]));
	});
});
