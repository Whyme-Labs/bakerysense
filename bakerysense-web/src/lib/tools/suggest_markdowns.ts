import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures, getFeatureRow, loadTenantModels } from "@/lib/features";
import { loadTrees, predict } from "@/lib/gbm-walker";
import { assertBranchAccess } from "@/lib/rbac";

const ArgsSchema = z.object({
  branch_id: z.string().min(1),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inventory: z.record(z.string(), z.number().int().min(0)),
});

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "suggest_markdowns",
      description:
        "Given end-of-day remaining inventory for a branch, return markdown percentages per SKU. Use when merchant asks what to discount at close.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          branch_id: { type: "string" },
          as_of: { type: "string", description: "ISO date" },
          inventory: {
            type: "object",
            description: "SKU -> remaining unit count",
            additionalProperties: { type: "integer" },
          },
        },
        required: ["branch_id", "as_of", "inventory"],
      },
    },
  },
  args: ArgsSchema,
  async handler({ branch_id, as_of, inventory }, ctx) {
    assertBranchAccess(
      { sub: ctx.userId, tid: ctx.tenantId, role: "staff", branches: ctx.permittedBranches, kid: "" },
      branch_id,
    );
    const store = await loadFeatures(ctx.env, ctx.tenantId);
    const models = await loadTenantModels(ctx.env, ctx.tenantId);
    const raw70 = models.quantiles["0.7"];
    const raw50 = models.quantiles["0.5"];
    if (!raw70 || !raw50) return { error: "no_quantile_models_loaded" };
    const m70 = loadTrees(raw70), m50 = loadTrees(raw50);

    const markdowns: Array<{ sku: string; remaining: number; discount_pct: number; reason: string }> = [];
    for (const [sku, remaining] of Object.entries(inventory)) {
      const row = getFeatureRow(store, branch_id, sku, as_of);
      if (!row) continue;
      const q70 = predict(m70, row);
      const q50 = predict(m50, row);
      if (remaining > q70 * 1.2) {
        markdowns.push({ sku, remaining, discount_pct: 30, reason: "inventory > q0.7 forecast + 20%" });
      } else if (remaining > q50 * 1.1) {
        markdowns.push({ sku, remaining, discount_pct: 15, reason: "inventory > q0.5 forecast + 10%" });
      }
    }
    return { branch_id, as_of, markdowns };
  },
};
