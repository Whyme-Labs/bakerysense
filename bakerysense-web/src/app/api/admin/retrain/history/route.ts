import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readActive, readVersions, readRetrainState } from "@/lib/model-pointer";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    requireRole(session.claims, ["tenant_admin"]);
    const [active, versions, state] = await Promise.all([
      readActive(env, session.claims.tid),
      readVersions(env, session.claims.tid),
      readRetrainState(env, session.claims.tid),
    ]);
    return Response.json({ active, versions, state });
  } catch (e) { return errorResponse(e); }
}
