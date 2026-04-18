import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

async function signup(email: string, slug: string): Promise<string> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password:"Iso2026Iso2026", tenantName:slug, tenantSlug:slug, vertical:"bakery" }),
	});
	return (res.headers.get("set-cookie") ?? "").split(",").map((s) => s.split(";")[0]).join("; ");
}

describe("multi-tenant isolation", () => {
	beforeEach(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

	it("tenant A connectors are invisible to tenant B", async () => {
		const cookieA = await signup("a@x.co", "a");
		const cookieB = await signup("b@x.co", "b");

		// A creates a connector
		await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: cookieA },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});

		// B lists connectors
		const res = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: cookieB } });
		const body = await res.json();
		expect(body.connectors).toHaveLength(0);
	});

	it("tenant B cannot delete tenant A's connector by guessing its id", async () => {
		const cookieA = await signup("a2@x.co", "a2");
		const cookieB = await signup("b2@x.co", "b2");
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: cookieA },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});
		const created = await create.json();
		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method:"DELETE", headers: { cookie: cookieB } });
		// Because of tenant-scoped KV keys, the delete is a no-op from B's tenant view — 204 is fine, the connector still exists for A
		expect([204, 404]).toContain(del.status);
		const listA = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: cookieA } });
		expect((await listA.json()).connectors).toHaveLength(1);
	});
});
