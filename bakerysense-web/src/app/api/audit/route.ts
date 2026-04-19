import { eq, desc } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);

		const db = getDb(env);
		const entries = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.tenantId, session.claims.tid))
			.orderBy(desc(auditLog.createdAt))
			.limit(100)
			.all();

		return Response.json({ entries });
	} catch (e) { return errorResponse(e); }
}
