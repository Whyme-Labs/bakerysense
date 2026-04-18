// Test worker dispatcher for @cloudflare/vitest-pool-workers SELF.fetch tests.
// Sets the cloudflare context on globalThis (matching the symbol used by @opennextjs/cloudflare),
// then routes requests to Next.js API route handlers.

import { POST as signupPOST } from "./src/app/api/auth/signup/route.js";
import { POST as signinPOST } from "./src/app/api/auth/signin/route.js";
import { POST as refreshPOST } from "./src/app/api/auth/refresh/route.js";
import { POST as signoutPOST } from "./src/app/api/auth/signout/route.js";
import { GET as meGET } from "./src/app/api/auth/me/route.js";

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

		return new Response("Not Found", { status: 404 });
	},
};
