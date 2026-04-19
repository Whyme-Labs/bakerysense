import { callTool } from "@/lib/tool-rest-adapter";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ family: string }> }): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const url = new URL(req.url);
    const onDate = url.searchParams.get("on_date");
    const branchId = url.searchParams.get("branch");
    if (!onDate || !branchId) throw new BadRequest("missing ?on_date= or ?branch=");
    const { family } = await params;
    const args: Record<string, unknown> = {
      sku: decodeURIComponent(family),
      on_date: onDate,
      branch_id: branchId,
    };
    const topKParam = url.searchParams.get("top_k");
    if (topKParam !== null) {
      const topK = parseInt(topKParam, 10);
      if (!isNaN(topK)) args.top_k = topK;
    }
    const out = await callTool("explain_drivers", args, env, req);
    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
