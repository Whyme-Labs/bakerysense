import { getDb } from "@/db/client";
import { forecastSnapshots } from "@/db/schema";
import { readActive } from "./model-pointer";

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return "fcs_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export async function writeForecastSnapshot(
  env: CloudflareEnv,
  row: {
    tenantId: string; branchId: string; family: string; date: string;
    modelVersion: number; bakeQuantity: number; quantiles: Record<string, number>;
  },
): Promise<void> {
  const id = newId();
  await getDb(env).insert(forecastSnapshots).values({
    id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    family: row.family,
    date: row.date,
    modelVersion: row.modelVersion,
    bakeQuantity: row.bakeQuantity,
    quantilesJson: JSON.stringify(row.quantiles),
    servedAt: Date.now(),
  }).onConflictDoUpdate({
    target: [forecastSnapshots.tenantId, forecastSnapshots.branchId, forecastSnapshots.family, forecastSnapshots.date, forecastSnapshots.modelVersion],
    set: { bakeQuantity: row.bakeQuantity, quantilesJson: JSON.stringify(row.quantiles), servedAt: Date.now() },
  });
}

export async function activeModelVersion(env: CloudflareEnv, tenantId: string): Promise<number> {
  const a = await readActive(env, tenantId);
  return a?.version ?? 0;
}
