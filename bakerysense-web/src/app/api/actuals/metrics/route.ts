import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { rollingWapePerFamily } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch");
    if (!branchId) throw new BadRequest("missing ?branch=");
    const windowRaw = url.searchParams.get("window") ?? "7";
    const windowNum = Number(windowRaw);
    if (!Number.isFinite(windowNum) || windowNum < 1 || windowNum > 180) throw new BadRequest("window must be 1..180");
    const family = url.searchParams.get("family") ?? undefined;
    const entries = await rollingWapePerFamily(env, session.claims.tid, branchId, windowNum, family);
    return Response.json({ window: windowNum, entries });
  } catch (e) { return errorResponse(e); }
}
