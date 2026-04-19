import { callTool } from "@/lib/tool-rest-adapter";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch");
    if (!branchId) throw new BadRequest("missing ?branch=");
    const out = await callTool("list_skus", { branch_id: branchId }, env, req);
    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
