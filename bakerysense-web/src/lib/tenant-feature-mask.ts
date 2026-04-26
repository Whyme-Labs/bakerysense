/**
 * Per-tenant feature availability loader.
 *
 * Reads `tenants.feature_availability` (JSON array of feature IDs) and falls
 * back to `V1_DEFAULT_AVAILABILITY` when the column is null/empty. Cached in
 * memory keyed by tenant id; cache is per-isolate and short-lived (Workers
 * recycle every few minutes), so stale-after-update is bounded by isolate
 * lifetime, not request count.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import {
  V1_DEFAULT_AVAILABILITY,
  maskFromList,
  type TenantFeatureMask,
} from "@/lib/feature-registry";

const cache = new Map<string, TenantFeatureMask>();

export async function loadTenantFeatureMask(
  env: CloudflareEnv,
  tenantId: string,
): Promise<TenantFeatureMask> {
  const hit = cache.get(tenantId);
  if (hit) return hit;

  const row = await getDb(env)
    .select({ availability: tenants.featureAvailability })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();

  let ids: ReadonlyArray<string> = V1_DEFAULT_AVAILABILITY;
  if (row?.availability) {
    try {
      const parsed = JSON.parse(row.availability) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        ids = parsed;
      }
    } catch {
      // Malformed JSON — fall through to V1 defaults rather than throwing.
    }
  }
  const mask = maskFromList(ids);
  cache.set(tenantId, mask);
  return mask;
}

export function __resetTenantFeatureMaskCacheForTest(): void {
  cache.clear();
}
