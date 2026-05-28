// Forecast overlay — applies the harness-learned `post_forecast_adjustments`
// as a multiplicative correction on top of whatever the deterministic
// forecaster (GBM / prior / TimesFM blend) produced, BEFORE newsvendor
// selection.
//
// This is the seam that makes the evolvable surface actually evolve: the
// forecaster artifact stays frozen; the harness only ever edits the
// multipliers in skill.rules.json (via validated, owner-approved bounded
// edits). A fresh tenant's rules are all 1.0 — a no-op — so the overlay is
// safe to apply uniformly across cold / warm / mature paths. Corrections
// only appear once the harness has learned them from THIS tenant's actuals,
// at which point the tenant is no longer cold.
//
// The multiplier is a RESIDUAL correction, not a replacement: a learned
// 0.85 on Wednesday means "the forecaster is still ~18% high on Wednesdays
// for this SKU", layered on top of whatever seasonality the model already
// captures.
//
// Pure module — no I/O. The caller loads rules via the registry and passes
// the active events for the date.
import type { Rules } from "./resolver";

// getUTCDay() index → label used in skill.rules.json dow_multipliers.
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayOfWeek(isoDate: string): string {
	// Parse as UTC midnight so the weekday never drifts with the runtime tz.
	const d = new Date(`${isoDate}T00:00:00Z`);
	return DOW_LABELS[d.getUTCDay()];
}

export interface ForecastOverlay {
	/** Total multiplier applied to every quantile, after clamping. */
	multiplier: number;
	/** Per-source breakdown, for the trace / explanation. */
	factors: {
		dow: number;
		events: number;
		sku: number;
		clamped: boolean;
	};
}

function asObject(v: unknown): Record<string, unknown> | undefined {
	return typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}
function asFiniteNumber(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Compute the total multiplicative correction for one (sku, date) from the
 *  effective rules. activeEvents is the set of event keys in effect on the
 *  date at the branch (festival / promo / weather labels); pass [] when not
 *  wired. */
export function computeForecastMultiplier(
	rules: Rules,
	sku: string,
	isoDate: string,
	activeEvents: string[] = [],
): ForecastOverlay {
	const adj = asObject(rules.post_forecast_adjustments) ?? {};
	const dow = dayOfWeek(isoDate);

	// 1. Day-of-week multiplier.
	const dowMap = asObject(adj.dow_multipliers) ?? {};
	const dowFactor = asFiniteNumber(dowMap[dow]) ?? 1;

	// 2. Event overrides — keyed by event name. Apply every override whose
	//    event is active and whose scope is "all" or equals this SKU.
	let eventFactor = 1;
	const events = asObject(adj.event_overrides) ?? {};
	const activeSet = new Set(activeEvents);
	for (const [eventName, raw] of Object.entries(events)) {
		if (!activeSet.has(eventName)) continue;
		const e = asObject(raw);
		if (!e) continue;
		const scope = typeof e.scope === "string" ? e.scope : "all";
		if (scope !== "all" && scope !== sku) continue;
		eventFactor *= asFiniteNumber(e.multiplier) ?? 1;
	}

	// 3. SKU adjustments — keyed by `${sku}|${dow}` (dow may be "*" for all
	//    days). Apply every entry for this SKU whose dow filter matches.
	let skuFactor = 1;
	const skuAdj = asObject(adj.sku_adjustments) ?? {};
	for (const [key, raw] of Object.entries(skuAdj)) {
		const sep = key.indexOf("|");
		const aSku = sep >= 0 ? key.slice(0, sep) : key;
		const aDow = sep >= 0 ? key.slice(sep + 1) : "*";
		if (aSku !== sku) continue;
		if (aDow !== "*" && aDow !== dow) continue;
		const a = asObject(raw);
		if (!a) continue;
		skuFactor *= asFiniteNumber(a.multiplier) ?? 1;
	}

	// 4. Clamp the TOTAL to the guardrail band so a stack of corrections
	//    can't run away (defense-in-depth — the proposer also clamps per-op).
	const guardrails = asObject(rules.guardrails) ?? {};
	const floor = asFiniteNumber(guardrails.multiplier_floor) ?? 0.5;
	const ceiling = asFiniteNumber(guardrails.multiplier_ceiling) ?? 2.0;
	const raw = dowFactor * eventFactor * skuFactor;
	const clampedVal = Math.min(ceiling, Math.max(floor, raw));

	return {
		multiplier: clampedVal,
		factors: {
			dow: dowFactor,
			events: eventFactor,
			sku: skuFactor,
			clamped: clampedVal !== raw,
		},
	};
}

/** Apply the overlay multiplier to every quantile value. */
export function applyForecastOverlay(
	quantiles: Record<string, number>,
	overlay: ForecastOverlay,
): Record<string, number> {
	if (overlay.multiplier === 1) return { ...quantiles };
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(quantiles)) out[k] = Math.max(0, v * overlay.multiplier);
	return out;
}

/** Resolve the newsvendor cost ratio from rules, falling back to the
 *  caller's default when the rule is absent or malformed. */
export function resolveCostRatio(
	rules: Rules,
	fallback: { cu: number; co: number },
): { cu: number; co: number } {
	const cr = asObject(rules.newsvendor_cost_ratio);
	if (!cr) return fallback;
	const cu = asFiniteNumber(cr.cu);
	const co = asFiniteNumber(cr.co);
	if (cu === undefined || co === undefined || cu <= 0 || co <= 0) return fallback;
	return { cu, co };
}
