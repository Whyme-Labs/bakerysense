import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { getDb } from "@/db/client";
import { dailyActuals } from "@/db/schema";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const PatchBody = z.object({
	branchId: z.string().min(1).optional(),
	family: z.string().min(1).optional(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	recommendedBake: z.number().int().nonnegative().nullish(),
	actualBake: z.number().int().nonnegative().nullish(),
	actualSales: z.number().int().nonnegative().nullish(),
	wasteUnits: z.number().int().nonnegative().nullish(),
	source: z.enum(["manual", "close_out_photo"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");
		const { id } = await params;
		const parsed = PatchBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const db = getDb(env);
		const rows = await db
			.update(dailyActuals)
			.set({ ...parsed.data, capturedAt: Date.now() })
			.where(and(eq(dailyActuals.tenantId, session.claims.tid), eq(dailyActuals.id, id)))
			.returning();
		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "actuals.updated",
			target: id,
			metadata: parsed.data,
		});
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
		const { id } = await params;
		await getDb(env)
			.delete(dailyActuals)
			.where(and(eq(dailyActuals.tenantId, session.claims.tid), eq(dailyActuals.id, id)));
		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "actuals.deleted",
			target: id,
		});
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
