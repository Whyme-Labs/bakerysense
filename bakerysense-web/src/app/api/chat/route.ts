import { z } from "zod";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createChatSession, createTurn, loadChatSession } from "@/lib/chat-session";

export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1).max(4000),
  branchId: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const csrf = req.headers.get("x-csrf-token");
    const ok = await verifyCsrf(env, csrf, session.claims.sub);
    if (!ok) throw new Forbidden("csrf");

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new BadRequest("invalid body");
    const { message, branchId } = parsed.data;
    let chatSessionId = parsed.data.sessionId;

    if (!chatSessionId) {
      const s = await createChatSession(env, {
        tenantId: session.claims.tid,
        userId: session.claims.sub,
        branchId,
      });
      chatSessionId = s.sessionId;
    } else {
      const existing = await loadChatSession(env, chatSessionId);
      if (!existing || existing.tenantId !== session.claims.tid || existing.userId !== session.claims.sub) {
        throw new BadRequest("invalid sessionId");
      }
    }

    const turn = await createTurn(env, chatSessionId);
    await env.CHAT_QUEUE.send({
      sessionId: chatSessionId,
      turnId: turn.turnId,
      tenantId: session.claims.tid,
      userId: session.claims.sub,
      branchId,
      userMessage: message,
      permittedBranches: session.claims.branches,
    });

    return Response.json({
      sessionId: chatSessionId,
      turnId: turn.turnId,
      streamUrl: `/api/chat/stream/${turn.turnId}?s=${chatSessionId}`,
    }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}
