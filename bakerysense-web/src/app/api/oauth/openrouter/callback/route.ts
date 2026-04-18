import { createConnector } from "@/lib/connector";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const url = new URL(req.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (!code || !state) throw new BadRequest("missing code/state");

		const rawState = await env.KV.get(`oauth:state:${state}`);
		if (!rawState) throw new BadRequest("unknown state (expired?)");
		await env.KV.delete(`oauth:state:${state}`);
		const st = JSON.parse(rawState) as { tenantId: string; verifier: string; initiatedByUserId: string };

		const tokenRes = await fetch("https://openrouter.ai/api/v1/auth/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				code_verifier: st.verifier,
				client_id: env.OPENROUTER_OAUTH_CLIENT_ID ?? "placeholder",
				redirect_uri: new URL("/api/oauth/openrouter/callback", req.url).toString(),
			}),
		});
		if (!tokenRes.ok) throw new BadRequest(`token exchange failed: ${tokenRes.status}`);
		const body = await tokenRes.json() as { access_token: string; token_type?: string };
		if (!body.access_token) throw new BadRequest("no access_token in response");

		await createConnector(env, st.tenantId, {
			label: "OpenRouter (OAuth)",
			preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "oauth",
			credential: body.access_token,
		});

		return Response.redirect(new URL("/account/settings?oauth=ok", req.url).toString(), 302);
	} catch (e) { return errorResponse(e); }
}
