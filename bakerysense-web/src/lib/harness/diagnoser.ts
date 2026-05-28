// Miss diagnoser — classifies a single forecast miss into one of seven
// causes, in a deterministic priority order. Only some causes are
// "learnable" (feed the proposer); the rest are excluded so the harness
// never learns from censored, operator-driven, or one-off-event noise.
//
// This is the EmbodiSkill contribution to the loop: distinguish a genuine
// skill fault from an execution lapse or an environmental shock before
// editing any skill. Getting this wrong is how a self-evolving system
// learns itself off a cliff — see docs/architecture/self-evolving-harness.md
// §6 step 2 and the pressure-test findings that produced this ordering.
//
// Priority (top wins; first match returned):
//   1. stockout_capped         — demand was censored (sold == baked, no
//                                waste). The "miss" is a lower bound only;
//                                trusting it teaches a false downward push.
//   2. operator_correction     — operator deviated from the recommendation
//                                AND their bake was closer to realized
//                                demand than the forecast. Tacit operator
//                                knowledge — LEARN from it.
//   3. operator_override       — operator deviated but was NOT closer.
//                                Execution noise — exclude.
//   4. context_shock_recurring — a known event is active AND it historically
//                                correlates with misses for this SKU. The
//                                fix is a model feature, not a multiplier —
//                                escalate to engineering, don't propose.
//   5. context_shock_one_off   — a known event is active with no historical
//                                correlation. One-time noise — exclude.
//   6. skill_error             — unexplained miss above threshold. LEARN.
//   7. insufficient_evidence   — below the miss threshold. No action.
//
// Pure module — no I/O. The inspector supplies the joined trace + actuals
// row and the resolved event context.

export type DiagnosisCause =
	| "stockout_capped"
	| "operator_correction"
	| "operator_override"
	| "context_shock_recurring"
	| "context_shock_one_off"
	| "skill_error"
	| "insufficient_evidence";

export interface DiagnosisInput {
	sku: string;
	/** ISO date of the decision/actual. */
	date: string;
	/** The forecast-driven recommended quantity whose error we're judging
	 *  (e.g. daily_actuals.recommendedBake). */
	forecast: number;
	/** Units actually sold. NOTE: censored when a stockout occurred — the
	 *  priority-1 check guards against trusting it in that case. */
	actualSales: number;
	/** Units actually baked. Null when not captured. */
	actualBake: number | null;
	/** Leftover units. Null when not captured. */
	wasteUnits: number | null;
	/** True when the operator committed a non-recommended option or
	 *  overrode the recommended quantity. */
	operatorDeviated: boolean;
	/** Event keys in effect on the date at the branch (festival / promo /
	 *  weather labels). Default []. */
	activeEvents?: string[];
	/** Subset of event keys that historically correlate with misses for
	 *  this SKU at this branch. Default []. The inspector computes this
	 *  from history; the diagnoser only checks membership. */
	recurringEvents?: string[];
}

export interface DiagnosisConfig {
	/** Relative-error threshold above which a row counts as a "miss".
	 *  Default 0.15 (matches skill.rules.json evidence.miss_threshold). */
	missThreshold: number;
}

export interface Diagnosis {
	cause: DiagnosisCause;
	/** Machine-readable reason for the classification (which rule fired). */
	reasonCode: string;
	/** Evidence values behind the classification, for audit + the proposer. */
	reasonPayload: Record<string, unknown>;
	/** True only for causes the proposer should act on. */
	learnable: boolean;
	/** True when the miss should be filed as an engineering task rather than
	 *  a rules.json edit (recurring unmodeled event). */
	escalate: boolean;
}

const DEFAULT_CONFIG: DiagnosisConfig = { missThreshold: 0.15 };

/** Relative error of the forecast against realized sales. Guards a zero
 *  denominator so a single zero-sales day can't produce Infinity. */
export function relativeError(forecast: number, actualSales: number): number {
	return Math.abs(forecast - actualSales) / Math.max(actualSales, 1);
}

export function diagnoseMiss(
	input: DiagnosisInput,
	config: DiagnosisConfig = DEFAULT_CONFIG,
): Diagnosis {
	const { sku, date, forecast, actualSales, actualBake, wasteUnits } = input;
	const activeEvents = input.activeEvents ?? [];
	const recurringEvents = input.recurringEvents ?? [];

	const errRatio = relativeError(forecast, actualSales);
	const direction = forecast > actualSales ? "over" : "under";
	const base = { sku, date, forecast, actualSales, errRatio: round(errRatio), direction };

	// 7. Below threshold → not a miss worth acting on.
	if (errRatio <= config.missThreshold) {
		return mk("insufficient_evidence", "below_miss_threshold", base, false, false);
	}

	// 1. Stockout cap. Sold everything baked with zero waste → demand was
	//    censored; the apparent miss is a lower bound only. Excluded
	//    regardless of any other signal (a censored row can't be trusted).
	const waste = wasteUnits ?? 0;
	const stockedOut = actualBake !== null && actualSales >= actualBake && waste === 0;
	if (stockedOut) {
		return mk(
			"stockout_capped",
			"sold_ge_bake_zero_waste",
			{ ...base, actualBake, wasteUnits: waste },
			false,
			false,
		);
	}

	// 2/3. Operator deviation. Decide correction vs override by whether the
	//      operator's bake landed closer to realized demand than the
	//      forecast did. (Not stocked out here, so actualSales is true
	//      demand — the comparison is valid.)
	if (input.operatorDeviated && actualBake !== null) {
		const operatorErr = Math.abs(actualBake - actualSales);
		const forecastErr = Math.abs(forecast - actualSales);
		const payload = { ...base, actualBake, operatorErr, forecastErr };
		if (operatorErr < forecastErr) {
			return mk("operator_correction", "operator_bake_closer_to_demand", payload, true, false);
		}
		return mk("operator_override", "operator_deviation_not_closer", payload, false, false);
	}

	// 4/5. Context events.
	const recurringHits = activeEvents.filter((e) => recurringEvents.includes(e));
	if (recurringHits.length > 0) {
		return mk(
			"context_shock_recurring",
			"recurring_event_correlated",
			{ ...base, events: recurringHits },
			false,
			true, // escalate: needs a model feature, not a multiplier
		);
	}
	if (activeEvents.length > 0) {
		return mk(
			"context_shock_one_off",
			"one_off_event_present",
			{ ...base, events: activeEvents },
			false,
			false,
		);
	}

	// 6. Unexplained miss above threshold → genuine skill fault.
	return mk("skill_error", "unexplained_miss", base, true, false);
}

function mk(
	cause: DiagnosisCause,
	reasonCode: string,
	reasonPayload: Record<string, unknown>,
	learnable: boolean,
	escalate: boolean,
): Diagnosis {
	return { cause, reasonCode, reasonPayload, learnable, escalate };
}

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}
