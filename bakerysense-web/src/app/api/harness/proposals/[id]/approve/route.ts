// POST /api/harness/proposals/[id]/approve
//
// Approves a pending evolution proposal: applies its edits and activates a
// new skill_versions row for the target scope. After this, loadEffectiveRules
// returns the learned correction and the forecast overlay shifts.
//
// Authorisation: branch_manager or tenant_admin; the proposal must belong to
// the caller's tenant, and (for branch proposals) the caller must have access
// to that branch.
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole, assertBranchAccess } from "@/lib/rbac";
import { Unauthorized, Forbidden, NotFound, BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";
import { getProposal } from "@/lib/evolution-proposals";
import { approveProposal } from "@/lib/harness/approval";

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

		const result = await approveProposal(env, id, session.claims.sub);

		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "harness.proposal_approved",
			target: id,
			metadata: { skillId: result.skillId, branchId: result.branchId, skillVersionId: result.skillVersionId },
		});

		return Response.json({ status: "approved", ...result });
	} catch (e) {
		return errorResponse(e);
	}
}
