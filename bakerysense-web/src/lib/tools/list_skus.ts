import { z } from "zod";
import type { ToolImpl } from "./index";
import { loadFeatures } from "@/lib/features";

const ArgsSchema = z.object({ branch_id: z.string().min(1) });

export const tool: ToolImpl<z.infer<typeof ArgsSchema>> = {
  schema: {
    type: "function",
    function: {
      name: "list_skus",
      description:
        "Return the list of SKUs the forecaster knows for a branch. Call when uncertain which SKU names are supported for this branch.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: { branch_id: { type: "string" } },
        required: ["branch_id"],
      },
    },
  },
  args: ArgsSchema,
  async handler({ branch_id }, ctx) {
    const store = await loadFeatures(ctx.env, ctx.tenantId);
    const skus = new Set<string>();
    for (const key of Object.keys(store.per_branch_family_date)) {
      const [b, family] = key.split("|");
      if (b === branch_id) skus.add(family);
    }
    return { branch_id, skus: [...skus].sort() };
  },
};
