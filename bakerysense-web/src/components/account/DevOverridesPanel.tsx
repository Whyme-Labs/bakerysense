"use client";

import { useState, useEffect } from "react";

const KEY_BYOK_KEY = "bs_byok_key";
const KEY_BYOK_BASEURL = "bs_byok_baseurl";
const KEY_BYOK_MODEL = "bs_byok_model";

export function DevOverridesPanel() {
	const [byokKey, setByokKey] = useState("");
	const [byokBaseUrl, setByokBaseUrl] = useState("");
	const [byokModel, setByokModel] = useState("");
	const [saved, setSaved] = useState(false);

	// On mount, read current values from localStorage
	useEffect(() => {
		setByokKey(localStorage.getItem(KEY_BYOK_KEY) ?? "");
		setByokBaseUrl(localStorage.getItem(KEY_BYOK_BASEURL) ?? "");
		setByokModel(localStorage.getItem(KEY_BYOK_MODEL) ?? "");
	}, []);

	function handleSave() {
		if (byokKey) localStorage.setItem(KEY_BYOK_KEY, byokKey);
		else localStorage.removeItem(KEY_BYOK_KEY);

		if (byokBaseUrl) localStorage.setItem(KEY_BYOK_BASEURL, byokBaseUrl);
		else localStorage.removeItem(KEY_BYOK_BASEURL);

		if (byokModel) localStorage.setItem(KEY_BYOK_MODEL, byokModel);
		else localStorage.removeItem(KEY_BYOK_MODEL);

		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	function handleClear() {
		localStorage.removeItem(KEY_BYOK_KEY);
		localStorage.removeItem(KEY_BYOK_BASEURL);
		localStorage.removeItem(KEY_BYOK_MODEL);
		setByokKey("");
		setByokBaseUrl("");
		setByokModel("");
		setSaved(false);
	}

	return (
		<div className="space-y-4 max-w-md">
			<p className="text-xs text-[var(--ink-muted)] bg-amber-50 border border-amber-200 rounded px-3 py-2">
				<strong>Dev-only.</strong> These headers are attached to every API request and override the
				tenant&apos;s connector for YOUR session only. Leave blank to use tenant defaults.
				Backend adoption of these headers is future work (spec §14+).
			</p>

			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					API Key (<code>X-BYO-Key</code>)
				</label>
				<input
					type="password"
					value={byokKey}
					onChange={(e) => setByokKey(e.target.value)}
					placeholder="sk-…"
					autoComplete="off"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					Base URL (<code>X-BYO-BaseURL</code>)
				</label>
				<input
					type="text"
					value={byokBaseUrl}
					onChange={(e) => setByokBaseUrl(e.target.value)}
					placeholder="https://api.openai.com/v1"
					autoComplete="off"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			<div>
				<label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1">
					Model (<code>X-BYO-Model</code>)
				</label>
				<input
					type="text"
					value={byokModel}
					onChange={(e) => setByokModel(e.target.value)}
					placeholder="gpt-4o"
					autoComplete="off"
					className="w-full rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
				/>
			</div>

			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleSave}
					className="rounded bg-[var(--accent-info)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
				>
					{saved ? "Saved!" : "Save"}
				</button>
				<button
					type="button"
					onClick={handleClear}
					className="rounded border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-[var(--surface-raised)]"
				>
					Clear
				</button>
			</div>
		</div>
	);
}
