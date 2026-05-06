import { getDb } from "@/db/client";
import { forecastSnapshots } from "@/db/schema";
import { readActive } from "./model-pointer";
import { getOrCreateActiveModelVersion, type ModelKind } from "./lineage";

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return "fcs_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export async function writeForecastSnapshot(
  env: CloudflareEnv,
  row: {
    tenantId: string; branchId: string; family: string; date: string;
    modelVersion: number; bakeQuantity: number; quantiles: Record<string, number>;
    // Optional decision-lineage hint. When omitted (the common case), the
    // writer resolves the active model version from KV pointer state via
    // getOrCreateActiveModelVersion. Pass an explicit modelKind/id when the
    // caller already has the lineage row (e.g. retrain consumer just minted it).
    modelKind?: ModelKind;
    modelVersionId?: string;
  },
): Promise<void> {
  const id = newId();

  // Resolve the durable model_versions row id. If we already received one
  // from the caller, use it directly; otherwise look it up (and bootstrap
  // if needed) from the KV pointer. Failures here are non-fatal — the
  // snapshot still writes, just without lineage metadata, which matches
  // pre-lineage behaviour for cold tenants.
  let modelVersionId: string | null = row.modelVersionId ?? null;
  if (!modelVersionId) {
    try {
      const mv = await getOrCreateActiveModelVersion(env, row.tenantId, row.modelKind ?? "gbm_v1");
      if (mv) modelVersionId = mv.id;
    } catch {
      // Swallow lineage-bootstrap errors so the forecast write itself is
      // never blocked. Future debuggers can spot pre-lineage rows by
      // looking for NULL model_version_id with non-NULL bake_quantity.
    }
  }

  await getDb(env).insert(forecastSnapshots).values({
    id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    family: row.family,
    date: row.date,
    modelVersion: row.modelVersion,
    modelVersionId,
    bakeQuantity: row.bakeQuantity,
    quantilesJson: JSON.stringify(row.quantiles),
    servedAt: Date.now(),
  }).onConflictDoUpdate({
    target: [forecastSnapshots.tenantId, forecastSnapshots.branchId, forecastSnapshots.family, forecastSnapshots.date, forecastSnapshots.modelVersion],
    set: {
      bakeQuantity: row.bakeQuantity,
      quantilesJson: JSON.stringify(row.quantiles),
      servedAt: Date.now(),
      modelVersionId: modelVersionId ?? undefined,
    },
  });
}

export async function activeModelVersion(env: CloudflareEnv, tenantId: string): Promise<number> {
  const a = await readActive(env, tenantId);
  return a?.version ?? 0;
}
