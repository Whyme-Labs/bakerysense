import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

describe("auth flow", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
	});

	it("signup creates tenant + user + membership + branch + cookies", async () => {
		const res = await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "demo@bakerysense.app",
				password: "Demo2026DemoDemo",
				tenantName: "Favorita",
				tenantSlug: "favorita",
				vertical: "bakery",
			}),
		});
		expect(res.status).toBe(201);
		const setCookie = res.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(/bs_at=/);
		expect(setCookie).toMatch(/bs_rt=/);
	});

	it("duplicate email 409", async () => {
		await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"a@b.co", password:"Aa2026Aa2026Aa", tenantName:"A", tenantSlug:"a", vertical:"bakery" }),
		});
		const res2 = await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"a@b.co", password:"Aa2026Aa2026Aa", tenantName:"B", tenantSlug:"b", vertical:"bakery" }),
		});
		expect(res2.status).toBe(409);
	});
});
