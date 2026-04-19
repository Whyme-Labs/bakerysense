"use client";

import { useState, useEffect, useCallback } from "react";
import { apiJson, apiFetch, ApiError } from "@/lib/api-client";
import { ConnectorTest } from "@/components/admin/ConnectorTest";
import type { PresetId } from "@/lib/connector-presets";

interface ConnectorRow {
	id: string;
	label: string;
	preset: PresetId;
	baseUrl: string;
	model: string;
	authMethod: "api_key" | "oauth" | "none";
	credentialLast4?: string;
	createdAt: number;
}

interface ListResponse {
	connectors: ConnectorRow[];
	defaultId: string | null;
}

export function ConnectorList() {
	const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
	const [defaultId, setDefaultId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<Set<string>>(new Set());

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiJson<ListResponse>("/api/connector");
			setConnectors(data.connectors);
			setDefaultId(data.defaultId);
		} catch (e) {
			setError(e instanceof ApiError ? `Error ${e.status}` : "Failed to load connectors");
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

	async function handleSetDefault(id: string) {
		setBusyFor(id, true);
		try {
			const res = await apiFetch(`/api/connector/${id}/default`, { method: "POST" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setDefaultId(id);
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to set default");
		} finally {
			setBusyFor(id, false);
		}
	}

	async function handleDelete(id: string, label: string) {
		if (!confirm(`Delete connector "${label}"?`)) return;
		setBusyFor(id, true);
		try {
			const res = await apiFetch(`/api/connector/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setConnectors((prev) => prev.filter((c) => c.id !== id));
			if (defaultId === id) setDefaultId(null);
		} catch (e) {
			alert(e instanceof Error ? e.message : "Failed to delete connector");
		} finally {
			setBusyFor(id, false);
		}
	}

	if (loading) {
		return <p className="text-sm text-[var(--ink-muted)]">Loading connectors…</p>;
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

	if (connectors.length === 0) {
		return (
			<p className="text-sm text-[var(--ink-muted)]">No connectors yet. Add one above.</p>
		);
	}

	return (
		<div className="space-y-3">
			{connectors.map((c) => {
				const isDefault = c.id === defaultId;
				const isBusy = busy.has(c.id);
				return (
					<div
						key={c.id}
						className="flex items-start justify-between rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]"
					>
						<div className="space-y-0.5">
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">{c.label}</span>
								{isDefault && (
									<span className="rounded-full bg-[var(--accent-info)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
										default
									</span>
								)}
							</div>
							<p className="text-xs text-[var(--ink-muted)]">
								{c.preset} · {c.model}
							</p>
							<p className="text-xs text-[var(--ink-subtle)] truncate max-w-sm">{c.baseUrl}</p>
							{c.credentialLast4 && (
								<p className="text-xs text-[var(--ink-subtle)]">Key: …{c.credentialLast4}</p>
							)}
						</div>
						<div className="flex items-center gap-2 ml-4 flex-shrink-0">
							{!isDefault && (
								<button
									onClick={() => void handleSetDefault(c.id)}
									disabled={isBusy}
									className="rounded px-2 py-1 text-xs font-medium border border-[var(--border)] bg-white hover:bg-[var(--surface-raised)] disabled:opacity-50"
								>
									Set default
								</button>
							)}
							<ConnectorTest
								connectorId={c.id}
								onResult={(_ok, _detail) => {
									// result is shown inline by ConnectorTest
								}}
							/>
							<button
								onClick={() => void handleDelete(c.id, c.label)}
								disabled={isBusy}
								className="rounded px-2 py-1 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
							>
								Delete
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
