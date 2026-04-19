"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

type MemberRole = "tenant_admin" | "branch_manager" | "staff" | "viewer";

interface InviteResult {
	userId: string;
	email: string;
	tempPassword: string | null;
}

const ROLE_OPTIONS: MemberRole[] = ["tenant_admin", "branch_manager", "staff", "viewer"];

export function InviteDialog() {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<MemberRole>("staff");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<InviteResult | null>(null);

	function handleOpen() {
		setOpen(true);
		setEmail("");
		setRole("staff");
		setError(null);
		setResult(null);
	}

	function handleClose() {
		setOpen(false);
		setResult(null);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const res = await apiFetch("/api/users", {
				method: "POST",
				body: JSON.stringify({ email: email.trim(), role }),
			});
			if (!res.ok) {
				const text = await res.text();
				const parsed = JSON.parse(text) as { error?: string };
				throw new ApiError(res.status, parsed.error ?? text);
			}
			const data = (await res.json()) as InviteResult;
			setResult(data);
		} catch (e) {
			if (e instanceof ApiError) {
				setError(`Error ${e.status}: ${e.body}`);
			} else {
				setError(e instanceof Error ? e.message : "Failed to invite user");
			}
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<button
				onClick={handleOpen}
				className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
			>
				Invite member
			</button>

			{open && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
					onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
				>
					<div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-white p-6 shadow-xl">
						<h2 className="mb-4 text-lg font-semibold">Invite member</h2>

						{result ? (
							<div className="space-y-4">
								<p className="text-sm text-[var(--ink)]">
									<span className="font-medium">{result.email}</span> has been added.
								</p>
								{result.tempPassword && (
									<div className="rounded border border-amber-200 bg-amber-50 p-3">
										<p className="text-xs font-medium text-amber-800 mb-1">Temporary password (shown once):</p>
										<code className="text-sm font-mono text-amber-900 break-all">{result.tempPassword}</code>
										<p className="text-xs text-amber-700 mt-1">Share this securely. The user can change it after signing in.</p>
									</div>
								)}
								<div className="flex justify-end">
									<button
										onClick={handleClose}
										className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
									>
										Done
									</button>
								</div>
							</div>
						) : (
							<form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
								<div>
									<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
										Email address
									</label>
									<input
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										required
										placeholder="user@example.com"
										className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
									/>
								</div>
								<div>
									<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Role</label>
									<select
										value={role}
										onChange={(e) => setRole(e.target.value as MemberRole)}
										className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
									>
										{ROLE_OPTIONS.map((r) => (
											<option key={r} value={r}>
												{r}
											</option>
										))}
									</select>
								</div>

								{error && <p className="text-sm text-red-600">{error}</p>}

								<div className="flex justify-end gap-2">
									<button
										type="button"
										onClick={handleClose}
										className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-raised)]"
									>
										Cancel
									</button>
									<button
										type="submit"
										disabled={submitting}
										className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
									>
										{submitting ? "Inviting…" : "Invite"}
									</button>
								</div>
							</form>
						)}
					</div>
				</div>
			)}
		</>
	);
}
