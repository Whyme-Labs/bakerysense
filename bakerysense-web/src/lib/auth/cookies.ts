import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";

function signingKey(env: CloudflareEnv): Uint8Array {
	if (!env.SESSION_SIGNING_KEY) throw new Error("SESSION_SIGNING_KEY missing");
	return new TextEncoder().encode(env.SESSION_SIGNING_KEY);
}

function sign(env: CloudflareEnv, value: string): string {
	const mac = hmac(sha256, signingKey(env), new TextEncoder().encode(value));
	return base64url.encode(mac).slice(0, 43);
}

export async function setAuthCookie(
	env: CloudflareEnv,
	headers: Headers,
	name: string,
	value: string,
	opts: { maxAgeSeconds?: number; path?: string } = {},
): Promise<void> {
	const encoded = base64url.encode(new TextEncoder().encode(value));
	const signed = `${encoded}.${sign(env, encoded)}`;
	const maxAge = opts.maxAgeSeconds ?? 60 * 15;
	const path = opts.path ?? "/";
	const parts = [
		`${name}=${signed}`,
		`Path=${path}`,
		`Max-Age=${maxAge}`,
		"HttpOnly",
		"Secure",
		"SameSite=Strict",
	];
	headers.append("set-cookie", parts.join("; "));
}

export async function readAuthCookie(
	env: CloudflareEnv,
	cookieHeader: string | null,
	name: string,
): Promise<string | null> {
	if (!cookieHeader) return null;
	const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
	if (!m) return null;
	const [encoded, sig] = m[1].split(".");
	if (!encoded || !sig) return null;
	if (sign(env, encoded) !== sig) return null;
	return new TextDecoder().decode(base64url.decode(encoded));
}

export function clearAuthCookie(headers: Headers, name: string, path = "/"): void {
	headers.append("set-cookie", `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function setReadableCookie(headers: Headers, name: string, value: string, maxAgeSeconds = 60 * 60): void {
	headers.append("set-cookie", `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=Strict`);
}
