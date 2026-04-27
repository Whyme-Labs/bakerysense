import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures, getFeatureRow, loadTenantModels } from "@/lib/features";
import { loadTrees, predict } from "@/lib/gbm-walker";
import { orderQuantity, targetServiceLevel } from "@/lib/newsvendor";
import { assertBranchAccess } from "@/lib/rbac";
import {
  resolveStage,
  widenQuantiles,
  coldStartForecast,
  alphaForBlending,
  alphaForQuantile,
  blendQuantiles,
  priorToQuantileMap,
  type StageInfo,
} from "@/lib/forecast-router";
import { priorForecast } from "@/lib/corpus-prior";
import { isTimesFmConfigured, predictTimesFM, TimesFmUnavailableError } from "@/lib/forecasters/timesfm";
import { loadActualsHistory } from "@/lib/actuals";

/** Tier 6: which quantiles get routed to TimesFM (vs the V1 GBM).
 *  Empirical (scripts/benchmark_timesfm.py): TimesFM-2 has better q0.8/q0.9
 *  calibration than the GBM but worse median, so only the upper tail is
 *  rerouted. The prior owns q0.4/q0.5/q0.6 regardless. */
const TIMESFM_TAIL_QUANTILES = new Set(["q0.8", "q0.9"]);
/** ~17 weeks — enough context for TimesFM-2 weekly seasonality without
 *  blowing the 5s timeout in the worker. */
const TIMESFM_HISTORY_DAYS = 120;

