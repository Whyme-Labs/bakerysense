// Plan options generator — pure function, no DB.
//
// Given a quantile forecast and cost ratio (Cu/Co), emits three candidate bake
// quantities (conservative p=0.3 / balanced newsvendor optimum / aggressive p=0.8),
// each annotated with its SimulatedOutcome. Quantile interpolation is piecewise-
// linear between anchors; head/tail extend the adjacent segment's slope.

import { simulateOutcome, interpolateQuantile, type Quantiles, type SimulatedOutcome } from "./simulation";

export interface PlanOption {
	kind: "conservative" | "balanced" | "aggressive";
	bakeQuantity: number;
	outcome: SimulatedOutcome;
}

export interface PlanOptionSet {
	conservative: PlanOption;
	balanced: PlanOption;
	aggressive: PlanOption;
}

export function generatePlanOptions(
	q: Quantiles,
	cost: { cu: number; co: number },
): PlanOptionSet {
	if (cost.cu + cost.co <= 0) {
		throw new Error("plan-options: cu + co must be positive (got cu=" + cost.cu + ", co=" + cost.co + ")");
	}

	// Newsvendor critical ratio: Cu / (Cu + Co)
	// Clamp the newsvendor target to the [conservative, aggressive] window so the
	// three-option presentation always preserves "conservative ≤ balanced ≤ aggressive."
	// At extreme cost ratios, the unclamped optimum lies outside this window — surfacing
	// it would make "balanced" misleadingly more extreme than "aggressive" or "conservative".
	// V1 chooses the simpler UX: clamp + comment. Revisit when a real merchant pushes on it.
	const rawTarget = cost.cu / (cost.cu + cost.co);
	const balancedTarget = Math.min(0.8, Math.max(0.3, rawTarget));

	const conservativeQty = Math.round(interpolateQuantile(q, 0.3));
	const balancedQty = Math.round(interpolateQuantile(q, balancedTarget));
	const aggressiveQty = Math.round(interpolateQuantile(q, 0.8));

	return {
		conservative: {
			kind: "conservative",
			bakeQuantity: conservativeQty,
			outcome: simulateOutcome(q, conservativeQty),
		},
		balanced: {
			kind: "balanced",
			bakeQuantity: balancedQty,
			outcome: simulateOutcome(q, balancedQty),
		},
		aggressive: {
			kind: "aggressive",
			bakeQuantity: aggressiveQty,
			outcome: simulateOutcome(q, aggressiveQty),
		},
	};
}
