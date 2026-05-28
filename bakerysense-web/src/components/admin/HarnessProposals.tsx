"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export interface EditVM {
	label: string; // e.g. "banana_cake on Wed"
	from: number | null; // current multiplier, if known
	to: number; // proposed multiplier
}

export interface ProposalVM {
	id: string;
	branchId: string | null;
	branchName: string;
	skillId: string;
	summary: string;
	beforeWape: number | null;
	afterWape: number | null;
	edits: EditVM[];
	createdAt: number;
}

export interface BranchOption {
	id: string;
	name: string;
}

function pct(n: number | null): string {
	return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export function HarnessProposals({
	proposals,
	branchOptions,
}: {
	proposals: ProposalVM[];
	branchOptions: BranchOption[];
}) {
	const router = useRouter();
	const [busyId, setBusyId] = useState<string | null>(null);
	const [inspectBranch, setInspectBranch] = useState(branchOptions[0]?.id ?? "");
	const [inspecting, setInspecting] = useState(false);
	const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

	async function act(id: string, action: "approve" | "reject") {
		setBusyId(id);
		setMessage(null);
		try {
			const res = await apiFetch(`/api/harness/proposals/${id}/${action}`, { method: "POST" });
			if (res.ok) {
				setMessage({ text: `Proposal ${action === "approve" ? "approved — rules updated" : "rejected"}.`, error: false });
				router.refresh();
			} else {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				setMessage({ text: body.error ?? `Error ${res.status}`, error: true });
			}
		} catch (e) {
			setMessage({ text: e instanceof Error ? e.message : "Request failed", error: true });
		} finally {
			setBusyId(null);
		}
	}

	async function runInspect() {
		if (!inspectBranch) return;
		setInspecting(true);
		setMessage(null);
		try {
			const res = await apiFetch("/api/harness/inspect", {
				method: "POST",
				body: JSON.stringify({ branchId: inspectBranch }),
			});
			const body = (await res.json().catch(() => ({}))) as { status?: string; editCount?: number; error?: string };
			if (res.ok) {
				const detail =
					body.status === "proposed" ? `proposed ${body.editCount} edit(s)`
					: body.status === "rejected_validation" ? "edit failed holdout validation"
					: body.status === "no_evidence" ? "no learnable misses found"
					: body.status === "no_proposal" ? "no systematic bias worth correcting"
					: body.status ?? "done";
				setMessage({ text: `Inspection complete: ${detail}.`, error: false });
				router.refresh();
			} else {
				setMessage({ text: body.error ?? `Error ${res.status}`, error: true });
			}
		} catch (e) {
			setMessage({ text: e instanceof Error ? e.message : "Request failed", error: true });
		} finally {
			setInspecting(false);
		}
	}

	return (
		<div>
			<section className="mb-6 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
				<div className="flex flex-wrap items-end gap-3">
					<div>
						<label className="block text-xs font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Run inspection</label>
						<p className="mt-1 text-xs text-[var(--ink-muted)]">Replay this branch&apos;s recent traces, diagnose misses, and propose a validated correction.</p>
					</div>
					<select
						value={inspectBranch}
						onChange={(e) => setInspectBranch(e.target.value)}
						className="rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
					>
						{branchOptions.map((b) => (
							<option key={b.id} value={b.id}>{b.name}</option>
						))}
					</select>
					<button
						onClick={() => void runInspect()}
						disabled={inspecting || !inspectBranch}
						data-testid="harness-inspect-button"
						className="rounded border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-raised)] disabled:opacity-50"
					>
						{inspecting ? "Inspecting…" : "Run inspection"}
					</button>
				</div>
				{message && (
					<p className={`mt-3 text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
				)}
			</section>

			{proposals.length === 0 ? (
				<p className="text-sm text-[var(--ink-muted)]">No pending proposals. Run an inspection to surface learned corrections.</p>
			) : (
				<ul className="space-y-4">
					{proposals.map((p) => (
						<li key={p.id} data-testid="harness-proposal" className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-sm)]">
							<div className="mb-2 flex items-center justify-between">
								<div className="text-sm font-medium">
									{p.skillId} · {p.branchName}
								</div>
								<div className="text-xs text-[var(--ink-muted)]">
									WAPE {pct(p.beforeWape)} → <span className="font-medium text-green-700">{pct(p.afterWape)}</span>
								</div>
							</div>
							<p className="mb-3 text-sm text-[var(--ink-subtle)]">{p.summary}</p>
							<div className="mb-4 space-y-1">
								{p.edits.map((e, i) => (
									<div key={i} className="font-mono text-xs text-[var(--ink-subtle)]">
										{e.label}: <span className="text-[var(--ink-muted)]">{e.from ?? 1.0}</span> → <span className="font-medium">{e.to}</span>
									</div>
								))}
							</div>
							<div className="flex gap-2">
								<button
									onClick={() => void act(p.id, "approve")}
									disabled={busyId === p.id}
									data-testid="harness-approve"
									className="rounded bg-[var(--accent,#1a7f5a)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
								>
									{busyId === p.id ? "…" : "Approve"}
								</button>
								<button
									onClick={() => void act(p.id, "reject")}
									disabled={busyId === p.id}
									data-testid="harness-reject"
									className="rounded border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-raised)] disabled:opacity-50"
								>
									Reject
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
