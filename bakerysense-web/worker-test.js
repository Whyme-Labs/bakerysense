// Test worker dispatcher for @cloudflare/vitest-pool-workers SELF.fetch tests.
// Sets the cloudflare context on globalThis (matching the symbol used by @opennextjs/cloudflare),
// then routes requests to Next.js API route handlers.

import { POST as signupPOST } from "./src/app/api/auth/signup/route.js";
import { POST as signinPOST } from "./src/app/api/auth/signin/route.js";
import { POST as refreshPOST } from "./src/app/api/auth/refresh/route.js";
import { POST as signoutPOST } from "./src/app/api/auth/signout/route.js";
import { GET as meGET } from "./src/app/api/auth/me/route.js";
import { GET as jwksGET } from "./src/app/api/.well-known/jwks.json/route.js";
import { POST as rotateJwksPOST } from "./src/app/api/internal/rotate-jwks/route.js";

const cloudflareContextSymbol = Symbol.for("__cloudflare-context__");

export default {
	async fetch(request, env, ctx) {
		// Make getCloudflareContext() work in route handlers.
		globalThis[cloudflareContextSymbol] = { env, cf: {}, ctx };

		const url = new URL(request.url);

		if (url.pathname === "/api/auth/signup") {
			if (request.method === "POST") return signupPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/auth/signin") {
			if (request.method === "POST") return signinPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/auth/refresh") {
			if (request.method === "POST") return refreshPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/auth/signout") {
			if (request.method === "POST") return signoutPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/auth/me") {
			if (request.method === "GET") return meGET(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/.well-known/jwks.json") {
			if (request.method === "GET") return jwksGET(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		if (url.pathname === "/api/internal/rotate-jwks") {
			if (request.method === "POST") return rotateJwksPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/connector/:id/default
		const mDefault = url.pathname.match(/^\/api\/connector\/([^/]+)\/default$/);
		if (mDefault && request.method === "POST") {
			const mod = await import("./src/app/api/connector/[id]/default/route.ts");
			return mod.POST(request, { params: Promise.resolve({ id: mDefault[1] }) });
		}

		// DELETE /api/connector/:id
		const mDel = url.pathname.match(/^\/api\/connector\/([^/]+)$/);
		if (mDel && request.method === "DELETE") {
			const mod = await import("./src/app/api/connector/[id]/route.ts");
			return mod.DELETE(request, { params: Promise.resolve({ id: mDel[1] }) });
		}

		// GET /api/connector and POST /api/connector
		if (url.pathname === "/api/connector") {
			const mod = await import("./src/app/api/connector/route.ts");
			if (request.method === "GET") return mod.GET(request);
			if (request.method === "POST") return mod.POST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/oauth/openrouter/start
		if (url.pathname === "/api/oauth/openrouter/start") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/oauth/openrouter/start/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/oauth/openrouter/callback
		if (url.pathname === "/api/oauth/openrouter/callback") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/oauth/openrouter/callback/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		return new Response("Not Found", { status: 404 });
	},
};
