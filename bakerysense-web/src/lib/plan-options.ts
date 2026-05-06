// Plan options generator — pure function, no DB.
//
// Given a quantile forecast and cost ratio (Cu/Co), emits three candidate bake
// quantities (conservative p=0.3 / balanced newsvendor optimum / aggressive p=0.8),
// each annotated with its SimulatedOutcome. Quantile interpolation is piecewise-
// linear between anchors; head/tail extend the adjacent segment's slope.

import { simulateOutcome, type Quantiles, type SimulatedOutcome } from "./simulation";

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

// Interpolate the demand value at a given target probability `p` from the
// quantile forecast. Uses piecewise-linear interpolation between anchor points.
// Below the minimum anchor: extend the slope of the first segment (floored at 0).
// Above the maximum anchor: extend the slope of the last segment.
function interpolateQuantile(q: Quantiles, p: number): number {
	const entries = Object.entries(q)
		.map(([prob, x]) => [parseFloat(prob), x] as [number, number])
		.sort((a, b) => a[0] - b[0]);

	const [p0, x0] = entries[0];
	const [pN, xN] = entries[entries.length - 1];

	// Below minimum anchor — extend slope of first segment
	if (p <= p0) {
		if (entries.length < 2) return x0;
		const [p1, x1] = entries[1];
		const slope = (p1 - p0) > 0 ? (x1 - x0) / (p1 - p0) : 0;
		return Math.max(0, x0 + (p - p0) * slope);
	}

	// Above maximum anchor — extend slope of last segment
	if (p >= pN) {
		if (entries.length < 2) return xN;
		const [pNm1, xNm1] = entries[entries.length - 2];
		const slope = (pN - pNm1) > 0 ? (xN - xNm1) / (pN - pNm1) : 0;
		return xN + (p - pN) * slope;
	}

	// Interior — find the surrounding segment and interpolate linearly
	for (let i = 0; i < entries.length - 1; i++) {
		const [pi, xi] = entries[i];
		const [pi1, xi1] = entries[i + 1];
		if (p >= pi && p <= pi1) {
			const t = (pi1 - pi) > 0 ? (p - pi) / (pi1 - pi) : 0;
			return xi + t * (xi1 - xi);
		}
	}

	// Fallback (should not be reached for well-formed inputs)
	return xN;
}

export function generatePlanOptions(
	q: Quantiles,
	cost: { cu: number; co: number },
): PlanOptionSet {
	const { cu, co } = cost;

	// Newsvendor critical ratio: Cu / (Cu + Co)
	const balancedTarget = cu / (cu + co);

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
