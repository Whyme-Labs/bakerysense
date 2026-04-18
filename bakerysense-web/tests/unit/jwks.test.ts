import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getActivePrivateJwk, getPublicJwkByKid, rotateKeys, listActiveJwks } from "@/lib/auth/jwks";

describe("JWKS", () => {
	beforeEach(async () => {
		// wipe KV between tests
		const list = await env.KV.list({ prefix: "jwks:" });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("generates an initial key pair on first read", async () => {
		const { kid, jwk } = await getActivePrivateJwk(env);
		expect(kid).toBeTruthy();
		expect(jwk.crv).toBe("P-256");
		const pub = await getPublicJwkByKid(env, kid);
		expect(pub.kty).toBe("EC");
	});

	it("rotation keeps retired keys verifiable for a grace window", async () => {
		const a = await getActivePrivateJwk(env);
		const { newKid, retiredKid } = await rotateKeys(env);
		expect(newKid).not.toBe(a.kid);
		expect(retiredKid).toBe(a.kid);

		// both must still be fetchable as public keys
		const aPub = await getPublicJwkByKid(env, retiredKid!);
		const bPub = await getPublicJwkByKid(env, newKid);
		expect(aPub).toBeTruthy();
		expect(bPub).toBeTruthy();

		const listed = await listActiveJwks(env);
		expect(listed.map((x) => x.kid)).toEqual(expect.arrayContaining([retiredKid, newKid]));
	});
});
