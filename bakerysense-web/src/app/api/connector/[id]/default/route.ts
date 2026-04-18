import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { setDefaultConnector } from "@/lib/connector";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const { id } = await params;
		await setDefaultConnector(env, session.claims.tid, id);
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
