import { generateKeyPair } from "./jwt";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";

type JwksEntry = {
	kid: string;
	alg: "ES256";
	publicJwk: JsonWebKey;
	privateJwkEncrypted: string;   // base64(iv || ciphertext || tag)
	status: "active" | "retired";
	createdAt: number;
	retiredAt?: number;
};

const RETIRE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function getMek(env: CloudflareEnv): Uint8Array {
	const b64 = env.JWKS_ENCRYPTION_KEY;
	if (!b64) throw new Error("JWKS_ENCRYPTION_KEY missing");
	const key = base64.decode(b64);
	if (key.length !== 32) throw new Error("JWKS_ENCRYPTION_KEY must be 32 bytes (base64)");
	return key;
}

function encryptPrivateJwk(env: CloudflareEnv, jwk: JsonWebKey): string {
	const iv = randomBytes(12);
	const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
	const aes = gcm(getMek(env), iv);
	const ct = aes.encrypt(plaintext);
	return base64.encode(new Uint8Array([...iv, ...ct]));
}

function decryptPrivateJwk(env: CloudflareEnv, encoded: string): JsonWebKey {
	const buf = base64.decode(encoded);
	const iv = buf.slice(0, 12);
	const ct = buf.slice(12);
	const aes = gcm(getMek(env), iv);
	const pt = aes.decrypt(ct);
	return JSON.parse(new TextDecoder().decode(pt));
}

function newKid(): string {
	return "k_" + base64.encode(randomBytes(9)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

async function createAndStore(env: CloudflareEnv, status: JwksEntry["status"]): Promise<JwksEntry> {
	const { privateJwk, publicJwk } = await generateKeyPair();
	const entry: JwksEntry = {
		kid: newKid(),
		alg: "ES256",
		publicJwk,
		privateJwkEncrypted: encryptPrivateJwk(env, privateJwk),
		status,
		createdAt: Date.now(),
	};
	await env.KV.put(`jwks:${entry.kid}`, JSON.stringify(entry));
	if (status === "active") {
		await env.KV.put("jwks:active", entry.kid);
	}
	return entry;
}

export async function getActivePrivateJwk(env: CloudflareEnv): Promise<{ kid: string; jwk: JsonWebKey }> {
	const activeKid = await env.KV.get("jwks:active");
	if (activeKid) {
		const raw = await env.KV.get(`jwks:${activeKid}`);
		if (raw) {
			const entry = JSON.parse(raw) as JwksEntry;
			return { kid: entry.kid, jwk: decryptPrivateJwk(env, entry.privateJwkEncrypted) };
		}
	}
	const entry = await createAndStore(env, "active");
	return { kid: entry.kid, jwk: decryptPrivateJwk(env, entry.privateJwkEncrypted) };
}

export async function getPublicJwkByKid(env: CloudflareEnv, kid: string): Promise<JsonWebKey> {
	const raw = await env.KV.get(`jwks:${kid}`);
	if (!raw) throw new Error(`unknown kid: ${kid}`);
	const entry = JSON.parse(raw) as JwksEntry;
	if (entry.status === "retired" && entry.retiredAt && Date.now() - entry.retiredAt > RETIRE_GRACE_MS) {
		throw new Error(`kid retired past grace: ${kid}`);
	}
	return entry.publicJwk;
}

export async function rotateKeys(env: CloudflareEnv): Promise<{ newKid: string; retiredKid: string | null }> {
	const activeKid = await env.KV.get("jwks:active");
	let retiredKid: string | null = null;
	if (activeKid) {
		const raw = await env.KV.get(`jwks:${activeKid}`);
		if (raw) {
			const entry = JSON.parse(raw) as JwksEntry;
			entry.status = "retired";
			entry.retiredAt = Date.now();
			await env.KV.put(`jwks:${entry.kid}`, JSON.stringify(entry));
			retiredKid = entry.kid;
		}
	}
	const fresh = await createAndStore(env, "active");
	return { newKid: fresh.kid, retiredKid };
}

export async function listActiveJwks(env: CloudflareEnv): Promise<{ kid: string; publicJwk: JsonWebKey; status: string }[]> {
	const list = await env.KV.list({ prefix: "jwks:" });
	const out: { kid: string; publicJwk: JsonWebKey; status: string }[] = [];
	for (const { name } of list.keys) {
		if (name === "jwks:active") continue;
		const raw = await env.KV.get(name);
		if (!raw) continue;
		const entry = JSON.parse(raw) as JwksEntry;
		if (entry.status === "retired" && entry.retiredAt && Date.now() - entry.retiredAt > RETIRE_GRACE_MS) continue;
		out.push({ kid: entry.kid, publicJwk: entry.publicJwk, status: entry.status });
	}
	return out;
}
