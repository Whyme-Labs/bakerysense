// POST /api/harness/proposals/[id]/reject
//
// Rejects a pending evolution proposal. Records the decision; no skill
// version is created.
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole, assertBranchAccess } from "@/lib/rbac";
import { Unauthorized, Forbidden, NotFound, BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";
import { getProposal } from "@/lib/evolution-proposals";
import { rejectProposal } from "@/lib/harness/approval";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin", "branch_manager"]);

		const { id } = await params;
		const proposal = await getProposal(env, id);
		if (!proposal || proposal.tenantId !== session.claims.tid) throw new NotFound("proposal not found");
		if (proposal.status !== "pending") throw new BadRequest(`proposal not pending: ${proposal.status}`);
		if (proposal.branchId) assertBranchAccess(session.claims, proposal.branchId);

		await rejectProposal(env, id, session.claims.sub);

		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "harness.proposal_rejected",
			target: id,
			metadata: { branchId: proposal.branchId },
		});

		return Response.json({ status: "rejected" });
	} catch (e) {
		return errorResponse(e);
	}
}
