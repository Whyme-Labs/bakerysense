import { z } from "zod";
import type { ToolSchema } from "@/lib/llm/client";
import { writeAudit } from "@/lib/audit";
import { tool as listSkus } from "./list_skus";
import { tool as forecast } from "./forecast";
import { tool as explainDrivers } from "./explain_drivers";
import { tool as wasteRisk } from "./waste_risk";
import { tool as suggestMarkdowns } from "./suggest_markdowns";
import { tool as narratePlanOptions } from "./narrate_plan_options";

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
  narrate_plan_options: narratePlanOptions,
};

export const TOOL_SCHEMAS: ToolSchema[] = Object.values(TOOL_REGISTRY).map((t) => t.schema);

// Bound each tool-call audit blob so a chatty agent can't blow up D1 row size.
// 4 KB is generous for typical args (a few SKU ids) and a result summary.
const AUDIT_PAYLOAD_BYTE_LIMIT = 4096;

function truncateForAudit(value: unknown): unknown {
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    return { truncated: true, reason: "non-serializable" };
  }
  if (s.length <= AUDIT_PAYLOAD_BYTE_LIMIT) return value;
  return { truncated: true, preview: s.slice(0, AUDIT_PAYLOAD_BYTE_LIMIT) };
}

export async function dispatch(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) {
    await writeAudit(ctx.env, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "tool.failed",
      target: name,
      metadata: { reason: "unknown_tool", args: truncateForAudit(rawArgs) },
    });
    return { error: `unknown_tool: ${name}` };
  }
  const parsed = tool.args.safeParse(rawArgs);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.join(".");
    const errMsg = `invalid_args: ${path || "(root)"} — ${first.message}`;
    await writeAudit(ctx.env, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "tool.failed",
      target: name,
      metadata: { reason: errMsg, args: truncateForAudit(rawArgs) },
    });
    return { error: errMsg };
  }
  const startedAt = Date.now();
  try {
    const out = await tool.handler(parsed.data, ctx);
    await writeAudit(ctx.env, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "tool.invoked",
      target: name,
      metadata: {
        args: truncateForAudit(parsed.data),
        result: truncateForAudit(out),
        latencyMs: Date.now() - startedAt,
      },
    });
    return out as Record<string, unknown>;
  } catch (e) {
    const reason = (e as Error).message;
    await writeAudit(ctx.env, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: "tool.failed",
      target: name,
      metadata: {
        reason,
        args: truncateForAudit(parsed.data),
        latencyMs: Date.now() - startedAt,
      },
    });
    return { error: `tool_execution: ${reason}` };
  }
}
