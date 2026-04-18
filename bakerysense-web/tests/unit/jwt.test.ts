import { describe, it, expect } from "vitest";
import { generateKeyPair, signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";

describe("ES256 JWT", () => {
	it("round-trips a payload", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "tenant_admin", branches: null, kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: 60 },
		);
		const decoded = await verifyAccessToken(token, async () => publicJwk);
		expect(decoded.sub).toBe("u1");
		expect(decoded.tid).toBe("t1");
		expect(decoded.role).toBe("tenant_admin");
	});

	it("rejects a tampered token", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "staff", branches: ["b1"], kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: 60 },
		);
		const tampered = token.slice(0, -2) + "XX";
		await expect(verifyAccessToken(tampered, async () => publicJwk)).rejects.toThrow();
	});

	it("rejects an expired token", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "staff", branches: ["b1"], kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: -10 },
		);
		await expect(verifyAccessToken(token, async () => publicJwk)).rejects.toThrow(/exp/);
	});
});
