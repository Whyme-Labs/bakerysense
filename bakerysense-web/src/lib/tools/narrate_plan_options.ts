// Tool: narrate_plan_options
//
// Returns the three bake-plan options (conservative / balanced / aggressive)
// for one (sku, on_date, branch) along with deterministic baker-language
// narration scaffolds. Numeric values come from generatePlanOptions —
// the simulation engine — never from the LLM. Gemma uses the per-option
// `narration` strings as ground-truth phrasing when answering the operator.
//
// Decision-centric design: numeric work is deterministic; semantic work is
// LLM. This tool is the deterministic seam — it never calls an LLM.
import { z } from "zod";
import type { ToolImpl } from "./index";
import { dispatch } from "./index";
import { generatePlanOptions, type PlanOption } from "@/lib/plan-options";
import type { Quantiles } from "@/lib/simulation";

const ArgsSchema = z.object({
  sku: z.string().min(1),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "on_date must be ISO date (YYYY-MM-DD)"),
  branch_id: z.string().min(1),
});

// Convert string-keyed quantiles ("q0.5" or bare "0.5") to numeric keys.
function parseQuantiles(raw: Record<string, number>): Quantiles {
  const result: Quantiles = {};
  for (const [k, v] of Object.entries(raw)) {
    const stripped = k.startsWith("q") ? k.slice(1) : k;
    const prob = parseFloat(stripped);
    if (Number.isFinite(prob) && prob > 0 && prob < 1) result[prob] = v;
  }
  return result;
}

// Deterministic baker-language scaffold for one option. Two short clauses,
// always grounded in the numeric outcome — never speculative.
function narrate(opt: PlanOption): string {
  const stockoutPct = Math.round(opt.outcome.expectedStockoutProb * 100);
  const waste = Math.round(opt.outcome.expectedWasteUnits);
  const noun =
    opt.kind === "conservative" ? "Conservative"
    : opt.kind === "balanced" ? "Balanced"
    : "Aggressive";
  const stockoutClause =
    stockoutPct >= 50 ? `${stockoutPct}% chance of selling out before close`
    : stockoutPct >= 20 ? `${stockoutPct}% chance you run out`
    : stockoutPct > 0 ? `low (${stockoutPct}%) chance of running out`
    : "very unlikely to sell out";
  const wasteClause =
    waste === 0 ? "no expected waste"
    : waste < 5 ? `~${waste} units expected unsold`
    : `~${waste} units expected unsold (waste)`;
  return `${noun} — bake ${opt.bakeQuantity}. ${wasteClause}, ${stockoutClause}.`;
}

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "narrate_plan_options",
      description:
        "Return three bake-plan options (conservative / balanced / aggressive) for one SKU on one date at a branch, each with expected waste, stockout probability, units sold, and a baker-language sentence summarising the tradeoff. Use when the operator wants to compare alternatives before committing to a bake plan.",
      parameters: {
        type: "object",
        additionalProperties: false,
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
    // Reuse the existing forecast tool to fetch the quantile band — keeps the
    // tier 6 routing, cold-start fallback, and auth checks all in one place.
    const fcRaw = await dispatch("forecast", { sku, on_date, branch_id }, ctx);
    if ("error" in fcRaw) return fcRaw;
    const fc = fcRaw as { quantiles?: Record<string, number>; selected_quantile?: number; bake_quantity?: number; forecaster?: string };
    if (!fc.quantiles) return { error: "no forecast available for this SKU-day" };
    const numericQ = parseQuantiles(fc.quantiles);
    if (Object.keys(numericQ).length < 2) return { error: "forecast quantiles too sparse" };

    const opts = generatePlanOptions(numericQ, ctx.costRatio);

    const annotate = (o: PlanOption) => ({
      kind: o.kind,
      bake_quantity: o.bakeQuantity,
      expected_waste_units: Math.round(o.outcome.expectedWasteUnits * 10) / 10,
      expected_stockout_prob: Math.round(o.outcome.expectedStockoutProb * 1000) / 1000,
      expected_units_sold: Math.round(o.outcome.expectedUnitsSold * 10) / 10,
      narration: narrate(o),
    });

    return {
      sku,
      on_date,
      branch_id,
      forecaster: fc.forecaster ?? null,
      cost_ratio: ctx.costRatio,
      options: {
        conservative: annotate(opts.conservative),
        balanced: annotate(opts.balanced),
        aggressive: annotate(opts.aggressive),
      },
      // Hint that helps the LLM pick a recommended option to surface to the
      // operator — purely deterministic, the LLM is welcome to override with
      // its own judgement when it has additional context.
      recommended: "balanced",
    };
  },
};
