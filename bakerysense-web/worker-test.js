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
import { POST as publishModelPOST } from "./src/app/api/internal/publish-model/route.js";
import { POST as seedDemoPOST } from "./src/app/api/admin/seed-demo/route.js";
import { POST as passwordChangePOST } from "./src/app/api/auth/password-change/route.js";

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

		if (url.pathname === "/api/auth/password-change") {
			if (request.method === "POST") return passwordChangePOST(request);
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

		if (url.pathname === "/api/internal/publish-model") {
			if (request.method === "POST") return publishModelPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/connector/:id/default
		const mDefault = url.pathname.match(/^\/api\/connector\/([^/]+)\/default$/);
		if (mDefault && request.method === "POST") {
			const mod = await import("./src/app/api/connector/[id]/default/route.ts");
			return mod.POST(request, { params: Promise.resolve({ id: mDefault[1] }) });
		}

		// POST /api/connector/:id/test
		const mTest = url.pathname.match(/^\/api\/connector\/([^/]+)\/test$/);
		if (mTest && request.method === "POST") {
			const mod = await import("./src/app/api/connector/[id]/test/route.ts");
			return mod.POST(request, { params: Promise.resolve({ id: mTest[1] }) });
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

		// POST /api/chat
		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/chat/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/chat/stream/:turnId
		const mChatStream = url.pathname.match(/^\/api\/chat\/stream\/([^/]+)$/);
		if (mChatStream && request.method === "GET") {
			const mod = await import("./src/app/api/chat/stream/[turnId]/route.ts");
			return mod.GET(request, { params: Promise.resolve({ turnId: mChatStream[1] }) });
		}

		// GET /api/chat/turn/:turnId
		const mChatTurn = url.pathname.match(/^\/api\/chat\/turn\/([^/]+)$/);
		if (mChatTurn && request.method === "GET") {
			const mod = await import("./src/app/api/chat/turn/[turnId]/route.ts");
			return mod.GET(request, { params: Promise.resolve({ turnId: mChatTurn[1] }) });
		}

		// POST /api/chat/reset
		if (url.pathname === "/api/chat/reset") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/chat/reset/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/skus
		if (url.pathname === "/api/skus") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/skus/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/forecast/batch — must match BEFORE /api/forecast/:family
		if (url.pathname === "/api/forecast/batch") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/forecast/batch/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/forecast/plans — must match BEFORE /api/forecast/:family
		if (url.pathname === "/api/forecast/plans") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/forecast/plans/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/forecast/:family
		const mForecastFamily = url.pathname.match(/^\/api\/forecast\/([^/]+)$/);
		if (mForecastFamily && request.method === "GET") {
			const family = decodeURIComponent(mForecastFamily[1]);
			const mod = await import("./src/app/api/forecast/[family]/route.ts");
			return mod.GET(request, { params: Promise.resolve({ family }) });
		}

		// GET /api/explain/:family
		const mExplainFamily = url.pathname.match(/^\/api\/explain\/([^/]+)$/);
		if (mExplainFamily && request.method === "GET") {
			const family = decodeURIComponent(mExplainFamily[1]);
			const mod = await import("./src/app/api/explain/[family]/route.ts");
			return mod.GET(request, { params: Promise.resolve({ family }) });
		}

		// PATCH/DELETE /api/branches/:id
		const mBranch = url.pathname.match(/^\/api\/branches\/([^/]+)$/);
		if (mBranch) {
			const mod = await import("./src/app/api/branches/[id]/route.ts");
			if (request.method === "PATCH") return mod.PATCH(request, { params: Promise.resolve({ id: mBranch[1] }) });
			if (request.method === "DELETE") return mod.DELETE(request, { params: Promise.resolve({ id: mBranch[1] }) });
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET/POST /api/branches
		if (url.pathname === "/api/branches") {
			const mod = await import("./src/app/api/branches/route.ts");
			if (request.method === "GET") return mod.GET(request);
			if (request.method === "POST") return mod.POST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/photo
		if (url.pathname === "/api/photo") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/photo/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// PATCH/DELETE /api/users/:id
		const mUser = url.pathname.match(/^\/api\/users\/([^/]+)$/);
		if (mUser) {
			const mod = await import("./src/app/api/users/[id]/route.ts");
			if (request.method === "PATCH") return mod.PATCH(request, { params: Promise.resolve({ id: mUser[1] }) });
			if (request.method === "DELETE") return mod.DELETE(request, { params: Promise.resolve({ id: mUser[1] }) });
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET/POST /api/users
		if (url.pathname === "/api/users") {
			const mod = await import("./src/app/api/users/route.ts");
			if (request.method === "GET") return mod.GET(request);
			if (request.method === "POST") return mod.POST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/audit
		if (url.pathname === "/api/audit") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/audit/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/actuals/metrics — literal match before :id regex
		if (url.pathname === "/api/actuals/metrics") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/actuals/metrics/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/actuals/bulk — literal match before :id regex
		if (url.pathname === "/api/actuals/bulk") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/actuals/bulk/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// PATCH/DELETE /api/actuals/:id
		const mActual = url.pathname.match(/^\/api\/actuals\/([^/]+)$/);
		if (mActual) {
			const mod = await import("./src/app/api/actuals/[id]/route.ts");
			if (request.method === "PATCH") return mod.PATCH(request, { params: Promise.resolve({ id: mActual[1] }) });
			if (request.method === "DELETE") return mod.DELETE(request, { params: Promise.resolve({ id: mActual[1] }) });
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET/POST /api/actuals
		if (url.pathname === "/api/actuals") {
			const mod = await import("./src/app/api/actuals/route.ts");
			if (request.method === "GET") return mod.GET(request);
			if (request.method === "POST") return mod.POST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/admin/retrain/history — literal match BEFORE /api/admin/retrain
		if (url.pathname === "/api/admin/retrain/history") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/admin/retrain/history/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/admin/retrain
		if (url.pathname === "/api/admin/retrain") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/admin/retrain/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// POST /api/admin/seed-demo
		if (url.pathname === "/api/admin/seed-demo") {
			if (request.method === "POST") return seedDemoPOST(request);
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/admin/lineage  (literal match before :snapshotId regex)
		if (url.pathname === "/api/admin/lineage") {
			if (request.method === "GET") {
				const mod = await import("./src/app/api/admin/lineage/route.ts");
				return mod.GET(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		// GET /api/admin/lineage/:snapshotId
		const mLineageSnap = url.pathname.match(/^\/api\/admin\/lineage\/([^/]+)$/);
		if (mLineageSnap && request.method === "GET") {
			const mod = await import("./src/app/api/admin/lineage/[snapshotId]/route.ts");
			return mod.GET(request, { params: Promise.resolve({ snapshotId: mLineageSnap[1] }) });
		}

		// POST /api/bake-plans/commit
		if (url.pathname === "/api/bake-plans/commit") {
			if (request.method === "POST") {
				const mod = await import("./src/app/api/bake-plans/commit/route.ts");
				return mod.POST(request);
			}
			return new Response("Method Not Allowed", { status: 405 });
		}

		return new Response("Not Found", { status: 404 });
	},
};
