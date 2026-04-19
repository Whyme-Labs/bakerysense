import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { getDb } from "@/db/client";
import { memberships } from "@/db/schema";
import { Unauthorized, BadRequest, Forbidden, NotFound, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const PatchBody = z.object({
	role: z.enum(["tenant_admin", "branch_manager", "staff", "viewer"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);

		const { id: membershipId } = await params;
		const parsed = PatchBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");

		const db = getDb(env);
		const rows = await db
			.update(memberships)
			.set({ role: parsed.data.role })
			.where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, session.claims.tid)))
			.returning();

		if (rows.length === 0) throw new NotFound("membership not found");

		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "member.role_changed",
			target: membershipId,
			metadata: { role: parsed.data.role },
		});

		return Response.json({ ok: true });
	} catch (e) { return errorResponse(e); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);

		const { id: membershipId } = await params;
		const db = getDb(env);

		// Verify the membership belongs to this tenant before deleting
		const existing = await db
			.select()
			.from(memberships)
			.where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, session.claims.tid)))
			.limit(1)
			.all();

		if (existing.length === 0) throw new NotFound("membership not found");

		await db.delete(memberships).where(eq(memberships.id, membershipId));

		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "member.removed",
			target: membershipId,
			metadata: { userId: existing[0].userId },
		});

		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
