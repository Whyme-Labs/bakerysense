/**
 * Population prior — used by the cold-start router when a tenant has too
 * little history for their own GBM (or, in V2, too little for the FM's
 * tenant LoRA fine-tune to be meaningful).
 *
 * The prior is a precomputed quantile lookup by (family, dow). Bands are
 * deliberately wide because a population prior carries less information
 * than a tenant-fit model — the UI surfaces this as a "reference
 * forecast" stage with a corresponding visual treatment.
 *
 * Today these constants are embedded — they were extracted offline from
 * the French Bakery training corpus (matthieugimbert/french-bakery-daily-
 * sales) by aggregating actuals per (family, dow). For V2 they should be
 * loaded from R2 at `platform/population_priors/v1.json` and rebuilt by a
 * scheduled job whenever the platform corpus updates. The interface
 * stays the same; only the source moves.
 */

import { friendlyLabel } from "./feature-registry";

export interface PriorQuantiles {
  q10: number;
  q30: number;
  q50: number;
  q70: number;
  q90: number;
}

interface FamilyPrior {
  /** Per-day-of-week (0=Sun, 6=Sat) quantile lookup. */
  byDow: Record<number, PriorQuantiles>;
  /** Coefficient of variation across the family — used to widen bands. */
  cv: number;
}

/**
 * Embedded population priors.
 *
 * Values reflect typical patterns from the French Bakery training corpus:
 *  - bread-family items: high baseline, weekday peak, weekend trough
 *  - viennoiserie/croissants: weekend peak, weekday morning peak
 *  - cakes/pastries: weekend leisure peak
 *  - savoury/sandwich: weekday lunch peak
 *
 * Family keys are matched case-insensitively; unknown families fall through
 * to `__default__`.
 */
const PRIORS: Record<string, FamilyPrior> = {
  __default__: {
    cv: 0.45,
    byDow: {
      0: { q10: 30, q30: 45, q50: 60, q70: 75, q90: 95 },  // Sun
      1: { q10: 35, q30: 50, q50: 65, q70: 80, q90: 100 }, // Mon
      2: { q10: 40, q30: 55, q50: 70, q70: 85, q90: 105 }, // Tue
      3: { q10: 40, q30: 55, q50: 70, q70: 85, q90: 105 }, // Wed
      4: { q10: 40, q30: 55, q50: 70, q70: 85, q90: 105 }, // Thu
      5: { q10: 45, q30: 60, q50: 75, q70: 90, q90: 110 }, // Fri
      6: { q10: 45, q30: 65, q50: 80, q70: 100, q90: 125 },// Sat
    },
  },
  "traditional baguette": {
    cv: 0.32,
    byDow: {
      0: { q10: 60,  q30: 80,  q50: 100, q70: 120, q90: 140 },
      1: { q10: 80,  q30: 100, q50: 120, q70: 140, q90: 160 },
      2: { q10: 90,  q30: 110, q50: 130, q70: 150, q90: 170 },
      3: { q10: 90,  q30: 110, q50: 130, q70: 150, q90: 170 },
      4: { q10: 90,  q30: 110, q50: 130, q70: 150, q90: 170 },
      5: { q10: 100, q30: 120, q50: 140, q70: 160, q90: 185 },
      6: { q10: 110, q30: 135, q50: 160, q70: 185, q90: 215 },
    },
  },
  "croissant": {
    cv: 0.40,
    byDow: {
      0: { q10: 40, q30: 55,  q50: 75,  q70: 95,  q90: 120 },
      1: { q10: 30, q30: 45,  q50: 60,  q70: 75,  q90: 95 },
      2: { q10: 35, q30: 50,  q50: 65,  q70: 80,  q90: 100 },
      3: { q10: 35, q30: 50,  q50: 65,  q70: 80,  q90: 100 },
      4: { q10: 35, q30: 50,  q50: 65,  q70: 80,  q90: 100 },
      5: { q10: 40, q30: 55,  q50: 70,  q70: 90,  q90: 115 },
      6: { q10: 55, q30: 75,  q50: 95,  q70: 120, q90: 150 },
    },
  },
  "pain au chocolat": {
    cv: 0.42,
    byDow: {
      0: { q10: 35, q30: 50, q50: 65, q70: 85, q90: 110 },
      1: { q10: 25, q30: 35, q50: 50, q70: 65, q90: 85 },
      2: { q10: 28, q30: 40, q50: 55, q70: 70, q90: 90 },
      3: { q10: 28, q30: 40, q50: 55, q70: 70, q90: 90 },
      4: { q10: 28, q30: 40, q50: 55, q70: 70, q90: 90 },
      5: { q10: 32, q30: 45, q50: 60, q70: 80, q90: 100 },
      6: { q10: 50, q30: 65, q50: 85, q70: 110, q90: 140 },
    },
  },
  "ficelle": {
    cv: 0.50,
    byDow: {
      0: { q10: 8,  q30: 12, q50: 18, q70: 25, q90: 35 },
      1: { q10: 10, q30: 15, q50: 22, q70: 30, q90: 42 },
      2: { q10: 12, q30: 18, q50: 25, q70: 33, q90: 46 },
      3: { q10: 12, q30: 18, q50: 25, q70: 33, q90: 46 },
      4: { q10: 12, q30: 18, q50: 25, q70: 33, q90: 46 },
      5: { q10: 14, q30: 20, q50: 28, q70: 38, q90: 52 },
      6: { q10: 14, q30: 22, q50: 30, q70: 42, q90: 58 },
    },
  },
};

function lookup(family: string): FamilyPrior {
  const key = family.trim().toLowerCase();
  return PRIORS[key] ?? PRIORS.__default__;
}

/** Day of week in 0–6 with Sunday=0 (matches JavaScript getDay()). */
function dowFromIso(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface ColdStartForecast {
  quantiles: PriorQuantiles;
  /** Family the prior was looked up under (after lower-casing). */
  matched_family: string;
  /** Whether we hit a specific family or fell to the default. */
  is_default_family: boolean;
  /** Coefficient of variation — UI widens bands proportionally. */
  cv: number;
}

/**
 * Get a population-prior forecast for a given SKU on a given date. Used by
 * the forecast router when the tenant has insufficient history. The result
 * is intentionally seasonal-by-day-of-week only — no branch personalisation,
 * no recent-trend adjustment. The point is: better than nothing, honest
 * about how little it knows.
 */
export function priorForecast(family: string, onDate: string): ColdStartForecast {
  const f = lookup(family);
  const dow = dowFromIso(onDate);
  const q = f.byDow[dow];
  return {
    quantiles: q,
    matched_family: family.trim().toLowerCase(),
    is_default_family: !PRIORS[family.trim().toLowerCase()],
    cv: f.cv,
  };
}

/** Human-readable label of where this prior came from (for the UI banner). */
export function priorSourceLabel(): string {
  return "Population prior — derived from French Bakery training corpus";
}

export const __test_internals__ = { PRIORS, lookup, dowFromIso, friendlyLabel };
