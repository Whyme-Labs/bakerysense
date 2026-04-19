"use client";

import { useState, useCallback } from "react";
import { PRESETS } from "@/lib/connector-presets";
import type { PresetId } from "@/lib/connector-presets";
import { apiFetch } from "@/lib/api-client";

interface Props {
	tenantSlug: string;
	onCreated?: () => void;
}

const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function ConnectorForm({ tenantSlug: _tenantSlug, onCreated }: Props) {
	const [preset, setPreset] = useState<PresetId>("openrouter");
	const [label, setLabel] = useState("");
	const [model, setModel] = useState("");
	const [baseUrl, setBaseUrl] = useState(PRESETS["openrouter"].defaultBaseUrl);
	const [apiKey, setApiKey] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const selectedPreset = PRESETS[preset];

	const handlePresetChange = useCallback((id: PresetId) => {
		setPreset(id);
		setBaseUrl(PRESETS[id].defaultBaseUrl);
		setModel(PRESETS[id].suggestedModels[0] ?? "");
		setApiKey("");
		setError(null);
		setSuccess(false);
	}, []);

	function authMethod(): "api_key" | "oauth" | "none" {
		if (!selectedPreset.supportsApiKey && !selectedPreset.supportsOAuth) return "none";
		if (selectedPreset.supportsOAuth && !apiKey) return "oauth";
		return "api_key";
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		setSuccess(false);

		try {
			const body = {
				label: label.trim() || selectedPreset.label,
				preset,
				baseUrl,
				model: model || (selectedPreset.suggestedModels[0] ?? ""),
				authMethod: authMethod(),
				...(apiKey ? { credential: apiKey } : {}),
			};

			const res = await apiFetch("/api/connector", {
				method: "POST",
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
			}

			// Reset form
			setLabel("");
			setApiKey("");
			setSuccess(true);
			onCreated?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to create connector");
		} finally {
			setSubmitting(false);
		}
	}

	const needsBaseUrl = !selectedPreset.defaultBaseUrl || preset === "anthropic-via-oai" || preset === "ollama-tunnel" || preset === "custom";

	return (
		<form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
			{/* Preset picker */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Provider preset</label>
					<select
						value={preset}
						onChange={(e) => handlePresetChange(e.target.value as PresetId)}
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					>
						{PRESET_IDS.map((id) => (
							<option key={id} value={id}>
								{PRESETS[id].label}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Label (optional)</label>
					<input
						type="text"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder={selectedPreset.label}
						maxLength={80}
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
			</div>

			{/* Base URL (shown when no default or requires custom URL) */}
			{(needsBaseUrl || preset === "cloudflare-ai") && (
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Base URL</label>
					<input
						type="text"
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						placeholder="https://..."
						required
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
			)}

			{/* Model */}
			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">Model</label>
				<input
					type="text"
					value={model}
					onChange={(e) => setModel(e.target.value)}
					placeholder={selectedPreset.suggestedModels[0] ?? "model-name"}
					list={`model-suggestions-${preset}`}
					required
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
				{selectedPreset.suggestedModels.length > 0 && (
					<datalist id={`model-suggestions-${preset}`}>
						{selectedPreset.suggestedModels.map((m) => (
							<option key={m} value={m} />
						))}
					</datalist>
				)}
			</div>

			{/* Credential / Auth */}
			{preset === "openrouter" ? (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="flex-1">
						<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
							API Key <span className="text-[var(--ink-muted)]">(or connect via OAuth)</span>
						</label>
						<input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="sk-or-…"
							autoComplete="new-password"
							className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
						/>
					</div>
					<button
						type="button"
						onClick={() => { window.location.href = "/api/oauth/openrouter/start"; }}
						className="whitespace-nowrap rounded border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-raised)]"
					>
						Connect via OAuth
					</button>
				</div>
			) : selectedPreset.supportsApiKey ? (
				<div>
					<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">API Key</label>
					<input
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder="sk-…"
						required={selectedPreset.supportsApiKey}
						autoComplete="new-password"
						className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
					/>
				</div>
			) : null}

			{error && (
				<p className="text-sm text-red-600">{error}</p>
			)}
			{success && (
				<p className="text-sm text-green-600">Connector added successfully.</p>
			)}

			<div className="flex justify-end">
				<button
					type="submit"
					disabled={submitting}
					className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
				>
					{submitting ? "Adding…" : "Add connector"}
				</button>
			</div>
		</form>
	);
}
