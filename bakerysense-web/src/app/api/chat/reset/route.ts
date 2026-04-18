import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const csrf = req.headers.get("x-csrf-token");
    const ok = await verifyCsrf(env, csrf, session.claims.sub);
    if (!ok) throw new Forbidden("csrf");
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    if (body.sessionId) {
      await env.KV.delete(`chat:session:${body.sessionId}`);
    }
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
