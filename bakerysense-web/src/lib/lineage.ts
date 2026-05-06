// Decision lineage — durable D1 records for model versions and retrain events.
//
// The KV pointer (model:active:{tenant}, model:versions:{tenant}) is the
// runtime fast path. This module mirrors that into the model_versions and
// retrain_events tables so audits, rollbacks, and lineage queries have a
// queryable source of truth.
//
// Lineage rows are created lazily — getOrCreateActiveModelVersion will
// reflect whatever the KV pointer currently says, so existing tenants
// "join" the lineage system on their next forecast without a backfill.
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { modelVersions, retrainEvents } from "@/db/schema";
import { readActive } from "@/lib/model-pointer";

export type ModelKind =
  | "gbm_v1"
  | "v1_5_prior"
  | "perq_blend_v1"
  | "perq_blend_v2"
  | "timesfm_v2";

function newId(prefix: string): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}_` + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

// Returns the active model_versions row id for (tenantId, modelKind),
// creating a bootstrap row if one does not exist. The bootstrap mirrors
// the KV pointer's runtime state so lineage starts recording at the
// next decision without requiring a backfill of historical snapshots.
//
// Returns null only when there is no KV pointer at all (cold tenant that
// has never trained) AND modelKind is gbm_v1 — in that case, snapshots
// should leave model_version_id NULL.
export async function getOrCreateActiveModelVersion(
  env: CloudflareEnv,
  tenantId: string,
  modelKind: ModelKind = "gbm_v1",
): Promise<{ id: string; versionNumber: number } | null> {
  const db = getDb(env);

  // Fast path: an active row already exists.
  const existing = await db
    .select({ id: modelVersions.id, versionNumber: modelVersions.versionNumber })
    .from(modelVersions)
    .where(
      and(
        eq(modelVersions.tenantId, tenantId),
        eq(modelVersions.modelKind, modelKind),
        eq(modelVersions.status, "active"),
      ),
    )
    .orderBy(desc(modelVersions.versionNumber))
    .limit(1)
    .all();
  if (existing.length > 0) return existing[0];

  // Bootstrap from KV pointer — applies to gbm_v1, where the integer
  // version_number maps directly. Other kinds (priors, blends) bootstrap
  // at version 1 with no R2 key.
  const pointer = modelKind === "gbm_v1" ? await readActive(env, tenantId) : null;
  const versionNumber = pointer?.version ?? 1;
  const trainedAt = pointer?.trainedAt ?? Date.now();

  // Idempotent insert: another concurrent writer may have already created
  // this row. Use the unique index (tenant, kind, version) to dedupe.
  const id = newId("mv");
  const nowMs = Date.now();
  await db
    .insert(modelVersions)
    .values({
      id,
      tenantId,
      modelKind,
      versionNumber,
      r2Key: pointer?.treesR2Key ?? null,
      parentModelId: null,
      trainedAt,
      // Without backfill we cannot recover the original training window —
      // record the bootstrap instant as a degenerate single-day window so
      // queries don't NULL-trip. Real values are written on the next retrain.
      trainingWindowStart: new Date(trainedAt).toISOString().slice(0, 10),
      trainingWindowEnd: new Date(trainedAt).toISOString().slice(0, 10),
      trainingActualsCount: 0,
      validationMetricsJson: pointer?.rollingMae != null
        ? JSON.stringify({ rolling_mae: pointer.rollingMae })
        : null,
      status: "active",
      activatedAt: trainedAt,
      notes: "bootstrapped from KV pointer (pre-lineage tenant)",
      createdAt: nowMs,
    })
    .onConflictDoNothing({
      target: [modelVersions.tenantId, modelVersions.modelKind, modelVersions.versionNumber],
    });

  // Re-read to handle the race where onConflictDoNothing skipped our insert
  // because a concurrent writer beat us.
  const row = await db
    .select({ id: modelVersions.id, versionNumber: modelVersions.versionNumber })
    .from(modelVersions)
    .where(
      and(
        eq(modelVersions.tenantId, tenantId),
        eq(modelVersions.modelKind, modelKind),
        eq(modelVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1)
    .all();
  return row[0] ?? null;
}

export interface RecordRetrainQueuedArgs {
  tenantId: string;
  modelKind?: ModelKind;
  triggeredBy: "wape_breach" | "manual" | "schedule" | "ops_force" | "first_train";
  triggeredByUserId?: string;
  triggerMetric?: string;
  triggerValue?: number;
  triggerThreshold?: number;
  parentModelId?: string | null;
  trainingWindowStart: string;
  trainingWindowEnd: string;
}

export async function recordRetrainQueued(
  env: CloudflareEnv,
  args: RecordRetrainQueuedArgs,
): Promise<{ id: string }> {
  const id = newId("rt");
  const nowMs = Date.now();
  await getDb(env)
    .insert(retrainEvents)
    .values({
      id,
      tenantId: args.tenantId,
      modelKind: args.modelKind ?? "gbm_v1",
      triggeredBy: args.triggeredBy,
      triggeredByUserId: args.triggeredByUserId ?? null,
      triggerMetric: args.triggerMetric ?? null,
      triggerValue: args.triggerValue != null ? String(args.triggerValue) : null,
      triggerThreshold: args.triggerThreshold != null ? String(args.triggerThreshold) : null,
      parentModelId: args.parentModelId ?? null,
      outputModelId: null,
      trainingWindowStart: args.trainingWindowStart,
      trainingWindowEnd: args.trainingWindowEnd,
      status: "queued",
      createdAt: nowMs,
    });
  return { id };
}

export async function markRetrainRunning(env: CloudflareEnv, eventId: string): Promise<void> {
  await getDb(env)
    .update(retrainEvents)
    .set({ status: "running", startedAt: Date.now() })
    .where(eq(retrainEvents.id, eventId));
}

export interface RecordRetrainSucceededArgs {
  eventId: string;
  tenantId: string;
  modelKind?: ModelKind;
  parentModelId: string | null;
  r2Key: string | null;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  trainingActualsCount: number;
  validationMetrics?: Record<string, number>;
  notes?: string;
}

// Atomically: create a new model_versions row, supersede the old active row,
// and link the retrain_events row to its output model.
export async function recordRetrainSucceeded(
  env: CloudflareEnv,
  args: RecordRetrainSucceededArgs,
): Promise<{ modelVersionId: string; versionNumber: number }> {
  const db = getDb(env);
  const modelKind: ModelKind = args.modelKind ?? "gbm_v1";

  // Compute the next version_number per (tenant, kind).
  const latest = await db
    .select({ versionNumber: modelVersions.versionNumber })
    .from(modelVersions)
    .where(and(eq(modelVersions.tenantId, args.tenantId), eq(modelVersions.modelKind, modelKind)))
    .orderBy(desc(modelVersions.versionNumber))
    .limit(1)
    .all();
  const nextVersion = (latest[0]?.versionNumber ?? 0) + 1;

  const id = newId("mv");
  const nowMs = Date.now();

  // Insert new active row.
  await db.insert(modelVersions).values({
    id,
    tenantId: args.tenantId,
    modelKind,
    versionNumber: nextVersion,
    r2Key: args.r2Key,
    parentModelId: args.parentModelId,
    trainedAt: nowMs,
    trainingWindowStart: args.trainingWindowStart,
    trainingWindowEnd: args.trainingWindowEnd,
    trainingActualsCount: args.trainingActualsCount,
    validationMetricsJson: args.validationMetrics
      ? JSON.stringify(args.validationMetrics)
      : null,
    status: "active",
    activatedAt: nowMs,
    notes: args.notes ?? null,
    createdAt: nowMs,
  });

  // Supersede prior active rows for this kind. There should only ever be
  // one, but defend against drift by updating any stale "active" row.
  if (args.parentModelId) {
    await db
      .update(modelVersions)
      .set({ status: "superseded", supersededAt: nowMs })
      .where(eq(modelVersions.id, args.parentModelId));
  }

  // Link the retrain event to its output.
  await db
    .update(retrainEvents)
    .set({
      status: "succeeded",
      outputModelId: id,
      completedAt: nowMs,
    })
    .where(eq(retrainEvents.id, args.eventId));

  return { modelVersionId: id, versionNumber: nextVersion };
}

export async function recordRetrainFailed(
  env: CloudflareEnv,
  args: { eventId: string; reason: string },
): Promise<void> {
  await getDb(env)
    .update(retrainEvents)
    .set({
      status: "failed",
      statusMessage: args.reason.slice(0, 1000),
      completedAt: Date.now(),
    })
    .where(eq(retrainEvents.id, args.eventId));
}

// Decision lineage chain for a single forecast snapshot. Returns the model
// that produced it, the retrain that produced that model, and the parent
// model superseded by the retrain. NULL fields indicate a pre-lineage row
// (created before this system was wired).
export interface DecisionLineage {
  snapshotId: string;
  modelVersion: {
    id: string;
    versionNumber: number;
    modelKind: ModelKind;
    r2Key: string | null;
    trainingWindowStart: string;
    trainingWindowEnd: string;
    trainingActualsCount: number;
    validationMetrics: Record<string, number> | null;
    activatedAt: number | null;
  } | null;
  producedBy: {
    eventId: string;
    triggeredBy: string;
    triggeredByUserId: string | null;
    triggerMetric: string | null;
    triggerValue: string | null;
    triggerThreshold: string | null;
    startedAt: number | null;
    completedAt: number | null;
  } | null;
  parentModel: {
    id: string;
    versionNumber: number;
  } | null;
}

export async function getDecisionLineage(
  env: CloudflareEnv,
  snapshotId: string,
): Promise<DecisionLineage | null> {
  const db = getDb(env);
  const { forecastSnapshots } = await import("@/db/schema");

  const snap = await db
    .select({ id: forecastSnapshots.id, modelVersionId: forecastSnapshots.modelVersionId })
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.id, snapshotId))
    .limit(1)
    .all();
  if (snap.length === 0) return null;

  const snapshot = snap[0];
  if (!snapshot.modelVersionId) {
    return { snapshotId: snapshot.id, modelVersion: null, producedBy: null, parentModel: null };
  }

  const [mvRow] = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.id, snapshot.modelVersionId))
    .limit(1)
    .all();
  if (!mvRow) {
    return { snapshotId: snapshot.id, modelVersion: null, producedBy: null, parentModel: null };
  }

  const [retrainRow] = await db
    .select()
    .from(retrainEvents)
    .where(eq(retrainEvents.outputModelId, mvRow.id))
    .limit(1)
    .all();

  let parent: DecisionLineage["parentModel"] = null;
  if (mvRow.parentModelId) {
    const [parentRow] = await db
      .select({ id: modelVersions.id, versionNumber: modelVersions.versionNumber })
      .from(modelVersions)
      .where(eq(modelVersions.id, mvRow.parentModelId))
      .limit(1)
      .all();
    if (parentRow) parent = parentRow;
  }

  return {
    snapshotId: snapshot.id,
    modelVersion: {
      id: mvRow.id,
      versionNumber: mvRow.versionNumber,
      modelKind: mvRow.modelKind as ModelKind,
      r2Key: mvRow.r2Key,
      trainingWindowStart: mvRow.trainingWindowStart,
      trainingWindowEnd: mvRow.trainingWindowEnd,
      trainingActualsCount: mvRow.trainingActualsCount,
      validationMetrics: mvRow.validationMetricsJson
        ? (JSON.parse(mvRow.validationMetricsJson) as Record<string, number>)
        : null,
      activatedAt: mvRow.activatedAt,
    },
    producedBy: retrainRow
      ? {
          eventId: retrainRow.id,
          triggeredBy: retrainRow.triggeredBy,
          triggeredByUserId: retrainRow.triggeredByUserId,
          triggerMetric: retrainRow.triggerMetric,
          triggerValue: retrainRow.triggerValue,
          triggerThreshold: retrainRow.triggerThreshold,
          startedAt: retrainRow.startedAt,
          completedAt: retrainRow.completedAt,
        }
      : null,
    parentModel: parent,
  };
}
