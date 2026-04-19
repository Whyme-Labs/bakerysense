import { z } from "zod";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { Unauthorized, BadRequest, Forbidden, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";
import { upsertActual, listActuals } from "@/lib/actuals";

export const runtime = "nodejs";

const Body = z.object({
	branchId: z.string().min(1),
	family: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	recommendedBake: z.number().int().nonnegative().nullish(),
	actualBake: z.number().int().nonnegative().nullish(),
	actualSales: z.number().int().nonnegative().nullish(),
	wasteUnits: z.number().int().nonnegative().nullish(),
	source: z.enum(["manual", "close_out_photo"]).default("manual"),
});

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		const url = new URL(req.url);
		const branchId = url.searchParams.get("branch");
		if (!branchId) throw new BadRequest("missing ?branch=");
		const rows = await listActuals(env, session.claims.tid, branchId);
		return Response.json({ actuals: rows });
	} catch (e) { return errorResponse(e); }
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		const parsed = Body.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const id = await upsertActual(env, {
			tenantId: session.claims.tid,
			branchId: parsed.data.branchId,
			family: parsed.data.family,
			date: parsed.data.date,
			recommendedBake: parsed.data.recommendedBake,
			actualBake: parsed.data.actualBake,
			actualSales: parsed.data.actualSales,
			wasteUnits: parsed.data.wasteUnits,
			source: parsed.data.source,
			capturedByUserId: session.claims.sub,
		});
		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "actuals.recorded",
			target: id,
			metadata: { branchId: parsed.data.branchId, family: parsed.data.family, date: parsed.data.date },
		});
		return Response.json({ id }, { status: 201 });
	} catch (e) { return errorResponse(e); }
}
