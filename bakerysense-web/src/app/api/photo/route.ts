import { z } from "zod";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDefaultConnector, resolveUpstreamCredential } from "@/lib/connector";
import { buildToolCtx } from "@/lib/tool-rest-adapter";
import { dispatch } from "@/lib/tools";

export const runtime = "nodejs";

const Body = z.object({
  branchId: z.string().min(1),
  imageBase64: z.string().min(100), // data URL like "data:image/jpeg;base64,..."
});

const SYSTEM_PROMPT =
  "You are analyzing a bakery display-case photo. Return a JSON object mapping " +
  "SKU name (uppercase, matching the merchant's catalogue) to remaining unit count. " +
  "Return JSON only, no prose.";

export async function POST(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub)))
      throw new Forbidden("csrf");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new BadRequest("invalid body");
    const { branchId, imageBase64 } = parsed.data;

    const connector = await getDefaultConnector(env, session.claims.tid);
    if (!connector) throw new BadRequest("no default connector");
    const apiKey = await resolveUpstreamCredential(env, connector);

    const upstreamBody = {
      model: connector.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Count the remaining units per SKU visible in this display case." },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 512,
    };

    const upstream = await fetch(`${connector.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
    });
    if (!upstream.ok) {
      const errBody = await upstream.text();
      throw new Error(`LLM upstream ${upstream.status}: ${errBody.slice(0, 300)}`);
    }
    const payload = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "{}";
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
    } catch {
      counts = {};
    }

    const { ctx } = await buildToolCtx(env, req);
    const today = new Date().toISOString().slice(0, 10);
    const suggestions = await dispatch(
      "suggest_markdowns",
      { branch_id: branchId, as_of: today, inventory: counts },
      ctx,
    );

    return Response.json({ counts, suggestions });
  } catch (e) {
    return errorResponse(e);
  }
}
