import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures, getFeatureRow, loadTenantModels } from "@/lib/features";
import { loadTrees, shapContribs } from "@/lib/gbm-walker";
import { assertBranchAccess } from "@/lib/rbac";

const ArgsSchema = z.object({
  sku: z.string().min(1),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branch_id: z.string().min(1),
  top_k: z.number().int().min(1).max(10).optional(),
});

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "explain_drivers",
      description:
        "Return the top feature contributions (approximate SHAP) behind a SKU-day forecast. Use after forecast() when the merchant asks 'why' or 'what drove the forecast'.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          sku: { type: "string" },
          on_date: { type: "string" },
          branch_id: { type: "string" },
          top_k: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["sku", "on_date", "branch_id"],
      },
    },
  },
  args: ArgsSchema,
  async handler({ sku, on_date, branch_id, top_k = 4 }, ctx) {
    assertBranchAccess(
      { sub: ctx.userId, tid: ctx.tenantId, role: "staff", branches: ctx.permittedBranches, kid: "" },
      branch_id,
    );
    const store = await loadFeatures(ctx.env, ctx.tenantId);
    const row = getFeatureRow(store, branch_id, sku, on_date);
    if (!row) return { error: `unknown_row: ${branch_id}/${sku}/${on_date}` };

    const models = await loadTenantModels(ctx.env, ctx.tenantId);
    // Use the median quantile for explanation
    const raw = models.quantiles["0.5"];
    if (!raw) return { error: "no_median_quantile_model" };
    const m = loadTrees(raw);
    const contribs = shapContribs(m, row);
    const ranked = Object.entries(contribs)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, top_k)
      .map(([name, val]) => ({ feature: name, contribution: Math.round(val * 1000) / 1000 }));
    return { sku, on_date, branch_id, drivers: ranked };
  },
};
