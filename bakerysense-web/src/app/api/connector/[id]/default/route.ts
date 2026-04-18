import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { setDefaultConnector } from "@/lib/connector";
import { Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { verifyCsrf } from "@/lib/auth/csrf";
import { writeAudit } from "@/lib/audit";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");
		const { id } = await params;
		await setDefaultConnector(env, session.claims.tid, id);
		await writeAudit(env, { tenantId: session.claims.tid, actorUserId: session.claims.sub, action: "connector.default_changed", target: id });
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
