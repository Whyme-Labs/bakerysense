import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { loadTurn } from "@/lib/chat-session";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(req: Request, { params }: { params: Promise<{ turnId: string }> }): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const { turnId } = await params;
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("s");
    if (!sessionId) return new Response("missing ?s", { status: 400 });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

        let lastIndex = 0;
        let attempts = 0;
        while (attempts < 150) {
          const t = await loadTurn(env, sessionId, turnId);
          if (!t) { send({ type: "error", message: "turn not found" }); break; }
          for (let i = lastIndex; i < t.events.length; i++) send(t.events[i]);
          lastIndex = t.events.length;
          if (t.status === "done" || t.status === "failed") {
            send({ type: "final", status: t.status, finalAnswer: t.finalAnswer, error: t.error });
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
          attempts++;
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  } catch (e) { return errorResponse(e); }
}
