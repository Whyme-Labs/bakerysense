import { dispatch, type ToolContext } from "@/lib/tools";
import { resolveSession } from "@/lib/auth/session";
import { Unauthorized } from "@/lib/errors";

export async function buildToolCtx(env: CloudflareEnv, req: Request): Promise<{ session: Awaited<ReturnType<typeof resolveSession>>; ctx: ToolContext }> {
  const session = await resolveSession(env, req);
  if (!session) throw new Unauthorized();
  const ctx: ToolContext = {
    env,
    tenantId: session.claims.tid,
    userId: session.claims.sub,
    permittedBranches: session.claims.branches,
    defaultBranchId: null,
    costRatio: { cu: 2, co: 1 },
    quantiles: [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9],
  };
  return { session, ctx };
}

export async function callTool<T>(name: string, args: unknown, env: CloudflareEnv, req: Request): Promise<T> {
  const { ctx } = await buildToolCtx(env, req);
  const result = await dispatch(name, args, ctx);
  return result as T;
}
