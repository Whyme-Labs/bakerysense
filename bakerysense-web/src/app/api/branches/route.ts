import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const CreateBody = z.object({
	name: z.string().min(1).max(80),
	city: z.string().max(80).optional(),
	cluster: z.string().max(40).optional(),
	type: z.string().max(40).optional(),
});

function newId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `brn_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		const db = getDb(env);
		const rows = await db.select().from(branches)
			.where(eq(branches.tenantId, session.claims.tid))
			.orderBy(asc(branches.name))
			.all();
		if (session.claims.role !== "tenant_admin" && session.claims.role !== "platform_admin" && session.claims.branches) {
			const allowed = new Set(session.claims.branches);
			return Response.json({ branches: rows.filter((b) => allowed.has(b.id)) });
		}
		return Response.json({ branches: rows });
	} catch (e) { return errorResponse(e); }
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);
		const parsed = CreateBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const id = newId();
		const now = Date.now();
		await getDb(env).insert(branches).values({ id, tenantId: session.claims.tid, ...parsed.data, createdAt: now });
		await writeAudit(env, { tenantId: session.claims.tid, actorUserId: session.claims.sub, action: "branch.created", target: id, metadata: parsed.data });
		return Response.json({ id, ...parsed.data }, { status: 201 });
	} catch (e) { return errorResponse(e); }
}
