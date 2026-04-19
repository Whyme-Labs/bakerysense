import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { enqueueRetrain } from "@/lib/retrain";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
    requireRole(session.claims, ["tenant_admin"]);
    await enqueueRetrain(env, session.claims.tid, "manual", session.claims.sub);
    return Response.json({ status: "queued" }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}
