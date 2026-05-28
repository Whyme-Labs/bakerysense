// evolution_proposals DB access — the pending-approval queue for harness
// edits. The inspector writes rows here; the /harness approval route reads
// and resolves them.
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { evolutionProposals } from "@/db/schema";
import type { EditOp } from "@/lib/harness/patch";

type ProposalRow = typeof evolutionProposals.$inferSelect;

function newId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return "evp_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export interface InsertProposalArgs {
	tenantId: string;
	branchId: string | null;
	skillId: string;
	parentSkillVersionId: string;
	edits: EditOp[];
	evidenceTraceIds: string[];
	diagnosisSummary: string;
	diagnosisDetail: unknown;
	validationMetrics: unknown;
	validationPassed: boolean;
	/** "pending" once validation passed; "rejected_validation" otherwise. */
	status: "pending" | "rejected_validation";
}

export async function insertProposal(env: CloudflareEnv, args: InsertProposalArgs): Promise<string> {
	const id = newId();
	await getDb(env).insert(evolutionProposals).values({
		id,
		tenantId: args.tenantId,
		branchId: args.branchId,
		skillId: args.skillId,
		parentSkillVersionId: args.parentSkillVersionId,
		editOpsJson: JSON.stringify(args.edits),
		evidenceTraceIds: JSON.stringify(args.evidenceTraceIds),
		diagnosisSummary: args.diagnosisSummary,
		diagnosisDetailJson: JSON.stringify(args.diagnosisDetail),
		validationMetricsJson: JSON.stringify(args.validationMetrics),
		validationPassed: args.validationPassed ? 1 : 0,
		status: args.status,
		reviewedByUserId: null,
		reviewedAt: null,
		createdAt: Date.now(),
	});
	return id;
}

/** Pending proposals for a tenant (optionally a single branch). Brand-level
 *  proposals (branchId null) are included when branchId is omitted. */
export async function listPendingProposals(
	env: CloudflareEnv,
	tenantId: string,
	branchId?: string | null,
): Promise<ProposalRow[]> {
	const conds = [eq(evolutionProposals.tenantId, tenantId), eq(evolutionProposals.status, "pending")];
	if (branchId !== undefined) {
		conds.push(branchId === null ? isNull(evolutionProposals.branchId) : eq(evolutionProposals.branchId, branchId));
	}
	return getDb(env)
		.select()
		.from(evolutionProposals)
		.where(and(...conds))
		.orderBy(desc(evolutionProposals.createdAt))
		.all();
}

export async function getProposal(env: CloudflareEnv, id: string): Promise<ProposalRow | null> {
	const rows = await getDb(env).select().from(evolutionProposals).where(eq(evolutionProposals.id, id)).limit(1).all();
	return rows[0] ?? null;
}
