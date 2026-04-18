import { randomBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);

		const verifier = base64url.encode(randomBytes(32));
		const challenge = base64url.encode(sha256(new TextEncoder().encode(verifier)));
		const state = base64url.encode(randomBytes(16));

		await env.KV.put(`oauth:state:${state}`, JSON.stringify({
			tenantId: session.claims.tid,
			initiatedByUserId: session.claims.sub,
			verifier,
			createdAt: Date.now(),
		}), { expirationTtl: 600 });

		const url = new URL("https://openrouter.ai/auth");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", env.OPENROUTER_OAUTH_CLIENT_ID ?? "placeholder");
		url.searchParams.set("redirect_uri", new URL("/api/oauth/openrouter/callback", req.url).toString());
		url.searchParams.set("code_challenge", challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("state", state);
		return Response.redirect(url.toString(), 302);
	} catch (e) { return errorResponse(e); }
}
