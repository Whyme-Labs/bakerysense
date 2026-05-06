// GET /api/forecast/plans?branch=<branchId>&date=<YYYY-MM-DD>
//
// Returns three bake-quantity options (conservative / balanced / aggressive)
// per SKU for the given branch and date. Reuses the forecast tool-dispatch
// pipeline and runs generatePlanOptions per SKU row.
//
// Cost ratio defaults to { cu: 1, co: 1 } (equal underage / overage cost,
// newsvendor target = q0.5) when no tenant config overrides it. Wire in a
// per-tenant config reader here when that feature lands.

import { eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, NotFound, BadRequest, errorResponse } from "@/lib/errors";
import { assertBranchAccess } from "@/lib/rbac";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { dispatch } from "@/lib/tools";
import type { ToolContext } from "@/lib/tools";
import { generatePlanOptions } from "@/lib/plan-options";
import type { Quantiles } from "@/lib/simulation";

export const runtime = "nodejs";

// Default cost ratio — intentional fallback when tenant config is absent.
// cu = underage (stockout) cost; co = overage (waste) cost.
const DEFAULT_COST = { cu: 1, co: 1 } as const;

// Convert the forecast tool's string-keyed quantiles ("q0.5" or bare "0.5")
// to the numeric-keyed Record<number, number> that generatePlanOptions expects.
function parseQuantiles(raw: Record<string, number>): Quantiles {
	const result: Quantiles = {};
	for (const [k, v] of Object.entries(raw)) {
		const stripped = k.startsWith("q") ? k.slice(1) : k;
		const prob = parseFloat(stripped);
		if (Number.isFinite(prob) && prob > 0 && prob < 1) result[prob] = v;
	}
	return result;
}

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();

		const url = new URL(req.url);
		const branchId = url.searchParams.get("branch");
		const date = url.searchParams.get("date");
		if (!branchId || !date) throw new BadRequest("branch and date are required");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequest("date must be YYYY-MM-DD");

		// Verify branch belongs to the caller's tenant. 404 (not 403) to avoid
		// leaking branch existence across tenants — matches assertBranchAccess pattern.
		const db = getDb(env);
		const branch = await db
			.select({ id: branches.id, tenantId: branches.tenantId })
			.from(branches)
			.where(eq(branches.id, branchId))
			.get();
		if (!branch || branch.tenantId !== session.claims.tid) throw new NotFound("branch not found");
		// Enforce per-user branch access for staff / branch_manager roles.
		assertBranchAccess(session.claims, branchId);

		const ctx: ToolContext = {
			env,
			tenantId: session.claims.tid,
			userId: session.claims.sub,
			permittedBranches: session.claims.branches,
			defaultBranchId: branchId,
			costRatio: DEFAULT_COST,
			quantiles: [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9],
		};

		const skusRes = await dispatch("list_skus", { branch_id: branchId }, ctx) as { skus?: string[] };
		const skus = skusRes.skus ?? [];
		if (skus.length === 0) throw new NotFound("no forecast data found for this branch");

		const results = await Promise.all(
			skus.map(async (sku) => {
				const r = await dispatch("forecast", { sku, on_date: date, branch_id: branchId }, ctx) as {
					quantiles?: Record<string, number>;
					forecastSnapshotId?: string;
				};
				if (!r.quantiles) return null;
				const numericQ = parseQuantiles(r.quantiles);
				if (Object.keys(numericQ).length < 2) return null;
				return {
					family: sku,
					options: generatePlanOptions(numericQ, DEFAULT_COST),
					// Returned so the frontend can pass it back to POST /api/bake-plans/commit
					// for full lineage linkage (forecastSnapshotId → modelVersionId).
					forecastSnapshotId: r.forecastSnapshotId ?? null,
				};
			})
		);

		const plans = results.filter(<T>(x: T | null): x is T => x !== null);
		return Response.json({ branch: branchId, date, plans });
	} catch (e) {
		return errorResponse(e);
	}
}
