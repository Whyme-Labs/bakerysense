import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64url } from "@scure/base";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REVOKED_TTL_SECONDS = 60 * 60;   // 1 hour — long enough to catch reuse within session window

export interface RefreshRecord {
	userId: string;
	tenantId: string;
	issuedAt: number;
	expiresAt: number;
	ua?: string;
	ip?: string;
}

function randomToken(): string {
	return base64url.encode(randomBytes(32));
}

function hashToken(token: string): string {
	return base64url.encode(sha256(new TextEncoder().encode(token)));
}

export async function issueRefresh(
	env: CloudflareEnv,
	rec: { userId: string; tenantId: string; ua?: string; ip?: string },
): Promise<{ token: string; expiresAt: number }> {
	const token = randomToken();
	const hashed = hashToken(token);
	const now = Math.floor(Date.now() / 1000);
	const expiresAt = now + TTL_SECONDS;
	const record: RefreshRecord = { ...rec, issuedAt: now, expiresAt };
	await env.KV.put(`rt:${hashed}`, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
	await env.KV.put(`rt:user:${rec.userId}:${hashed}`, "", { expirationTtl: TTL_SECONDS });
	return { token, expiresAt };
}

export async function rotateRefresh(
	env: CloudflareEnv,
	presented: string,
): Promise<{ token: string; expiresAt: number; oldRevoked: true }> {
	const hashed = hashToken(presented);
	const raw = await env.KV.get(`rt:${hashed}`);

	if (!raw) {
		// Check if this was a recently-revoked token (reuse detection)
		const revokedRaw = await env.KV.get(`rt:revoked:${hashed}`);
		if (revokedRaw) {
			const { userId } = JSON.parse(revokedRaw) as { userId: string };
			// Reuse detected — nuke all active sessions for this user
			await revokeAllForUser(env, userId);
			throw new Error("refresh token reuse detected");
		}
		throw new Error("refresh token unknown");
	}

	const record = JSON.parse(raw) as RefreshRecord;

	// Write the revocation tombstone BEFORE deleting the primary record
	// so that any concurrent reuse attempt can be detected
	await env.KV.put(
		`rt:revoked:${hashed}`,
		JSON.stringify({ userId: record.userId }),
		{ expirationTtl: REVOKED_TTL_SECONDS },
	);

	// Revoke old token
	await env.KV.delete(`rt:${hashed}`);
	await env.KV.delete(`rt:user:${record.userId}:${hashed}`);

	// Issue new token
	const fresh = await issueRefresh(env, {
		userId: record.userId,
		tenantId: record.tenantId,
		ua: record.ua,
		ip: record.ip,
	});
	return { token: fresh.token, expiresAt: fresh.expiresAt, oldRevoked: true };
}

export async function revokeAllForUser(env: CloudflareEnv, userId: string): Promise<number> {
	const list = await env.KV.list({ prefix: `rt:user:${userId}:` });
	let n = 0;
	for (const { name } of list.keys) {
		const hashed = name.split(":").pop()!;
		await env.KV.delete(`rt:${hashed}`);
		await env.KV.delete(name);
		n++;
	}
	return n;
}

export async function readRefresh(env: CloudflareEnv, presented: string): Promise<RefreshRecord | null> {
	const raw = await env.KV.get(`rt:${hashToken(presented)}`);
	return raw ? (JSON.parse(raw) as RefreshRecord) : null;
}
