/**
 * Cold-start forecast router.
 *
 * Routes a forecast request to the right strategy based on how much data
 * the tenant has accumulated. The contract — input → 7-quantile output —
 * is identical across stages, so callers (the forecast tool, the SKU
 * detail page, the chat agent) never branch on tenant maturity. The
 * router puts a `stage` field on every response so the UI can widen
 * confidence bands and show an honest "still warming up" badge.
 *
 * Stages (V1.5 era — V2 will add `cold_fm_zeroshot` and `warm_fm_lora`):
 *
 *   no_data    < 1 day of actuals    → population prior only
 *   cold       < 30 days             → population prior, with seasonal lift
 *   warm       30–90 days            → V1 GBM (current LightGBM forecaster)
 *   mature     90+ days              → V1 GBM (same model, narrower bands
 *                                       because rolling WAPE is now reliable)
 *
 * In V2 the warm/mature stages route to TimesFM + GBM residual instead.
 * The router signature stays unchanged.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals } from "@/db/schema";
import { priorForecast, type PriorQuantiles } from "./corpus-prior";

export type ForecastStage = "no_data" | "cold" | "warm" | "mature";

export interface StageInfo {
  stage: ForecastStage;
  actuals_count: number;
  /** Honest band-widening multiplier. 1.0 = trust the model, >1 = inflate
   *  the q90-q10 spread to reflect prior-driven uncertainty. */
  band_multiplier: number;
  /** UI banner copy. */
  banner: string;
}

const STAGE_THRESHOLDS = {
  no_data: 0,
  cold: 30,
  warm: 90,
} as const;

export function classifyStage(actualsCount: number): ForecastStage {
  if (actualsCount <= STAGE_THRESHOLDS.no_data) return "no_data";
  if (actualsCount < STAGE_THRESHOLDS.cold) return "cold";
  if (actualsCount < STAGE_THRESHOLDS.warm) return "warm";
  return "mature";
}

export function bandMultiplier(stage: ForecastStage): number {
  switch (stage) {
    case "no_data": return 1.6;
    case "cold":    return 1.3;
    case "warm":    return 1.1;
    case "mature":  return 1.0;
  }
}

export function bannerFor(stage: ForecastStage): string {
  switch (stage) {
    case "no_data": return "Reference forecast — no actuals yet. Population prior only; bands are wide on purpose.";
    case "cold":    return "Warming up — fewer than 30 days of actuals. Forecast leans on the population prior.";
    case "warm":    return "Tenant model active — 30+ days of actuals. Bands tighten as more close-outs come in.";
    case "mature":  return "Production-grade forecast — model is reliably calibrated for this bakery.";
  }
}

/** Count actuals across a tenant. Cheap aggregate query. */
export async function tenantActualsCount(env: CloudflareEnv, tenantId: string): Promise<number> {
  const row = await getDb(env)
    .select({ n: sql<number>`count(${dailyActuals.id})` })
    .from(dailyActuals)
    .where(eq(dailyActuals.tenantId, tenantId))
    .get();
  return row?.n ?? 0;
}

/** Count actuals scoped to a single (branch, family) — used by the
 *  per-SKU router decision so a brand-new SKU gets cold-start treatment
 *  even when the rest of the tenant is mature. */
export async function skuActualsCount(
  env: CloudflareEnv,
  tenantId: string,
  branchId: string,
  family: string,
): Promise<number> {
  const row = await getDb(env)
    .select({ n: sql<number>`count(${dailyActuals.id})` })
    .from(dailyActuals)
    .where(and(
      eq(dailyActuals.tenantId, tenantId),
      eq(dailyActuals.branchId, branchId),
      eq(dailyActuals.family, family),
    ))
    .get();
  return row?.n ?? 0;
}

export async function resolveStage(
  env: CloudflareEnv,
  tenantId: string,
  branchId: string,
  family: string,
): Promise<StageInfo> {
  // Use the per-SKU count when it's the cold one — a new SKU on a mature
  // tenant should still be treated as cold for that SKU. Falls back to
  // tenant-wide count to avoid penalising a slow-moving SKU on a mature
  // tenant.
  const [skuN, tenantN] = await Promise.all([
    skuActualsCount(env, tenantId, branchId, family),
    tenantActualsCount(env, tenantId),
  ]);
  const effectiveN = skuN < STAGE_THRESHOLDS.cold ? skuN : Math.max(skuN, tenantN);
  const stage = classifyStage(effectiveN);
  return {
    stage,
    actuals_count: effectiveN,
    band_multiplier: bandMultiplier(stage),
    banner: bannerFor(stage),
  };
}

/**
 * Widen quantile bands around the median by `multiplier`. q50 stays put;
 * lower quantiles shift further down, upper quantiles further up. Used by
 * the router to honestly represent additional uncertainty during cold
 * stages without changing the underlying point estimate.
 */
export function widenQuantiles(
  q: Record<string, number>,
  multiplier: number,
): Record<string, number> {
  const median = q["q0.5"];
  if (median === undefined) return q;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === "q0.5") { out[k] = v; continue; }
    const widened = median + (v - median) * multiplier;
    out[k] = Math.max(0, widened);
  }
  return out;
}

