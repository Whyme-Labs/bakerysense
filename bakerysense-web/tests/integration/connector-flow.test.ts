import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

interface AuthResult {
	cookie: string;
	csrf: string;
}

function extractCookiesAndCsrf(res: Response): AuthResult {
	// get-all-headers not available in Workers fetch; set-cookie may be comma-joined
	const setCookie = res.headers.get("set-cookie") ?? "";
	const parts = setCookie.split(",").map((s) => s.trim());
	// Build cookie string from all name=value pairs (first segment of each directive)
	const cookie = parts.map((s) => s.split(";")[0]).join("; ");
	// Extract bs_csrf value (readable cookie, URL-encoded)
	const csrfPart = parts.find((s) => s.startsWith("bs_csrf="));
	const csrf = csrfPart ? decodeURIComponent(csrfPart.split(";")[0].replace("bs_csrf=", "")) : "";
	return { cookie, csrf };
}

async function signup(): Promise<AuthResult> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"c@d.co", password:"Connect2026Test!!", tenantName:"C", tenantSlug:"c", vertical:"bakery" }),
	});
	return extractCookiesAndCsrf(res);
}

describe("connector flow", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		const listed = await env.KV.list();
		await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
	});

	it("authenticated tenant_admin can create + list + delete a connector", async () => {
		const { cookie, csrf } = await signup();
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST",
			headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-or-xxx" }),
		});
		expect(create.status).toBe(201);
		const created = await create.json() as { id: string };
		expect(created.id).toMatch(/^conn_/);

		const list = await SELF.fetch("https://x.test/api/connector", { headers: { cookie } });
		const body = await list.json() as { connectors: Array<{ encryptedCredential?: string }> };
		expect(body.connectors).toHaveLength(1);
		expect(body.connectors[0].encryptedCredential).toBeUndefined();

		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method: "DELETE", headers: { cookie, "x-csrf-token": csrf } });
		expect(del.status).toBe(204);
	});

	it("unauthenticated request is rejected 401", async () => {
		const res = await SELF.fetch("https://x.test/api/connector");
		expect(res.status).toBe(401);
	});
});
