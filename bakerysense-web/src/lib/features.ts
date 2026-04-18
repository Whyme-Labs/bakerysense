export interface FeatureStore {
  last_date: string;
  per_branch_family_date: Record<string, Record<string, number>>;
}

const cache = new Map<string, Promise<FeatureStore>>();

export async function loadFeatures(env: CloudflareEnv, tenantId: string): Promise<FeatureStore> {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const key = `tenant:${tenantId}/features/latest.json`;
  const p = (async () => {
    const obj = await env.MODELS.get(key);
    if (!obj) throw new Error(`features not found: ${key}`);
    const text = await obj.text();
    return JSON.parse(text) as FeatureStore;
  })();
  cache.set(tenantId, p);
  try { return await p; } catch (e) { cache.delete(tenantId); throw e; }
}

export function getFeatureRow(
  store: FeatureStore,
  branchId: string,
  family: string,
  date: string,
): Record<string, number> | null {
  return store.per_branch_family_date[`${branchId}|${family}|${date}`] ?? null;
}

// Reset the in-memory cache (test hook only)
export function __resetFeaturesCacheForTest(): void {
  cache.clear();
}
