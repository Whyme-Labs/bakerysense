import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

describe("auth flow", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		// Clear KV so rate-limit counters don't bleed between tests
		const listed = await env.KV.list();
		await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
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

	it("full signup → signin → me → signout flow", async () => {
		await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"full@b.co", password:"FullFlow2026FullFlow", tenantName:"F", tenantSlug:"f", vertical:"bakery" }),
		});

		const cookieHome = (r: Response) => r.headers.get("set-cookie") ?? "";
		let res: Response;

		res = await SELF.fetch("https://x.test/api/auth/signin", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"full@b.co", password:"FullFlow2026FullFlow", tenantSlug:"f" }),
		});
		expect(res.status).toBe(200);
		const cookies = cookieHome(res);
		expect(cookies).toMatch(/bs_at=/);

		res = await SELF.fetch("https://x.test/api/auth/me", {
			headers: { cookie: cookies.split(",").map((s) => s.split(";")[0]).join("; ") },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.claims.role).toBe("tenant_admin");

		res = await SELF.fetch("https://x.test/api/auth/signout", {
			method: "POST",
			headers: { cookie: cookies.split(",").map((s) => s.split(";")[0]).join("; ") },
		});
		expect(res.status).toBe(200);
	});

	it("rate-limits signin after 5 wrong attempts", async () => {
		// create an account first
		await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"r@x.co", password:"Rate2026Rate!!", tenantName:"R", tenantSlug:"rl", vertical:"bakery" }),
		});

		for (let i = 0; i < 5; i++) {
			await SELF.fetch("https://x.test/api/auth/signin", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ email:"r@x.co", password:"wrong!!", tenantSlug:"rl" }),
			});
		}
		const sixth = await SELF.fetch("https://x.test/api/auth/signin", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"r@x.co", password:"wrong!!", tenantSlug:"rl" }),
		});
		expect(sixth.status).toBe(429);
	});
});
