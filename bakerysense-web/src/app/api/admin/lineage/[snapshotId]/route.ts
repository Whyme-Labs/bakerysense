// GET /api/admin/lineage/:snapshotId
//
// Returns the full decision-lineage chain for a single forecast snapshot:
// the model_version that produced it, the retrain_event that produced
// that model, and the parent model superseded by the retrain. NULL fields
// indicate a pre-lineage row (created before lineage tracking was wired).
//
// Authorisation: tenant_admin only. Tenant scope is enforced by reading
// the snapshot's tenant_id from D1 and rejecting if it does not match
// the caller's session claim.
import { eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, NotFound, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { forecastSnapshots } from "@/db/schema";
import { getDecisionLineage } from "@/lib/lineage";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ snapshotId: string }> },
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    requireRole(session.claims, ["tenant_admin"]);

    const { snapshotId } = await ctx.params;
    if (!snapshotId) throw new NotFound("snapshot not found");

    // Tenant scope check: pull the snapshot row and verify tenant match
    // before we hand back any lineage detail.
    const [snap] = await getDb(env)
      .select({ tenantId: forecastSnapshots.tenantId })
      .from(forecastSnapshots)
      .where(eq(forecastSnapshots.id, snapshotId))
      .limit(1)
      .all();
    if (!snap) throw new NotFound("snapshot not found");
    if (snap.tenantId !== session.claims.tid) throw new NotFound("snapshot not found");

    const lineage = await getDecisionLineage(env, snapshotId);
    if (!lineage) throw new NotFound("snapshot not found");

    return Response.json(lineage);
  } catch (e) {
    return errorResponse(e);
  }
}
