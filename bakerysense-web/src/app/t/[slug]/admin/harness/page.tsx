import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { HarnessProposals, type ProposalVM, type EditVM, type BranchOption } from "@/components/admin/HarnessProposals";
import { listPendingProposals } from "@/lib/evolution-proposals";

export const runtime = "nodejs";

interface RawEdit {
	op: string;
	path: string;
	value?: { multiplier?: number };
}

// Turn an edit path like
//   /post_forecast_adjustments/sku_adjustments/banana_cake|Wed
// into a human label "banana_cake on Wed".
function labelForPath(path: string): string {
	const tokens = path.split("/").filter(Boolean).map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
	const leaf = tokens[tokens.length - 1] ?? path;
	const sep = leaf.indexOf("|");
	if (sep >= 0) {
		const sku = leaf.slice(0, sep);
		const dow = leaf.slice(sep + 1);
		return dow === "*" ? `${sku} (all days)` : `${sku} on ${dow}`;
	}
	return leaf;
}

export default async function HarnessAdminPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const { env } = getCloudflareContext();
	const h = await headers();
	const req = new Request("http://localhost/internal", { headers: h });
	const session = await resolveSession(env, req);
	if (!session) redirect("/signin");
	if (session.claims.role !== "tenant_admin" && session.claims.role !== "branch_manager" && session.claims.role !== "platform_admin") {
		redirect(`/t/${slug}/dashboard`);
	}
	const tid = session.claims.tid;

	const [pending, branchRows] = await Promise.all([
		listPendingProposals(env, tid),
		getDb(env).select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tid)).all(),
	]);

	const branchName = new Map(branchRows.map((b) => [b.id, b.name]));
	const branchOptions: BranchOption[] = branchRows.map((b) => ({ id: b.id, name: b.name }));

	const proposals: ProposalVM[] = pending.map((p) => {
		let edits: EditVM[] = [];
		try {
			const raw = JSON.parse(p.editOpsJson) as RawEdit[];
			edits = raw.map((e) => ({ label: labelForPath(e.path), from: null, to: e.value?.multiplier ?? NaN }));
		} catch { /* malformed — show none */ }
		let beforeWape: number | null = null;
		let afterWape: number | null = null;
		try {
			const m = JSON.parse(p.validationMetricsJson ?? "{}") as { beforeWape?: number; afterWape?: number };
			beforeWape = m.beforeWape ?? null;
			afterWape = m.afterWape ?? null;
		} catch { /* ignore */ }
		return {
			id: p.id,
			branchId: p.branchId,
			branchName: p.branchId ? (branchName.get(p.branchId) ?? p.branchId) : "Brand (all branches)",
			skillId: p.skillId,
			summary: p.diagnosisSummary,
			beforeWape,
			afterWape,
			edits,
			createdAt: p.createdAt,
		};
	});

	return (
		<>
			<TenantHeader slug={slug} />
			<h1 className="mb-2 text-2xl font-semibold">Harness evolution</h1>
			<p className="mb-6 max-w-2xl text-sm text-[var(--ink-muted)]">
				Corrections the harness has learned from this tenant&apos;s own sales, each validated on a
				held-out window. Approving an item activates a new skill version; the next forecast applies it.
			</p>
			<HarnessProposals proposals={proposals} branchOptions={branchOptions} />
		</>
	);
}
