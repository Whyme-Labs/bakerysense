"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Props {
	connectorId: string;
	onResult: (ok: boolean, detail?: string) => void;
}

type TestState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ok"; latency_ms: number }
	| { status: "error"; detail: string };

export function ConnectorTest({ connectorId, onResult }: Props) {
	const [state, setState] = useState<TestState>({ status: "idle" });

	async function handleTest() {
		setState({ status: "loading" });
		try {
			const res = await apiFetch(`/api/connector/${connectorId}/test`, { method: "POST" });
			const data = (await res.json()) as { ok: boolean; latency_ms?: number; status?: number; error?: string };
			if (data.ok) {
				setState({ status: "ok", latency_ms: data.latency_ms ?? 0 });
				onResult(true, `${data.latency_ms ?? 0}ms`);
			} else {
				const detail = data.error ?? `HTTP ${data.status ?? "error"}`;
				setState({ status: "error", detail });
				onResult(false, detail);
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : "network error";
			setState({ status: "error", detail });
			onResult(false, detail);
		}
	}

	return (
		<span className="inline-flex items-center gap-2">
			<button
				onClick={handleTest}
				disabled={state.status === "loading"}
				className="rounded px-2 py-1 text-xs font-medium border border-[var(--border)] bg-white hover:bg-[var(--surface-raised)] disabled:opacity-50"
			>
				{state.status === "loading" ? "Testing…" : "Test"}
			</button>
			{state.status === "ok" && (
				<span className="text-xs text-green-600">OK · {state.latency_ms}ms</span>
			)}
			{state.status === "error" && (
				<span className="text-xs text-red-600">{state.detail}</span>
			)}
		</span>
	);
}
