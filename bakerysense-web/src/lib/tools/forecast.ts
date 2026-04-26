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
  type StageInfo,
} from "@/lib/forecast-router";

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
    const quantiles: Record<string, number> = {};
    for (const q of ctx.quantiles) {
      const raw = models.quantiles[q.toFixed(1)];
      if (!raw) continue;
      const m = loadTrees(raw);
      quantiles[`q${q.toFixed(1)}`] = predict(m, row);
    }
    if (Object.keys(quantiles).length === 0) return { error: "no_quantile_models_loaded" };

    // Honest band widening even on the GBM path while warm — bands tighten
    // again automatically once the tenant is mature.
    const finalQ = widenQuantiles(quantiles, stageInfo.band_multiplier);

    const { quantity, quantile } = orderQuantity(finalQ, ctx.costRatio.cu, ctx.costRatio.co);
    return assembleResponse(sku, on_date, branch_id, finalQ, quantity, quantile, ctx.costRatio, stageInfo, "lightgbm_quantile_js");
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
