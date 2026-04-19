import { dispatch } from "@/lib/tools";
import { buildToolCtx } from "@/lib/tool-rest-adapter";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeForecastSnapshot, activeModelVersion } from "@/lib/snapshots";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ family: string }> }): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const url = new URL(req.url);
    const onDate = url.searchParams.get("on_date");
    const branchId = url.searchParams.get("branch");
    if (!onDate || !branchId) throw new BadRequest("missing ?on_date= or ?branch=");
    const { family } = await params;
    const decodedFamily = decodeURIComponent(family);
    const { session, ctx } = await buildToolCtx(env, req);
    const out = await dispatch("forecast", {
      sku: decodedFamily, on_date: onDate, branch_id: branchId,
    }, ctx) as Record<string, unknown>;

    // Write snapshot — failures must not break the user response
    try {
      const bakeQuantity = out.bake_quantity as number | undefined;
      const quantiles = out.quantiles as Record<string, number> | undefined;
      if (bakeQuantity != null && quantiles != null) {
        await writeForecastSnapshot(env, {
          tenantId: session!.claims.tid,
          branchId,
          family: decodedFamily,
          date: onDate,
          modelVersion: await activeModelVersion(env, session!.claims.tid),
          bakeQuantity,
          quantiles,
        });
      }
    } catch (snapshotErr) {
      console.error("[snapshot] write failed for forecast/[family]", snapshotErr);
    }

    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
