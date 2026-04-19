import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";
import { upsertActual, parseActualsCsv } from "@/lib/actuals";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);
		const body = await req.json() as { branchId?: string; csv?: string };
		if (!body.branchId || !body.csv) throw new BadRequest("missing branchId or csv");
		const { rows, errors } = parseActualsCsv(body.csv, session.claims.tid, body.branchId, session.claims.sub);
		if (errors.length && rows.length === 0) {
			return Response.json({ imported: 0, errors }, { status: 409 });
		}
		let imported = 0;
		for (const r of rows) {
			await upsertActual(env, r);
			imported += 1;
		}
		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "actuals.bulk_imported",
			target: body.branchId,
			metadata: { imported, skipped: errors.length },
		});
		return Response.json({ imported, errors });
	} catch (e) { return errorResponse(e); }
}
