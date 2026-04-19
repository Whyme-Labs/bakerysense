"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function PasswordChange() {
	const router = useRouter();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmNewPassword, setConfirmNewPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);

		if (newPassword !== confirmNewPassword) {
			setError("New passwords do not match.");
			return;
		}

		setSubmitting(true);
		try {
			const res = await apiFetch("/api/auth/password-change", {
				method: "POST",
				body: JSON.stringify({ currentPassword, newPassword }),
			});

			if (res.status === 403) {
				const body = await res.json() as { error?: string };
				setError(body.error === "current password is incorrect"
					? "Current password is incorrect."
					: "Access denied.");
				return;
			}

			if (!res.ok) {
				const text = await res.text();
				setError(`Error: ${text.slice(0, 200)}`);
				return;
			}

			setSuccess(true);

			// Sign out and redirect after a brief moment so user sees the message
			setTimeout(async () => {
				await apiFetch("/api/auth/signout", { method: "POST" });
				router.push("/signin");
			}, 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An unexpected error occurred.");
		} finally {
			setSubmitting(false);
		}
	}

	if (success) {
		return (
			<p className="text-sm text-green-600">
				Password updated — you will be signed out shortly.
			</p>
		);
	}

	return (
		<form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-md">
			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					Current password
				</label>
				<input
					type="password"
					value={currentPassword}
					onChange={(e) => setCurrentPassword(e.target.value)}
					required
					autoComplete="current-password"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					New password
				</label>
				<input
					type="password"
					value={newPassword}
					onChange={(e) => setNewPassword(e.target.value)}
					required
					minLength={8}
					autoComplete="new-password"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					Confirm new password
				</label>
				<input
					type="password"
					value={confirmNewPassword}
					onChange={(e) => setConfirmNewPassword(e.target.value)}
					required
					minLength={8}
					autoComplete="new-password"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			{error && (
				<p className="text-sm text-red-600">{error}</p>
			)}

			<div className="flex justify-end">
				<button
					type="submit"
					disabled={submitting}
					className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
				>
					{submitting ? "Updating…" : "Change password"}
				</button>
			</div>
		</form>
	);
}
