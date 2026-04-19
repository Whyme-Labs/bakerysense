"use client";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface Connector { id: string; label: string; preset: string; model: string }
interface ConnectorList { connectors: Connector[] }

export function StatusBadge() {
  const [active, setActive] = useState<Connector | null>(null);
  useEffect(() => {
    apiJson<ConnectorList>("/api/connector").then((r) => setActive(r.connectors[0] ?? null)).catch(() => {});
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--ink-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-good)]" />
      {active ? `${active.preset} · ${active.model}` : "no connector"}
    </span>
  );
}
