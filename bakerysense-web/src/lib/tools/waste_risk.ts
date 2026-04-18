import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures, getFeatureRow, loadTenantModels } from "@/lib/features";
import { loadTrees, predict } from "@/lib/gbm-walker";
import { orderQuantity } from "@/lib/newsvendor";
import { assertBranchAccess } from "@/lib/rbac";

const ArgsSchema = z.object({
  sku: z.string().min(1),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branch_id: z.string().min(1),
  threshold_pct: z.number().min(0).max(100).optional(),
});

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "waste_risk",
      description:
        "Estimate probability today's production batch leaves more than threshold_pct of units unsold. Call with just sku, on_date, and branch_id — the 10% threshold is the default. Only pass threshold_pct when the merchant explicitly names a different percentage.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          sku: { type: "string" },
          on_date: { type: "string", description: "ISO date" },
          branch_id: { type: "string" },
          threshold_pct: { type: "number", description: "Optional. Defaults to 10." },
        },
        required: ["sku", "on_date", "branch_id"],
      },
    },
  },
  args: ArgsSchema,
  async handler({ sku, on_date, branch_id, threshold_pct = 10 }, ctx) {
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
      quantiles[q] = predict(loadTrees(raw), row);
    }
    if (Object.keys(quantiles).length === 0) return { error: "no_quantile_models_loaded" };
    const { quantity: bake } = orderQuantity(quantiles, ctx.costRatio.cu, ctx.costRatio.co);

    // P(unsold > threshold) ≈ P(demand < bake * (1 - threshold/100))
    const demandCeiling = bake * (1 - threshold_pct / 100);
    // Interpolate through the quantile curve: find the smallest q whose forecast exceeds demandCeiling.
    const sorted = Object.entries(quantiles)
      .map(([q, v]) => [parseFloat(q), v] as const)
      .sort((a, b) => a[0] - b[0]);
    let waste_probability = 0;
    for (const [q, v] of sorted) {
      if (v >= demandCeiling) { waste_probability = q; break; }
      waste_probability = q;   // fall through to highest if nothing exceeds
    }

    return {
      sku, on_date, branch_id,
      bake_quantity: bake,
      threshold_pct,
      waste_probability: Math.round(waste_probability * 1000) / 1000,
    };
  },
};
