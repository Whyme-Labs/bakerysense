import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, NotFound, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadTurn } from "@/lib/chat-session";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ turnId: string }> }): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("s");
    if (!sessionId) return new Response("missing ?s", { status: 400 });
    const { turnId } = await params;
    const t = await loadTurn(env, sessionId, turnId);
    if (!t) throw new NotFound("turn");
    return Response.json(t);
  } catch (e) { return errorResponse(e); }
}
