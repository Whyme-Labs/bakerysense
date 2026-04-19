"use client";

import { useState, useEffect, useCallback } from "react";
import { apiJson, apiFetch, ApiError } from "@/lib/api-client";

interface Branch {
	id: string;
	name: string;
	city: string | null;
	cluster: string | null;
	type: string | null;
	createdAt: number;
}

interface BranchesResponse {
	branches: Branch[];
}

interface Props {
	onChanged?: () => void;
}

export function BranchTable({ onChanged }: Props) {
	const [branches, setBranches] = useState<Branch[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<Set<string>>(new Set());
	const [editing, setEditing] = useState<string | null>(null);
	const [editData, setEditData] = useState<{ name: string; city: string; cluster: string; type: string }>({
		name: "",
		city: "",
		cluster: "",
		type: "",
	});

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiJson<BranchesResponse>("/api/branches");
			setBranches(data.branches);
		} catch (e) {
			setError(e instanceof ApiError ? `Error ${e.status}` : "Failed to load branches");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	function setBusyFor(id: string, on: boolean) {
		setBusy((prev) => {
			const next = new Set(prev);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	function startEdit(branch: Branch) {
		setEditing(branch.id);
		setEditData({
			name: branch.name,
			city: branch.city ?? "",
			cluster: branch.cluster ?? "",
			type: branch.type ?? "",
		});
	}

	function cancelEdit() {
		setEditing(null);
	}

	async function handleSave(id: string) {
		setBusyFor(id, true);
		try {
			const body: Record<string, string> = { name: editData.name };
			if (editData.city) body.city = editData.city;
			if (editData.cluster) body.cluster = editData.cluster;
			if (editData.type) body.type = editData.type;

			await apiJson(`/api/branches/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			});
			setBranches((prev) =>
				prev.map((b) =>
					b.id === id
						? {
								...b,
								name: editData.name,
								city: editData.city || null,
								cluster: editData.cluster || null,
								type: editData.type || null,
							}
						: b,
				),
			);
			setEditing(null);
			onChanged?.();
		} catch (e) {
			alert(e instanceof ApiError ? `Error ${e.status}: ${e.body}` : "Failed to save branch");
		} finally {
			setBusyFor(id, false);
		}
	}

	async function handleDelete(id: string, name: string) {
		if (!confirm(`Delete branch "${name}"?`)) return;
		setBusyFor(id, true);
		try {
			const res = await apiFetch(`/api/branches/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setBranches((prev) => prev.filter((b) => b.id !== id));
			onChanged?.();
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to delete branch");
		} finally {
			setBusyFor(id, false);
		}
	}

	if (loading) {
		return <p className="text-sm text-[var(--ink-muted)]">Loading branches…</p>;
	}

	if (error) {
		return (
			<div className="text-sm text-red-600">
				{error}{" "}
				<button onClick={() => void load()} className="underline">
					Retry
				</button>
			</div>
		);
	}

	if (branches.length === 0) {
		return <p className="text-sm text-[var(--ink-muted)]">No branches yet. Add one above.</p>;
	}

	return (
		<div className="space-y-3">
			{branches.map((branch) => {
				const isBusy = busy.has(branch.id);
				const isEditing = editing === branch.id;
				return (
					<div
						key={branch.id}
						className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]"
					>
						{isEditing ? (
							<div className="space-y-3">
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Name</label>
										<input
											type="text"
											value={editData.name}
											onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))}
											maxLength={80}
											required
											className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">City</label>
										<input
											type="text"
											value={editData.city}
											onChange={(e) => setEditData((d) => ({ ...d, city: e.target.value }))}
											maxLength={80}
											className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Cluster</label>
										<input
											type="text"
											value={editData.cluster}
											onChange={(e) => setEditData((d) => ({ ...d, cluster: e.target.value }))}
											maxLength={40}
											className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Type</label>
										<input
											type="text"
											value={editData.type}
											onChange={(e) => setEditData((d) => ({ ...d, type: e.target.value }))}
											maxLength={40}
											className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
										/>
									</div>
								</div>
								<div className="flex gap-2 justify-end">
									<button
										onClick={cancelEdit}
										disabled={isBusy}
										className="rounded border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-raised)] disabled:opacity-50"
									>
										Cancel
									</button>
									<button
										onClick={() => void handleSave(branch.id)}
										disabled={isBusy || !editData.name.trim()}
										className="rounded bg-[var(--accent-info)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
									>
										{isBusy ? "Saving…" : "Save"}
									</button>
								</div>
							</div>
						) : (
							<div className="flex items-start justify-between">
								<div className="space-y-0.5">
									<p className="font-medium text-sm">{branch.name}</p>
									<p className="text-xs text-[var(--ink-muted)]">
										{[branch.city, branch.cluster, branch.type].filter(Boolean).join(" · ") || "No details"}
									</p>
								</div>
								<div className="flex items-center gap-2 ml-4 flex-shrink-0">
									<button
										onClick={() => startEdit(branch)}
										disabled={isBusy}
										className="rounded px-2 py-1 text-xs font-medium border border-[var(--border)] bg-white hover:bg-[var(--surface-raised)] disabled:opacity-50"
									>
										Edit
									</button>
									<button
										onClick={() => void handleDelete(branch.id, branch.name)}
										disabled={isBusy}
										className="rounded px-2 py-1 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
									>
										Delete
									</button>
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
