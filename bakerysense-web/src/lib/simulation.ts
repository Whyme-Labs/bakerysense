//
// Quantile-newsvendor outcome simulation.
//
// Given a demand forecast expressed as quantile anchor points and a candidate
// bake quantity, returns:
//   - expectedWasteUnits    — E[max(bake - demand, 0)]
//   - expectedStockoutProb  — P(demand > bake)
//   - expectedUnitsSold     — E[min(bake, demand)]
//
// The integral over the demand distribution is approximated by piecewise-
// linear interpolation between adjacent quantile pairs. Between quantiles
// (p_i, x_i) and (p_{i+1}, x_{i+1}), demand is treated as uniform on
// [x_i, x_{i+1}] with probability mass (p_{i+1} - p_i). The head
// (below p_0) and tail (above p_last) extend the adjacent segment's slope,
// capping the lower end at zero demand.
//
// Pure math — no DB, no HTTP, no filesystem.
// Assumption: input must have ≥ 2 distinct quantile points ordered by x-value.

export type Quantiles = Record<number, number>;
// Numeric keys in (0, 1) mapping to predicted demand units.
// E.g. { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 }

export interface SimulatedOutcome {
	expectedWasteUnits: number;
	expectedStockoutProb: number;
	expectedUnitsSold: number;
}

// Integrate ∫ max(bake - demand, 0) * f(demand) d(demand) over the uniform
// segment [xLo, xHi] with probability mass `mass`.
// When xLo == xHi (degenerate / zero-variance segment) treat as point mass.
function segmentWaste(xLo: number, xHi: number, mass: number, bake: number): number {
	if (xLo >= xHi) {
		// Point mass at xLo
		return mass * Math.max(bake - xLo, 0);
	}
	// Demand ~ Uniform[xLo, xHi]; f(d) = mass / (xHi - xLo)
	const width = xHi - xLo;
	const density = mass / width;
	// Split at bake
	const lo = xLo;
	const hi = Math.min(bake, xHi);
	if (hi <= lo) return 0; // bake <= xLo: no waste in this segment
	// ∫_{lo}^{hi} (bake - d) * density d(d)
	//   = density * [bake*(d) - d²/2]_{lo}^{hi}
	//   = density * (bake*(hi-lo) - (hi²-lo²)/2)
	return density * (bake * (hi - lo) - (hi * hi - lo * lo) / 2);
}

// Probability mass where demand > bake in segment [xLo, xHi] with mass `mass`.
function segmentStockoutProb(xLo: number, xHi: number, mass: number, bake: number): number {
	if (xLo >= xHi) {
		return xLo > bake ? mass : 0;
	}
	const exceedLo = Math.max(xLo, bake);
	if (exceedLo >= xHi) return 0;
	// Fraction of [xLo,xHi] that is > bake
	return mass * (xHi - exceedLo) / (xHi - xLo);
}

export function simulateOutcome(q: Quantiles, bakeQuantity: number): SimulatedOutcome {
	// Sort entries by probability ascending
	const entries = Object.entries(q)
		.map(([p, x]) => [parseFloat(p), x] as [number, number])
		.sort((a, b) => a[0] - b[0]);

	if (entries.length < 2) {
		throw new Error("simulateOutcome: input must have ≥ 2 distinct quantile points");
	}

	const [p0, x0] = entries[0];
	const [pN, xN] = entries[entries.length - 1];

	// Build head segment: extend slope of first interior segment back to prob=0.
	// slope = dx/dp of first segment
	const [p1, x1] = entries[1];
	const slopeHead = (p1 - p0) > 0 ? (x1 - x0) / (p1 - p0) : 0;
	// x at p=0: extrapolate x0 - p0 * slopeHead, clamped to 0
	const xHeadLo = Math.max(0, x0 - p0 * slopeHead);
	const xHeadHi = x0;
	const massHead = p0;

	// Build tail segment: extend slope of last interior segment forward to prob=1.
	const [pNm1, xNm1] = entries[entries.length - 2];
	const slopeTail = (pN - pNm1) > 0 ? (xN - xNm1) / (pN - pNm1) : 0;
	// x at p=1: extrapolate xN + (1 - pN) * slopeTail
	const xTailLo = xN;
	const xTailHi = xN + (1 - pN) * slopeTail;
	const massTail = 1 - pN;

	let totalWaste = 0;
	let totalStockout = 0;

	// Head segment
	totalWaste += segmentWaste(xHeadLo, xHeadHi, massHead, bakeQuantity);
	totalStockout += segmentStockoutProb(xHeadLo, xHeadHi, massHead, bakeQuantity);

	// Interior segments
	for (let i = 0; i < entries.length - 1; i++) {
		const [pi, xi] = entries[i];
		const [pi1, xi1] = entries[i + 1];
		const mass = pi1 - pi;
		totalWaste += segmentWaste(xi, xi1, mass, bakeQuantity);
		totalStockout += segmentStockoutProb(xi, xi1, mass, bakeQuantity);
	}

	// Tail segment
	totalWaste += segmentWaste(xTailLo, xTailHi, massTail, bakeQuantity);
	totalStockout += segmentStockoutProb(xTailLo, xTailHi, massTail, bakeQuantity);

	// expectedUnitsSold = bake - waste + shortage_units is equivalent but
	// we use the simpler identity: E[min(bake, d)] = bake - E[max(bake-d,0)].
	// This holds unconditionally (it's algebraic: min(b,d) = b - max(b-d,0)).
	const expectedUnitsSold = bakeQuantity - totalWaste;

	return {
		expectedWasteUnits: totalWaste,
		expectedStockoutProb: totalStockout,
		expectedUnitsSold,
	};
}
