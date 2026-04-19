import { z } from "zod";
import type { ToolSchema } from "@/lib/llm/client";
import { tool as listSkus } from "./list_skus";
import { tool as forecast } from "./forecast";
import { tool as explainDrivers } from "./explain_drivers";
import { tool as wasteRisk } from "./waste_risk";
import { tool as suggestMarkdowns } from "./suggest_markdowns";

export interface ToolContext {
  env: CloudflareEnv;
  tenantId: string;
  userId: string;
  permittedBranches: string[] | null;
  defaultBranchId: string | null;
  costRatio: { cu: number; co: number };
  quantiles: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance: default Args must accept any tool's specific Zod-inferred type
export interface ToolImpl<Args = any, Result = unknown> {
  schema: ToolSchema;
  args: z.ZodType<Args>;
  handler: (args: Args, ctx: ToolContext) => Promise<Result>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance: registry holds heterogeneous ToolImpl<...> entries
export const TOOL_REGISTRY: Record<string, ToolImpl<any, unknown>> = {
  list_skus: listSkus,
  forecast,
  explain_drivers: explainDrivers,
  waste_risk: wasteRisk,
  suggest_markdowns: suggestMarkdowns,
};

export const TOOL_SCHEMAS: ToolSchema[] = Object.values(TOOL_REGISTRY).map((t) => t.schema);

export async function dispatch(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) return { error: `unknown_tool: ${name}` };
  const parsed = tool.args.safeParse(rawArgs);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.join(".");
    return { error: `invalid_args: ${path || "(root)"} — ${first.message}` };
  }
  try {
    const out = await tool.handler(parsed.data, ctx);
    return out as Record<string, unknown>;
  } catch (e) {
    return { error: `tool_execution: ${(e as Error).message}` };
  }
}
