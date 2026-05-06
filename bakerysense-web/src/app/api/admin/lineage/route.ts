// GET /api/admin/lineage
//
// Lists recent model_versions and retrain_events for the caller's tenant.
// Powers the "Decision lineage" panel in the Model tab — a timeline of
// model promotions and retrain attempts so the operator can see, at a
// glance, when training happened and what triggered it.
//
// Query params:
//   limit  optional, default 20, max 100 (caps both lists)
//
// Response shape:
//   { modelVersions: [...], retrainEvents: [...] }
//
// Authorisation: tenant_admin only.
import { desc, eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { modelVersions, retrainEvents } from "@/db/schema";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(req: Request): number {
  const raw = new URL(req.url).searchParams.get("limit");
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    requireRole(session.claims, ["tenant_admin"]);

    const tenantId = session.claims.tid;
    const limit = parseLimit(req);
    const db = getDb(env);

    const [versions, events] = await Promise.all([
      db
        .select()
        .from(modelVersions)
        .where(eq(modelVersions.tenantId, tenantId))
        .orderBy(desc(modelVersions.createdAt))
        .limit(limit)
        .all(),
      db
        .select()
        .from(retrainEvents)
        .where(eq(retrainEvents.tenantId, tenantId))
        .orderBy(desc(retrainEvents.createdAt))
        .limit(limit)
        .all(),
    ]);

    return Response.json({
      modelVersions: versions.map((v) => ({
        id: v.id,
        modelKind: v.modelKind,
        versionNumber: v.versionNumber,
        r2Key: v.r2Key,
        parentModelId: v.parentModelId,
        trainedAt: v.trainedAt,
        trainingWindowStart: v.trainingWindowStart,
        trainingWindowEnd: v.trainingWindowEnd,
        trainingActualsCount: v.trainingActualsCount,
        validationMetrics: v.validationMetricsJson
          ? (JSON.parse(v.validationMetricsJson) as Record<string, number>)
          : null,
        status: v.status,
        activatedAt: v.activatedAt,
        supersededAt: v.supersededAt,
        notes: v.notes,
        createdAt: v.createdAt,
      })),
      retrainEvents: events.map((e) => ({
        id: e.id,
        modelKind: e.modelKind,
        triggeredBy: e.triggeredBy,
        triggeredByUserId: e.triggeredByUserId,
        triggerMetric: e.triggerMetric,
        triggerValue: e.triggerValue,
        triggerThreshold: e.triggerThreshold,
        parentModelId: e.parentModelId,
        outputModelId: e.outputModelId,
        trainingWindowStart: e.trainingWindowStart,
        trainingWindowEnd: e.trainingWindowEnd,
        status: e.status,
        statusMessage: e.statusMessage,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        createdAt: e.createdAt,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
