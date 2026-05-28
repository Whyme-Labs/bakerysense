// POST /api/harness/inspect
//
// Runs the self-inspection loop for one branch on demand (the nightly job
// invoked manually — useful for demos and for an operator who wants to
// check "what has the harness learned this week?"). Writes a pending or
// rejected_validation evolution_proposals row and returns the outcome.
//
// Authorisation: branch_manager or tenant_admin, with branch tenant scope.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole, assertBranchAccess } from "@/lib/rbac";
import { Unauthorized, BadRequest, Forbidden, NotFound, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { inspectBranch } from "@/lib/harness/inspector";
import { isSkillId } from "@/lib/harness/registry";

export const runtime = "nodejs";

const Body = z.object({
	branchId: z.string().min(1),
	skillId: z.string().optional(),
	asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin", "branch_manager"]);

		const parsed = Body.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const { branchId, asOf } = parsed.data;
		const skillId = parsed.data.skillId && isSkillId(parsed.data.skillId) ? parsed.data.skillId : "forecast";

		const tenantId = session.claims.tid;
		const branch = await getDb(env)
			.select({ id: branches.id, tenantId: branches.tenantId })
			.from(branches)
			.where(eq(branches.id, branchId))
			.get();
		if (!branch || branch.tenantId !== tenantId) throw new NotFound("branch not found");
		assertBranchAccess(session.claims, branchId);

		const outcome = await inspectBranch(env, { tenantId, branchId, skillId, asOf });

		await writeAudit(env, {
			tenantId,
			actorUserId: session.claims.sub,
			action: "harness.inspected",
			target: branchId,
			metadata: { skillId, asOf: asOf ?? null, status: outcome.status, proposalId: outcome.proposalId ?? null, editCount: outcome.editCount },
		});

		return Response.json(outcome);
	} catch (e) {
		return errorResponse(e);
	}
}
