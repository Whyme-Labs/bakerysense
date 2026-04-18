// Test worker dispatcher for @cloudflare/vitest-pool-workers SELF.fetch tests.
// Sets the cloudflare context on globalThis (matching the symbol used by @opennextjs/cloudflare),
// then routes requests to Next.js API route handlers.

import { POST as signupPOST } from "./src/app/api/auth/signup/route.js";

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

		return new Response("Not Found", { status: 404 });
	},
};
