"use client";

import { useState, useEffect, useCallback } from "react";
import { apiJson, apiFetch, ApiError } from "@/lib/api-client";

type MemberRole = "tenant_admin" | "branch_manager" | "staff" | "viewer";

interface Member {
	membershipId: string;
	userId: string;
	email: string;
	role: MemberRole;
	createdAt: number;
}

interface MembersResponse {
	members: Member[];
}

const ROLE_OPTIONS: MemberRole[] = ["tenant_admin", "branch_manager", "staff", "viewer"];

export function MemberTable() {
	const [members, setMembers] = useState<Member[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<Set<string>>(new Set());

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiJson<MembersResponse>("/api/users");
			setMembers(data.members);
		} catch (e) {
			setError(e instanceof ApiError ? `Error ${e.status}` : "Failed to load members");
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

	async function handleRoleChange(membershipId: string, role: MemberRole) {
		setBusyFor(membershipId, true);
		try {
			await apiJson(`/api/users/${membershipId}`, {
				method: "PATCH",
				body: JSON.stringify({ role }),
			});
			setMembers((prev) =>
				prev.map((m) => (m.membershipId === membershipId ? { ...m, role } : m)),
			);
		} catch (e) {
			alert(e instanceof ApiError ? `Error ${e.status}: ${e.body}` : "Failed to change role");
		} finally {
			setBusyFor(membershipId, false);
		}
	}

	async function handleRemove(membershipId: string, email: string) {
		if (!confirm(`Remove ${email} from this tenant?`)) return;
		setBusyFor(membershipId, true);
		try {
			const res = await apiFetch(`/api/users/${membershipId}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setMembers((prev) => prev.filter((m) => m.membershipId !== membershipId));
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to remove member");
		} finally {
			setBusyFor(membershipId, false);
		}
	}

	if (loading) {
		return <p className="text-sm text-[var(--ink-muted)]">Loading members…</p>;
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

	if (members.length === 0) {
		return <p className="text-sm text-[var(--ink-muted)]">No members yet.</p>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="min-w-full text-sm">
				<thead>
					<tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--ink-subtle)]">
						<th className="pb-2 pr-4 font-medium">Email</th>
						<th className="pb-2 pr-4 font-medium">Role</th>
						<th className="pb-2 pr-4 font-medium">Joined</th>
						<th className="pb-2 font-medium" />
					</tr>
				</thead>
				<tbody className="divide-y divide-[var(--border)]">
					{members.map((m) => {
						const isBusy = busy.has(m.membershipId);
						return (
							<tr key={m.membershipId}>
								<td className="py-2 pr-4 text-[var(--ink)]">{m.email}</td>
								<td className="py-2 pr-4">
									<select
										value={m.role}
										disabled={isBusy}
										onChange={(e) => void handleRoleChange(m.membershipId, e.target.value as MemberRole)}
										className="rounded border border-[var(--border)] px-2 py-1 text-xs bg-white disabled:opacity-50"
									>
										{ROLE_OPTIONS.map((r) => (
											<option key={r} value={r}>
												{r}
											</option>
										))}
									</select>
								</td>
								<td className="py-2 pr-4 text-[var(--ink-muted)]">
									{new Date(m.createdAt).toLocaleDateString()}
								</td>
								<td className="py-2">
									<button
										onClick={() => void handleRemove(m.membershipId, m.email)}
										disabled={isBusy}
										className="rounded px-2 py-1 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
									>
										Remove
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
