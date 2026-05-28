// Approval path — the human gate that closes the loop. Approving a pending
// proposal applies its edits to the target scope's rules and activates a new
// skill_versions row (superseding the old one), after which the very next
// loadEffectiveRules call picks up the learned correction and the forecast
// overlay shifts. Rejecting simply records the decision.
//
// Scope semantics:
//   - branch proposal (branchId set): edits apply to the branch's SPARSE
//     override (starting from {} if the branch has never diverged), so the
//     branch keeps inheriting untouched brand keys.
//   - brand proposal (branchId null): edits apply to the brand's FULL rules
//     (starting from the builtin baseline if no brand row exists yet).
//
// Always human-gated; the harness never auto-approves.
import { applyEdits, type EditOp } from "@/lib/harness/patch";
import { isSkillId, BUILTIN_SKILLS, type SkillId } from "@/lib/harness/registry";
import type { Rules } from "@/lib/harness/resolver";
import { getActiveVersion, supersedeAndActivate } from "@/lib/skill-versions";
import { getProposal, markReviewed } from "@/lib/evolution-proposals";

export interface ApprovalResult {
	skillVersionId: string;
	skillId: SkillId;
	branchId: string | null;
}

export async function approveProposal(
	env: CloudflareEnv,
	proposalId: string,
	userId: string,
): Promise<ApprovalResult> {
	const p = await getProposal(env, proposalId);
	if (!p) throw new Error("proposal_not_found");
	if (p.status !== "pending") throw new Error(`proposal_not_pending: ${p.status}`);
	if (!isSkillId(p.skillId)) throw new Error(`unknown_skill: ${p.skillId}`);

	const skillId: SkillId = p.skillId;
	const branchId = p.branchId; // string | null
	const edits = JSON.parse(p.editOpsJson) as EditOp[];

	// Base rules for the new version: the current active version's rules for
	// this exact scope, or the scope-appropriate empty baseline.
	const current = await getActiveVersion(env, p.tenantId, skillId, branchId);
	const baseRules: Rules = current
		? (JSON.parse(current.rulesJson) as Rules)
		: branchId === null
			? BUILTIN_SKILLS[skillId].rules
			: {};

	const newRules = applyEdits(baseRules, edits);

	const skillVersionId = await supersedeAndActivate(env, {
		tenantId: p.tenantId,
		branchId,
		skillId,
		rulesJson: JSON.stringify(newRules),
		parentId: current?.id ?? p.parentSkillVersionId,
		validationMetricsJson: p.validationMetricsJson,
	});

	await markReviewed(env, proposalId, userId, "approved");
	return { skillVersionId, skillId, branchId };
}

export async function rejectProposal(env: CloudflareEnv, proposalId: string, userId: string): Promise<void> {
	const p = await getProposal(env, proposalId);
	if (!p) throw new Error("proposal_not_found");
	if (p.status !== "pending") throw new Error(`proposal_not_pending: ${p.status}`);
	await markReviewed(env, proposalId, userId, "rejected");
}
