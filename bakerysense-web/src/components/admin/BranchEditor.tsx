"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Props {
	onCreated?: () => void;
}

export function BranchEditor({ onCreated }: Props) {
	const [name, setName] = useState("");
	const [city, setCity] = useState("");
	const [cluster, setCluster] = useState("");
	const [type, setType] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		setSuccess(false);

		try {
			const body: Record<string, string> = { name: name.trim() };
			if (city.trim()) body.city = city.trim();
			if (cluster.trim()) body.cluster = cluster.trim();
			if (type.trim()) body.type = type.trim();

			const res = await apiFetch("/api/branches", {
				method: "POST",
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
			}

			setName("");
			setCity("");
			setCluster("");
			setType("");
			setSuccess(true);
			onCreated?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to create branch");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
						Name <span className="text-red-500">*</span>
					</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						maxLength={80}
						placeholder="Main Street"
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">City</label>
					<input
						type="text"
						value={city}
						onChange={(e) => setCity(e.target.value)}
						maxLength={80}
						placeholder="Singapore"
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Cluster</label>
					<input
						type="text"
						value={cluster}
						onChange={(e) => setCluster(e.target.value)}
						maxLength={40}
						placeholder="Central"
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Type</label>
					<input
						type="text"
						value={type}
						onChange={(e) => setType(e.target.value)}
						maxLength={40}
						placeholder="flagship"
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
			</div>

			{error && <p className="text-sm text-red-600">{error}</p>}
			{success && <p className="text-sm text-green-600">Branch created successfully.</p>}

			<div className="flex justify-end">
				<button
					type="submit"
					disabled={submitting || !name.trim()}
					className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
				>
					{submitting ? "Creating…" : "Add branch"}
				</button>
			</div>
		</form>
	);
}
