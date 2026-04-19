import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const PatchBody = z.object({
	name: z.string().min(1).max(80).optional(),
	city: z.string().max(80).optional(),
	cluster: z.string().max(40).optional(),
	type: z.string().max(40).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);
		const { id } = await params;
		const parsed = PatchBody.safeParse(await req.json());
		if (!parsed.success) throw new Forbidden("invalid body");
		const db = getDb(env);
		const rows = await db
			.update(branches)
			.set(parsed.data)
			.where(and(eq(branches.tenantId, session.claims.tid), eq(branches.id, id)))
			.returning();
		await writeAudit(env, { tenantId: session.claims.tid, actorUserId: session.claims.sub, action: "branch.updated", target: id, metadata: parsed.data });
		return Response.json(rows[0] ?? null);
	} catch (e) { return errorResponse(e); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);
		const { id } = await params;
		await getDb(env)
			.delete(branches)
			.where(and(eq(branches.tenantId, session.claims.tid), eq(branches.id, id)));
		await writeAudit(env, { tenantId: session.claims.tid, actorUserId: session.claims.sub, action: "branch.deleted", target: id });
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
