import { argon2id } from "@noble/hashes/argon2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";

const T_COST = 2;
const M_COST = 19 * 1024; // 19 MiB in KiB
const PARALLELISM = 1;
const HASH_LEN = 32;
const SALT_LEN = 16;

function encode(hash: Uint8Array, salt: Uint8Array): string {
	return `$argon2id$v=19$m=${M_COST},t=${T_COST},p=${PARALLELISM}$${base64.encode(salt)}$${base64.encode(hash)}`;
}

function decode(encoded: string): { hash: Uint8Array; salt: Uint8Array; m: number; t: number; p: number } {
	const parts = encoded.split("$");
	if (parts.length !== 6 || parts[1] !== "argon2id") throw new Error("invalid argon2id encoding");
	const params = Object.fromEntries(parts[3].split(",").map((kv) => kv.split("=")));
	return {
		m: Number(params.m),
		t: Number(params.t),
		p: Number(params.p),
		salt: base64.decode(parts[4]),
		hash: base64.decode(parts[5]),
	};
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LEN);
	const hash = argon2id(password, salt, { t: T_COST, m: M_COST, p: PARALLELISM, dkLen: HASH_LEN });
	return encode(hash, salt);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
	try {
		const { hash, salt, m, t, p } = decode(encoded);
		const recomputed = argon2id(password, salt, { t, m, p, dkLen: hash.length });
		if (recomputed.length !== hash.length) return false;
		let diff = 0;
		for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ recomputed[i];
		return diff === 0;
	} catch {
		return false;
	}
}