const ArgsSchema = z.object({
  sku: z.string().min(1),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "on_date must be ISO date (YYYY-MM-DD)"),
  branch_id: z.string().min(1),
});

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "forecast",
      description:
        "Return the quantile forecast and newsvendor-picked bake quantity for one SKU-day at a branch. Use when the merchant asks how many units to produce or for the forecast number for a specific item.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          sku: { type: "string", description: "Product family name" },
          on_date: { type: "string", description: "ISO date YYYY-MM-DD" },
          branch_id: { type: "string", description: "Branch identifier" },
        },
        required: ["sku", "on_date", "branch_id"],
      },
    },
  },
  args: ArgsSchema,
  async handler({ sku, on_date, branch_id }, ctx) {
    assertBranchAccess(
      { sub: ctx.userId, tid: ctx.tenantId, role: "staff", branches: ctx.permittedBranches, kid: "" },
      branch_id,
    );

    const stageInfo = await resolveStage(ctx.env, ctx.tenantId, branch_id, sku);

    // No-data and cold stages: bypass the GBM entirely. Even if a feature
    // row happens to exist, prefer the honest population prior because the
    // GBM hasn't been calibrated against this tenant's reality yet.
    if (stageInfo.stage === "no_data" || stageInfo.stage === "cold") {
      const cold = coldStartForecast(sku, on_date, stageInfo);
      const { quantity, quantile } = orderQuantity(cold.quantiles, ctx.costRatio.cu, ctx.costRatio.co);
      return assembleResponse(sku, on_date, branch_id, cold.quantiles, quantity, quantile, ctx.costRatio, stageInfo, cold.forecaster, {
        matched_family: cold.matched_family,
        is_default_family: cold.is_default_family,
      });
    }

    // Warm / mature: use the V1 GBM. If the feature row is missing for
    // some reason (e.g. the feature pipeline hasn't caught up), fall
    // through to the cold-start prior so we never hard-fail a forecast.
    const store = await loadFeatures(ctx.env, ctx.tenantId);
    const row = getFeatureRow(store, branch_id, sku, on_date);
    if (!row) {
      const cold = coldStartForecast(sku, on_date, { ...stageInfo, stage: "cold", band_multiplier: 1.3 });
      const { quantity, quantile } = orderQuantity(cold.quantiles, ctx.costRatio.cu, ctx.costRatio.co);
      return assembleResponse(sku, on_date, branch_id, cold.quantiles, quantity, quantile, ctx.costRatio, { ...stageInfo, stage: "cold", banner: "Feature row unavailable — falling back to population prior." }, cold.forecaster, {
        matched_family: cold.matched_family,
        is_default_family: cold.is_default_family,
      });
    }

    const models = await loadTenantModels(ctx.env, ctx.tenantId);
    const gbmQ: Record<string, number> = {};
    for (const q of ctx.quantiles) {
      const raw = models.quantiles[q.toFixed(1)];
      if (!raw) continue;
      const m = loadTrees(raw);
      gbmQ[`q${q.toFixed(1)}`] = predict(m, row);
    }
    if (Object.keys(gbmQ).length === 0) return { error: "no_quantile_models_loaded" };

    // Per-quantile maturity blend (Tier 4). The benchmark established that
    // the prior wins at the median (lower WAPE) while the GBM owns the
    // q0.9 tail (calibrated for newsvendor). Per-quantile alpha takes the
    // best of both: at maturity the median stays with the prior and the
    // tails switch to GBM. Cold tenants still get pure prior because the
    // maturity factor multiplies every quantile's target alpha.
    const prior = priorForecast(sku, on_date);
    const priorQ = priorToQuantileMap(prior.quantiles);
    const maturity = alphaForBlending(stageInfo.actuals_count);

    // Tier 6: when a TimesFM backend is configured, replace the GBM's
    // q0.8/q0.9 with TimesFM's (5.3% better q0.9 pinball per the head-to-head
    // benchmark). If the call fails for any reason — timeout, 5xx, missing
    // history — fall through to the Tier 4 GBM-only path so newsvendor
    // never blocks on the ML service.
    let tfmApplied = false;
    if (isTimesFmConfigured(ctx.env)) {
      try {
        const history = await loadActualsHistory(ctx.env, ctx.tenantId, branch_id, sku, TIMESFM_HISTORY_DAYS);
        if (history.length >= 28) {
          const tfm = await predictTimesFM(ctx.env, {
            history,
            horizon: 1,
            quantiles: [0.8, 0.9],
          });
          for (const q of TIMESFM_TAIL_QUANTILES) {
            const arr = tfm.quantiles[q];
            if (arr && arr.length > 0 && Number.isFinite(arr[0])) {
              gbmQ[q] = Math.max(0, arr[0]);
            }
          }
          tfmApplied = true;
        }
      } catch (err) {
        if (!(err instanceof TimesFmUnavailableError)) {
          // Don't crash the forecast on an unexpected TimesFM error;
          // log and fall back. The forecaster label below records that
          // we stayed on the GBM tail.
          console.warn("TimesFM tail call failed, falling back to GBM:", err);
        }
      }
    }

    const blended = blendQuantiles(priorQ, gbmQ, (q) => alphaForQuantile(stageInfo.actuals_count, q));

    // Honest band widening even on the blended path while warm — bands
    // tighten automatically once the tenant is mature.
    const finalQ = widenQuantiles(blended, stageInfo.band_multiplier);

    const { quantity, quantile } = orderQuantity(finalQ, ctx.costRatio.cu, ctx.costRatio.co);
    const forecaster = maturity === 0
      ? "population_prior_v1"
      : tfmApplied ? "perq_blend_v2" : "perq_blend_v1";
    return assembleResponse(sku, on_date, branch_id, finalQ, quantity, quantile, ctx.costRatio, stageInfo, forecaster, {
      blend_alpha: Math.round(maturity * 100) / 100,
      timesfm_tail: tfmApplied,
    });
  },
};

function assembleResponse(
  sku: string,
  on_date: string,
  branch_id: string,
  quantiles: Record<string, number>,
  bakeQuantity: number,
  selectedQuantile: number,
  costRatio: { cu: number; co: number },
  stageInfo: StageInfo,
  forecaster: string,
  extras?: Record<string, unknown>,
) {
  return {
    sku, on_date, branch_id,
    quantiles: Object.fromEntries(
      Object.entries(quantiles).map(([k, v]) => [k, Math.round(v * 10) / 10]),
    ),
    bake_quantity: bakeQuantity,
    selected_quantile: selectedQuantile,
    target_quantile: targetServiceLevel(costRatio.cu, costRatio.co),
    forecaster,
    stage: stageInfo.stage,
    actuals_count: stageInfo.actuals_count,
    confidence_banner: stageInfo.banner,
    ...(extras ?? {}),
  };
}
