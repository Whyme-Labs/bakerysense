// POST /api/bake-plans/commit
//
// Records the operator's choice from the three-options bake plan UI.
// Idempotent on (tenant, branch, family, date) — a re-commit for the same
// SKU-day overwrites the prior choice. Lineage-linked: if a forecast
// snapshot id is provided, the row carries forecast_snapshot_id AND
// model_version_id (denormalised from the snapshot for one-hop joins).
//
// Authorisation: branch_manager or tenant_admin. Branch tenant scope is
// enforced; forecast_snapshot_id (if provided) must also belong to the
// caller's tenant — cross-tenant ids return 404 to avoid information leak.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole, assertBranchAccess } from "@/lib/rbac";
import { Unauthorized, BadRequest, Forbidden, NotFound, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { bakePlanDecisions, branches, forecastSnapshots } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const Body = z.object({
	branchId: z.string().min(1),
	family: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	optionKind: z.enum(["conservative", "balanced", "aggressive", "custom"]),
	bakeQuantity: z.number().int().nonnegative(),
	forecastSnapshotId: z.string().min(1).nullish(),
	expected: z.object({
		wasteUnits: z.number().nonnegative(),
		stockoutProb: z.number().min(0).max(1),
		unitsSold: z.number().nonnegative(),
	}).nullish(),
	notes: z.string().max(1000).nullish(),
});

function newId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return "bpd_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) {
			throw new Forbidden("csrf");
		}
		// branch_manager and tenant_admin can commit; staff/viewer cannot.
		requireRole(session.claims, ["tenant_admin", "branch_manager"]);

		const parsed = Body.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const body = parsed.data;

		const db = getDb(env);
		const tenantId = session.claims.tid;

		// Branch scope: 404 cross-tenant.
		const branch = await db
			.select({ id: branches.id, tenantId: branches.tenantId })
			.from(branches)
			.where(eq(branches.id, body.branchId))
			.get();
		if (!branch || branch.tenantId !== tenantId) throw new NotFound("branch not found");
		assertBranchAccess(session.claims, body.branchId);

		// Forecast snapshot lookup (optional) — both forecast_snapshot_id and
		// model_version_id must travel together per the lineage CHECK constraint
		// in migration 0006. If the snapshot exists, denormalise its
		// model_version_id onto the row for one-hop lineage joins.
		let snapshotId: string | null = null;
		let modelVersionId: string | null = null;
		if (body.forecastSnapshotId) {
			const snap = await db
				.select({
					id: forecastSnapshots.id,
					tenantId: forecastSnapshots.tenantId,
					modelVersionId: forecastSnapshots.modelVersionId,
				})
				.from(forecastSnapshots)
				.where(eq(forecastSnapshots.id, body.forecastSnapshotId))
				.get();
			if (!snap || snap.tenantId !== tenantId) throw new NotFound("forecast snapshot not found");
			snapshotId = snap.id;
			modelVersionId = snap.modelVersionId;
		}

		const nowMs = Date.now();
		const id = newId();
		const expected = body.expected ?? null;

		try {
			await db
				.insert(bakePlanDecisions)
				.values({
					id,
					tenantId,
					branchId: body.branchId,
					family: body.family,
					date: body.date,
					optionKind: body.optionKind,
					bakeQuantity: body.bakeQuantity,
					forecastSnapshotId: snapshotId,
					modelVersionId,
					expectedWasteUnits: expected ? String(expected.wasteUnits) : null,
					expectedStockoutProb: expected ? String(expected.stockoutProb) : null,
					expectedUnitsSold: expected ? String(expected.unitsSold) : null,
					committedByUserId: session.claims.sub,
					committedAt: nowMs,
					notes: body.notes ?? null,
				})
				.onConflictDoUpdate({
					target: [
						bakePlanDecisions.tenantId,
						bakePlanDecisions.branchId,
						bakePlanDecisions.family,
						bakePlanDecisions.date,
					],
					set: {
						optionKind: body.optionKind,
						bakeQuantity: body.bakeQuantity,
						forecastSnapshotId: snapshotId,
						modelVersionId,
						expectedWasteUnits: expected ? String(expected.wasteUnits) : null,
						expectedStockoutProb: expected ? String(expected.stockoutProb) : null,
						expectedUnitsSold: expected ? String(expected.unitsSold) : null,
						committedByUserId: session.claims.sub,
						committedAt: nowMs,
						notes: body.notes ?? null,
					},
				});
		} catch (e) {
			await writeAudit(env, {
				tenantId,
				actorUserId: session.claims.sub,
				action: "bake_plan.commit_failed",
				target: body.branchId,
				metadata: {
					family: body.family,
					date: body.date,
					optionKind: body.optionKind,
					reason: e instanceof Error ? e.message : String(e),
				},
			});
			throw e;
		}

		// Re-read to return the canonical row id (the upsert may have hit an
		// existing row, in which case `id` from newId() above isn't what got
		// written — we want to return the persistent id).
		const persisted = await db
			.select({ id: bakePlanDecisions.id })
			.from(bakePlanDecisions)
			.where(and(
				eq(bakePlanDecisions.tenantId, tenantId),
				eq(bakePlanDecisions.branchId, body.branchId),
				eq(bakePlanDecisions.family, body.family),
				eq(bakePlanDecisions.date, body.date),
			))
			.get();
		const decisionId = persisted?.id ?? id;

		await writeAudit(env, {
			tenantId,
			actorUserId: session.claims.sub,
			action: "bake_plan.committed",
			target: decisionId,
			metadata: {
				branchId: body.branchId,
				family: body.family,
				date: body.date,
				optionKind: body.optionKind,
				bakeQuantity: body.bakeQuantity,
				forecastSnapshotId: snapshotId,
				modelVersionId,
			},
		});

		return Response.json({ id: decisionId, optionKind: body.optionKind, bakeQuantity: body.bakeQuantity });
	} catch (e) {
		return errorResponse(e);
	}
}
