export interface ActivePointer {
  version: number;
  treesR2Key: string;
  featuresR2Key: string;
  trainedAt: number;
  rollingMae?: number;
}

export interface VersionEntry {
  version: number;
  trainedAt: number;
  metrics?: { rollingMae?: number; rollingWape?: number };
  treesR2Key: string;
  featuresR2Key: string;
}

export interface RetrainState {
  status: "idle" | "queued" | "running" | "awaiting_publish" | "published" | "aborted";
  startedAt?: number;
  finishedAt?: number;
  outcome?: "published" | "aborted";
  reason?: string;
}

export async function readActive(env: CloudflareEnv, tenantId: string): Promise<ActivePointer | null> {
  return (await env.KV.get<ActivePointer>(`model:active:${tenantId}`, "json")) ?? null;
}

export async function writeActive(env: CloudflareEnv, tenantId: string, p: ActivePointer): Promise<void> {
  await env.KV.put(`model:active:${tenantId}`, JSON.stringify(p));
}

export async function readVersions(env: CloudflareEnv, tenantId: string): Promise<VersionEntry[]> {
  return (await env.KV.get<VersionEntry[]>(`model:versions:${tenantId}`, "json")) ?? [];
}

export async function appendVersion(env: CloudflareEnv, tenantId: string, v: VersionEntry): Promise<void> {
  const current = await readVersions(env, tenantId);
  current.unshift(v);
  const trimmed = current.slice(0, 20);
  await env.KV.put(`model:versions:${tenantId}`, JSON.stringify(trimmed));
}

export async function readRetrainState(env: CloudflareEnv, tenantId: string): Promise<RetrainState> {
  return (await env.KV.get<RetrainState>(`retrain:last:${tenantId}`, "json")) ?? { status: "idle" };
}

export async function writeRetrainState(env: CloudflareEnv, tenantId: string, s: RetrainState): Promise<void> {
  await env.KV.put(`retrain:last:${tenantId}`, JSON.stringify(s));
}
