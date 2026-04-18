import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

interface AuthResult {
	cookie: string;
	csrf: string;
}

function extractCookiesAndCsrf(res: Response): AuthResult {
	const setCookie = res.headers.get("set-cookie") ?? "";
	const parts = setCookie.split(",").map((s) => s.trim());
	const cookie = parts.map((s) => s.split(";")[0]).join("; ");
	const csrfPart = parts.find((s) => s.startsWith("bs_csrf="));
	const csrf = csrfPart ? decodeURIComponent(csrfPart.split(";")[0].replace("bs_csrf=", "")) : "";
	return { cookie, csrf };
}

async function signup(email: string, slug: string): Promise<AuthResult> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password:"Iso2026Iso2026", tenantName:slug, tenantSlug:slug, vertical:"bakery" }),
	});
	return extractCookiesAndCsrf(res);
}

describe("multi-tenant isolation", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		const listed = await env.KV.list();
		await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
	});

	it("tenant A connectors are invisible to tenant B", async () => {
		const authA = await signup("a@x.co", "a");
		const authB = await signup("b@x.co", "b");

		// A creates a connector
		await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: authA.cookie, "x-csrf-token": authA.csrf },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});

		// B lists connectors
		const res = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: authB.cookie } });
		const body = await res.json() as { connectors: unknown[] };
		expect(body.connectors).toHaveLength(0);
	});

	it("tenant B cannot delete tenant A's connector by guessing its id", async () => {
		const authA = await signup("a2@x.co", "a2");
		const authB = await signup("b2@x.co", "b2");
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: authA.cookie, "x-csrf-token": authA.csrf },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});
		const created = await create.json() as { id: string };
		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method:"DELETE", headers: { cookie: authB.cookie, "x-csrf-token": authB.csrf } });
		// Because of tenant-scoped KV keys, the delete is a no-op from B's tenant view — 204 is fine, the connector still exists for A
		expect([204, 404]).toContain(del.status);
		const listA = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: authA.cookie } });
		expect((await listA.json() as { connectors: unknown[] }).connectors).toHaveLength(1);
	});
});
