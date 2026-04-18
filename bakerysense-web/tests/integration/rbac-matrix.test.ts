import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { CAPABILITIES } from "@/lib/rbac/permissions";

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

async function signupAdmin(slug: string): Promise<AuthResult> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:`${slug}@x.co`, password:"Matrix2026Matrix!", tenantName:slug, tenantSlug:slug, vertical:"bakery" }),
	});
	if (res.status !== 201) {
		throw new Error(`Signup failed: ${res.status}`);
	}
	const setCookie = res.headers.get("set-cookie") ?? "";
	if (!setCookie) {
		throw new Error("No set-cookie header in signup response");
	}
	return extractCookiesAndCsrf(res);
}

describe("RBAC matrix (tenant_admin baseline)", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		// clear KV between tests to avoid rate-limit bleed
		const list = await env.KV.list();
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	for (const cap of CAPABILITIES) {
		const pathTemplate = cap.path.replace(":id", "dummy");
		it(`tenant_admin ${cap.method} ${cap.path}`, async () => {
			// Generate a unique slug using path + method + random suffix
			const pathPart = cap.path.replace(/[^a-z0-9]/g, "").slice(0, 8);
			const methodPart = cap.method.toLowerCase().slice(0, 2);
			const randomPart = Math.random().toString(36).slice(2, 6);
			const slug = pathPart + methodPart + randomPart;
			const { cookie, csrf } = await signupAdmin(slug);
			const opts: { method: string; headers: Record<string, string>; body?: string } = {
				method: cap.method,
				headers: { cookie, "x-csrf-token": csrf },
			};
			// Add minimal body for POST requests that require content
			if (cap.method === "POST") {
				opts.headers["content-type"] = "application/json";
				if (cap.path === "/api/connector") {
					opts.body = JSON.stringify({
						label: "test", preset: "custom", baseUrl: "http://test", model: "test", authMethod: "none"
					});
				} else {
					// provide empty JSON for other POST endpoints to avoid request parsing errors
					opts.body = JSON.stringify({});
				}
			}
			const res = await SELF.fetch(`https://x.test${pathTemplate}`, opts);
			// we allow 2xx/3xx/400/404 but never 401/403 for a role on the allow list
			expect([200, 201, 204, 302, 400, 404]).toContain(res.status);
			expect([401, 403]).not.toContain(res.status);
		});
	}
});
