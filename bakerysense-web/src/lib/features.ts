import { readActive } from "./model-pointer";

export interface FeatureStore {
  last_date: string;
  per_branch_family_date: Record<string, Record<string, number>>;
}

const cache = new Map<string, Promise<FeatureStore>>();

function setAndPurgeOthers<T>(map: Map<string, T>, key: string, value: T, tenantPrefix: string): void {
  for (const k of map.keys()) {
    if (k.startsWith(tenantPrefix + ":") && k !== key) map.delete(k);
  }
  map.set(key, value);
}

export async function loadFeatures(env: CloudflareEnv, tenantId: string): Promise<FeatureStore> {
  const active = await readActive(env, tenantId);
  const cacheKey = `${tenantId}:${active?.version ?? 0}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const featuresKey = active?.featuresR2Key ?? `tenant:${tenantId}/features/latest.json`;
  const p = (async () => {
    const obj = await env.MODELS.get(featuresKey);
    if (!obj) throw new Error(`features not found: ${featuresKey}`);
    const text = await obj.text();
    return JSON.parse(text) as FeatureStore;
  })();
  setAndPurgeOthers(cache, cacheKey, p, tenantId);
  try { return await p; } catch (e) { cache.delete(cacheKey); throw e; }
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

export interface TenantModels {
  quantiles: Record<string, unknown>;  // raw payload keyed by quantile string ("0.1", "0.3", ...)
}

const modelCache = new Map<string, Promise<TenantModels>>();

export async function loadTenantModels(env: CloudflareEnv, tenantId: string): Promise<TenantModels> {
  const active = await readActive(env, tenantId);
  const cacheKey = `${tenantId}:${active?.version ?? 0}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;
  const treesKey = active?.treesR2Key ?? `tenant:${tenantId}/trees/latest.json`;
  const p = (async () => {
    const obj = await env.MODELS.get(treesKey);
    if (!obj) throw new Error(`models not found: ${treesKey}`);
    const text = await obj.text();
    const parsed = JSON.parse(text) as { quantiles?: Record<string, unknown> };
    return { quantiles: parsed.quantiles ?? (parsed as Record<string, unknown>) } as TenantModels;
  })();
  setAndPurgeOthers(modelCache, cacheKey, p, tenantId);
  try { return await p; } catch (e) { modelCache.delete(cacheKey); throw e; }
}

export function __resetModelCacheForTest(): void { modelCache.clear(); }