/**
 * Convert a population-prior forecast into the 7-quantile shape the rest
 * of the system expects (so the cold-start path returns the same envelope
 * as the GBM path). Quantiles 0.2/0.4/0.6/0.8 are linearly interpolated
 * between the prior's anchored 0.1/0.3/0.5/0.7/0.9.
 */
export function priorToQuantileMap(p: PriorQuantiles): Record<string, number> {
  const interp = (a: number, b: number, t: number) => a + (b - a) * t;
  return {
    "q0.1": p.q10,
    "q0.2": interp(p.q10, p.q30, 0.5),
    "q0.3": p.q30,
    "q0.4": interp(p.q30, p.q50, 0.5),
    "q0.5": p.q50,
    "q0.6": interp(p.q50, p.q70, 0.5),
    "q0.7": p.q70,
    "q0.8": interp(p.q70, p.q90, 0.5),
    "q0.9": p.q90,
  };
}

/**
 * Cold-start strategy: returns a 7-quantile forecast purely from the
 * population prior, widened to reflect the lack of tenant data. Used when
 * the V1 GBM cannot fire (no feature row, no actuals).
 */
export function coldStartForecast(family: string, onDate: string, stageInfo: StageInfo) {
  const prior = priorForecast(family, onDate);
  const baseQ = priorToQuantileMap(prior.quantiles);
  const widenedQ = widenQuantiles(baseQ, stageInfo.band_multiplier);
  return {
    quantiles: widenedQ,
    forecaster: "population_prior_v1" as const,
    matched_family: prior.matched_family,
    is_default_family: prior.is_default_family,
  };
}

/**
 * Maturity-weighted ensemble blend of the population prior with the GBM
 * forecast. Empirically (per scripts/benchmark_v1_5.py + benchmark_vs_baselines.py)
 * the prior is a more stable point estimator than the GBM at the median
 * because it ignores recent-shock noise. Blending the two by tenant
 * maturity captures the prior's stability AND the GBM's tail calibration.
 *
 * Maturity factor:
 *   maturity = clip(actuals_count / 90, 0, 1)
 *
 * The cold-start path (maturity=0) is pure prior. As actuals accumulate,
 * GBM signal phases in at the rate the per-quantile schedule allows.
 */
export function alphaForBlending(actualsCount: number): number {
  const a = actualsCount / 90;
  if (a <= 0) return 0;
  if (a >= 1) return 1;
  return a;
}

/**
 * Per-quantile target alpha at full maturity (Tier 4 of the V1.5 head-to-head
 * benchmark). The empirical finding:
 *
 *   • Prior wins at q0.5 (WAPE 0.212 vs GBM 0.245) — the (family, dow) median
 *     is a stable seasonal anchor that ignores recent-shock noise.
 *   • GBM wins at q0.9 (pinball 1.15 vs prior 2.38) — the GBM adapts to
 *     recent shocks and is the only one calibrated for the newsvendor tail.
 *
 * So at maturity the median stays with the prior (target_alpha = 0) and the
 * tails switch to GBM (target_alpha = 1), with a smooth ramp through q0.3
 * and q0.7. The effective alpha is `maturity * target_alpha[q]`, so cold
 * tenants still see pure prior across the whole envelope.
 */
const QUANTILE_TARGET_ALPHA: Record<string, number> = {
  "q0.1": 1.0,
  "q0.2": 1.0,
  "q0.3": 0.5,
  "q0.4": 0.0,
  "q0.5": 0.0,
  "q0.6": 0.0,
  "q0.7": 0.5,
  "q0.8": 1.0,
  "q0.9": 1.0,
};

export function alphaForQuantile(actualsCount: number, quantile: string): number {
  const maturity = alphaForBlending(actualsCount);
  const target = QUANTILE_TARGET_ALPHA[quantile] ?? 1.0;
  return maturity * target;
}

/**
 * Blend prior and GBM quantile envelopes. `alpha` is either a flat number
 * (kept for backward compat) or a per-quantile function returning the
 * blend weight for each quantile name. `1 - alpha` weighs the prior,
 * `alpha` weighs the GBM, identically per quantile.
 */
export function blendQuantiles(
  priorQ: Record<string, number>,
  gbmQ: Record<string, number>,
  alpha: number | ((quantile: string) => number),
): Record<string, number> {
  const alphaFn = typeof alpha === "function"
    ? (q: string) => Math.max(0, Math.min(1, alpha(q)))
    : (() => {
        const a = Math.max(0, Math.min(1, alpha));
        return () => a;
      })();
  const out: Record<string, number> = {};
  // Take the union of quantile keys; if either side lacks a quantile,
  // fall back to whatever's available rather than dropping the key.
  const keys = new Set([...Object.keys(priorQ), ...Object.keys(gbmQ)]);
  for (const k of keys) {
    const p = priorQ[k];
    const g = gbmQ[k];
    if (p == null && g == null) continue;
    if (p == null) { out[k] = g; continue; }
    if (g == null) { out[k] = p; continue; }
    const a = alphaFn(k);
    out[k] = (1 - a) * p + a * g;
  }
  return out;
}
