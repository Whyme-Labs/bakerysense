export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; }

export async function rateLimit(
	env: CloudflareEnv,
	type: string,
	key: string,
	max: number,
	windowSeconds: number,
): Promise<RateLimitResult> {
	const k = `rate:${type}:${key}`;
	const raw = await env.KV.get(k);
	const now = Math.floor(Date.now() / 1000);
	const record = raw ? JSON.parse(raw) as { count: number; resetAt: number } : { count: 0, resetAt: now + windowSeconds };
	if (record.resetAt < now) { record.count = 0; record.resetAt = now + windowSeconds; }
	record.count++;
	const allowed = record.count <= max;
	await env.KV.put(k, JSON.stringify(record), { expirationTtl: windowSeconds });
	return { allowed, remaining: Math.max(0, max - record.count), resetAt: record.resetAt };
}
