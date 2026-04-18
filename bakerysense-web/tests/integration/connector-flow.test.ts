import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

async function signup(): Promise<string> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"c@d.co", password:"Connect2026Test!!", tenantName:"C", tenantSlug:"c", vertical:"bakery" }),
	});
	const setCookie = res.headers.get("set-cookie") ?? "";
	return setCookie.split(",").map((s) => s.split(";")[0]).join("; ");
}

describe("connector flow", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		const listed = await env.KV.list();
		await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
	});

	it("authenticated tenant_admin can create + list + delete a connector", async () => {
		const cookie = await signup();
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-or-xxx" }),
		});
		expect(create.status).toBe(201);
		const created = await create.json();
		expect(created.id).toMatch(/^conn_/);

		const list = await SELF.fetch("https://x.test/api/connector", { headers: { cookie } });
		const body = await list.json();
		expect(body.connectors).toHaveLength(1);
		expect(body.connectors[0].encryptedCredential).toBeUndefined();

		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method: "DELETE", headers: { cookie } });
		expect(del.status).toBe(204);
	});

	it("unauthenticated request is rejected 401", async () => {
		const res = await SELF.fetch("https://x.test/api/connector");
		expect(res.status).toBe(401);
	});
});
