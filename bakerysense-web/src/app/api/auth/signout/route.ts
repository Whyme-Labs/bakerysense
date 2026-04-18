import { clearAuthCookie, readAuthCookie } from "@/lib/auth/cookies";
import { rotateRefresh } from "@/lib/auth/refresh";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	const { env } = getCloudflareContext();
	const rt = await readAuthCookie(env, req.headers.get("cookie"), "bs_rt");
	if (rt) {
		try { await rotateRefresh(env, rt); } catch { /* token already revoked is fine */ }
	}
	const headers = new Headers({ "content-type": "application/json" });
	clearAuthCookie(headers, "bs_at");
	clearAuthCookie(headers, "bs_rt");
	return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
