import { randomBytes } from "@noble/hashes/utils.js";
import { base64url } from "@scure/base";

const TTL_SECONDS = 60 * 60;

export async function issueCsrf(env: CloudflareEnv, userId: string): Promise<string> {
	const token = base64url.encode(randomBytes(24));
	await env.KV.put(`csrf:${token}`, JSON.stringify({ userId, issuedAt: Date.now() }), {
		expirationTtl: TTL_SECONDS,
	});
	return token;
}

export async function verifyCsrf(env: CloudflareEnv, token: string | null, userId: string): Promise<boolean> {
	if (!token) return false;
	const raw = await env.KV.get(`csrf:${token}`);
	if (!raw) return false;
	const rec = JSON.parse(raw) as { userId: string };
	return rec.userId === userId;
}
