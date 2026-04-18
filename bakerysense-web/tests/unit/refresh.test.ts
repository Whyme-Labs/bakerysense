import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { issueRefresh, rotateRefresh, revokeAllForUser } from "@/lib/auth/refresh";

describe("refresh tokens", () => {
	beforeEach(async () => {
		const list = await env.KV.list({ prefix: "rt:" });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("issues and rotates a refresh token", async () => {
		const { token: t1 } = await issueRefresh(env, { userId: "u1", tenantId: "t1" });
		const { token: t2, oldRevoked } = await rotateRefresh(env, t1);
		expect(t2).not.toBe(t1);
		expect(oldRevoked).toBe(true);
	});

	it("reuse of a revoked token nukes all user sessions", async () => {
		const { token: t1 } = await issueRefresh(env, { userId: "u2", tenantId: "t1" });
		const { token: t2 } = await rotateRefresh(env, t1);   // t1 revoked
		// attempt to reuse t1 → must throw AND revoke t2
		await expect(rotateRefresh(env, t1)).rejects.toThrow(/reuse/);
		await expect(rotateRefresh(env, t2)).rejects.toThrow();   // already nuked
	});

	it("revokeAllForUser clears every active token", async () => {
		const a = await issueRefresh(env, { userId: "u3", tenantId: "t1" });
		const b = await issueRefresh(env, { userId: "u3", tenantId: "t1" });
		await revokeAllForUser(env, "u3");
		await expect(rotateRefresh(env, a.token)).rejects.toThrow();
		await expect(rotateRefresh(env, b.token)).rejects.toThrow();
	});
});
