"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface Connector { id: string; label: string; preset: string; model: string }
interface ConnectorList { connectors: Connector[] }

type State =
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; connector: Connector };

export function StatusBadge() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    apiJson<ConnectorList>("/api/connector")
      .then((r) => {
        const c = r.connectors[0];
        setState(c ? { status: "ready", connector: c } : { status: "none" });
      })
      .catch(() => setState({ status: "none" }));
  }, []);

  // While loading, render an invisible placeholder that reserves layout space
  // — avoids the "no connector" flash that appeared in the demo video while
  // /api/connector was in flight.
  if (state.status === "loading") {
    return (
      <span
        aria-hidden
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-transparent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--border)]" />
        loading connector
      </span>
    );
  }

  const dotColor = state.status === "ready" ? "var(--accent-good)" : "var(--accent-warn)";
  const label = state.status === "ready"
    ? `${state.connector.preset} · ${state.connector.model}`
    : "no connector";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--ink-muted)]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
      {label}
    </span>
  );
}
