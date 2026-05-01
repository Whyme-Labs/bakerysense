import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals, forecastSnapshots } from "@/db/schema";
import { writeRetrainState } from "@/lib/model-pointer";
import { writeAudit } from "@/lib/audit";
import {
  getOrCreateActiveModelVersion,
  markRetrainRunning,
  recordRetrainFailed,
  recordRetrainQueued,
  recordRetrainSucceeded,
} from "@/lib/lineage";

export interface RetrainJob {
  type: "retrain";
  tenantId: string;
  triggeredBy: "cron" | "manual";
  triggeredAt: number;
  // Decision-lineage event id created at enqueue time. The consumer flips it
  // running → succeeded/failed and links the output model_versions row.
  // Optional for back-compat with pre-lineage messages still in the queue.
  retrainEventId?: string;
}

export async function enqueueRetrain(env: CloudflareEnv, tenantId: string, triggeredBy: "cron" | "manual", actorUserId?: string): Promise<void> {
  // Resolve the parent model id (the active version this retrain will replace)
  // before queueing so the lineage event has the link from the start.
  const parent = await getOrCreateActiveModelVersion(env, tenantId, "gbm_v1");
  const todayIso = new Date().toISOString().slice(0, 10);
  const sinceIso = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const lineage = await recordRetrainQueued(env, {
    tenantId,
    modelKind: "gbm_v1",
    triggeredBy: triggeredBy === "cron" ? "schedule" : "manual",
    triggeredByUserId: actorUserId,
    parentModelId: parent?.id ?? null,
    trainingWindowStart: sinceIso,
    trainingWindowEnd: todayIso,
  });
  const job: RetrainJob = {
    type: "retrain",
    tenantId,
    triggeredBy,
    triggeredAt: Date.now(),
    retrainEventId: lineage.id,
  };
  // Write state + audit BEFORE enqueueing — otherwise the consumer can fire
  // before this producer's follow-up writes complete, and our "queued"
  // state overwrites the consumer's "awaiting_publish".
  await writeRetrainState(env, tenantId, { status: "queued", startedAt: Date.now() });
  await writeAudit(env, {
    tenantId,
    actorUserId,
    action: "retrain.enqueued",
    metadata: { triggeredBy, retrainEventId: lineage.id, parentModelId: parent?.id ?? null },
  });
  await env.RETRAIN_QUEUE.send(job);
}

export async function buildTrainingCsv(env: CloudflareEnv, tenantId: string, sinceIso: string): Promise<string> {
  const db = getDb(env);
  const [acts, snaps] = await Promise.all([
    db.select().from(dailyActuals).where(and(
      eq(dailyActuals.tenantId, tenantId),
      gte(dailyActuals.date, sinceIso),
    )).all(),
    db.select().from(forecastSnapshots).where(and(
      eq(forecastSnapshots.tenantId, tenantId),
      gte(forecastSnapshots.date, sinceIso),
    )).all(),
  ]);
  const snapByKey = new Map<string, typeof snaps[number]>();
  for (const s of snaps) snapByKey.set(`${s.branchId}|${s.family}|${s.date}`, s);
  const header = ["branch_id", "family", "date", "actual_sales", "actual_bake", "waste_units", "predicted", "q50"];
  const lines = [header.join(",")];
  for (const a of acts) {
    const k = `${a.branchId}|${a.family}|${a.date}`;
    const s = snapByKey.get(k);
    const q = s ? JSON.parse(s.quantilesJson) as Record<string, number> : {};
    lines.push([
      a.branchId, a.family, a.date,
      a.actualSales ?? "", a.actualBake ?? "", a.wasteUnits ?? "",
      s?.bakeQuantity ?? "", q["q0.5"] ?? "",
    ].join(","));
  }
  return lines.join("\n");
}

export async function uploadTrainingInputs(env: CloudflareEnv, tenantId: string, csv: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const key = `tenant:${tenantId}/training-inputs/${ts}.csv`;
  await env.MODELS.put(key, csv);
  return key;
}

// The consumer handler — called from the Worker's queue() method (or directly in tests).
//
// Lineage flow:
//   queued (producer) → running (here) → succeeded (here) | failed (here)
// On success, a new model_versions row is committed and the retrain_events
// row is linked to it. On failure, status_message records the reason.
export async function handleRetrainMessage(env: CloudflareEnv, job: RetrainJob): Promise<{ r2Key: string; rowCount: number }> {
  if (job.retrainEventId) {
    await markRetrainRunning(env, job.retrainEventId);
  }
  const sinceIso = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const todayIso = new Date(job.triggeredAt).toISOString().slice(0, 10);
  try {
    const csv = await buildTrainingCsv(env, job.tenantId, sinceIso);
    const r2Key = await uploadTrainingInputs(env, job.tenantId, csv);
    const rowCount = csv.split("\n").length - 1;   // minus header
    await writeRetrainState(env, job.tenantId, {
      status: "awaiting_publish",
      startedAt: job.triggeredAt,
      reason: r2Key,
    });
    if (job.retrainEventId) {
      // Determine the parent model so we can record supersession.
      const parent = await getOrCreateActiveModelVersion(env, job.tenantId, "gbm_v1");
      await recordRetrainSucceeded(env, {
        eventId: job.retrainEventId,
        tenantId: job.tenantId,
        modelKind: "gbm_v1",
        parentModelId: parent?.id ?? null,
        // The training pipeline produces an inputs CSV here; the actual model
        // artifact is published by the operator-side training step (Python
        // notebook → R2). r2Key recorded here is the inputs blob, useful for
        // provenance even before the artifact lands.
        r2Key,
        trainingWindowStart: sinceIso,
        trainingWindowEnd: todayIso,
        trainingActualsCount: rowCount,
        notes: "training inputs exported; awaiting operator publish",
      });
    }
    return { r2Key, rowCount };
  } catch (e) {
    if (job.retrainEventId) {
      await recordRetrainFailed(env, {
        eventId: job.retrainEventId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }
}
