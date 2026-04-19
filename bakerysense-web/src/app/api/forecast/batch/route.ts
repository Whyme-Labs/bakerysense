import { dispatch } from "@/lib/tools";
import { buildToolCtx } from "@/lib/tool-rest-adapter";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch");
    const onDate = url.searchParams.get("on_date");
    if (!branchId || !onDate) throw new BadRequest("missing ?branch= or ?on_date=");
    const { ctx } = await buildToolCtx(env, req);
    const skusRes = await dispatch("list_skus", { branch_id: branchId }, ctx) as { skus?: string[] };
    const skus = skusRes.skus ?? [];
    const forecasts = await Promise.all(
      skus.map(async (sku) => {
        const r = await dispatch("forecast", { sku, on_date: onDate, branch_id: branchId }, ctx) as Record<string, unknown>;
        return { sku, ...r };
      })
    );
    return Response.json({ branch: branchId, on_date: onDate, forecasts });
  } catch (e) { return errorResponse(e); }
}
