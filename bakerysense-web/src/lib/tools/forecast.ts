import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures, getFeatureRow, loadTenantModels } from "@/lib/features";
import { loadTrees, predict } from "@/lib/gbm-walker";
import { orderQuantity, targetServiceLevel } from "@/lib/newsvendor";
import { assertBranchAccess } from "@/lib/rbac";

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
    const store = await loadFeatures(ctx.env, ctx.tenantId);
    const row = getFeatureRow(store, branch_id, sku, on_date);
    if (!row) return { error: `unknown_row: ${branch_id}/${sku}/${on_date}` };

    const models = await loadTenantModels(ctx.env, ctx.tenantId);
    const quantiles: Record<number, number> = {};
    for (const q of ctx.quantiles) {
      const raw = models.quantiles[q.toFixed(1)];
      if (!raw) continue;
      const m = loadTrees(raw);
      quantiles[q] = predict(m, row);
    }
    if (Object.keys(quantiles).length === 0) return { error: "no_quantile_models_loaded" };

    const { quantity, quantile } = orderQuantity(quantiles, ctx.costRatio.cu, ctx.costRatio.co);
    return {
      sku, on_date, branch_id,
      quantiles: Object.fromEntries(
        Object.entries(quantiles).map(([k, v]) => [`q${k}`, Math.round(v * 10) / 10]),
      ),
      bake_quantity: quantity,
      selected_quantile: quantile,
      target_quantile: targetServiceLevel(ctx.costRatio.cu, ctx.costRatio.co),
      forecaster: "lightgbm_quantile_js",
    };
  },
};
