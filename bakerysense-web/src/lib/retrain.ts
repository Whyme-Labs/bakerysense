import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { dailyActuals, forecastSnapshots } from "@/db/schema";
import { writeRetrainState } from "@/lib/model-pointer";
import { writeAudit } from "@/lib/audit";

export interface RetrainJob {
  type: "retrain";
  tenantId: string;
  triggeredBy: "cron" | "manual";
  triggeredAt: number;
}

export async function enqueueRetrain(env: CloudflareEnv, tenantId: string, triggeredBy: "cron" | "manual", actorUserId?: string): Promise<void> {
  const job: RetrainJob = { type: "retrain", tenantId, triggeredBy, triggeredAt: Date.now() };
  await env.RETRAIN_QUEUE.send(job);
  await writeRetrainState(env, tenantId, { status: "queued", startedAt: Date.now() });
  await writeAudit(env, {
    tenantId,
    actorUserId,
    action: "retrain.enqueued",
    metadata: { triggeredBy },
  });
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
export async function handleRetrainMessage(env: CloudflareEnv, job: RetrainJob): Promise<{ r2Key: string; rowCount: number }> {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const csv = await buildTrainingCsv(env, job.tenantId, since);
  const r2Key = await uploadTrainingInputs(env, job.tenantId, csv);
  const rowCount = csv.split("\n").length - 1;   // minus header
  await writeRetrainState(env, job.tenantId, {
    status: "awaiting_publish",
    startedAt: job.triggeredAt,
    reason: r2Key,
  });
  return { r2Key, rowCount };
}
