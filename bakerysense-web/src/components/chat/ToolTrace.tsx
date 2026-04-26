"use client";
import { useState } from "react";
import { friendlyLabel } from "@/lib/feature-registry";

interface Props {
  name: string;
  args: unknown;
  result: unknown;
}

function hasKeys<K extends string>(v: unknown, ...keys: K[]): v is Record<K, unknown> {
  return typeof v === "object" && v !== null && keys.every((k) => k in (v as object));
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function Chip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-subtle,#9ca3af)]">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-[var(--ink,#111827)]">{value}</div>
    </div>
  );
}

function friendlyTitle(name: string, args: unknown): string {
  if (name === "forecast_point" && hasKeys(args, "sku", "on_date")) {
    return `Forecast: ${str(args.sku) ?? ""} on ${str(args.on_date) ?? ""}`;
  }
  if (name === "explain_drivers" && hasKeys(args, "sku")) {
    return `Explain: why this quantity for ${str(args.sku) ?? ""}`;
  }
  if (name === "close_out_day" && hasKeys(args, "on_date")) {
    return `Close out day ${str(args.on_date) ?? ""}`;
  }
  return name;
}

function ForecastBody({ result }: { result: unknown }) {
  if (!hasKeys(result, "bake_quantity", "quantiles")) return null;
  const bake = num(result.bake_quantity);
  const q = result.quantiles as Record<string, unknown>;
  const p10 = num(q["q0.1"]);
  const p50 = num(q["q0.5"]);
  const p90 = num(q["q0.9"]);
  if (bake === null || p10 === null || p50 === null || p90 === null) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Chip label="Bake" value={bake.toFixed(0)} />
      <Chip label="Median (p50)" value={p50.toFixed(0)} />
      <Chip label="Low (p10)" value={p10.toFixed(0)} />
      <Chip label="High (p90)" value={p90.toFixed(0)} />
    </div>
  );
}

function DriversBody({ result }: { result: unknown }) {
  if (!hasKeys(result, "drivers")) return null;
  const drivers = result.drivers;
  if (!Array.isArray(drivers) || drivers.length === 0) return null;
  const maxAbs = Math.max(
    ...drivers.map((d) => Math.abs(num((d as { contribution?: unknown }).contribution) ?? 0)),
    0.001,
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
        <span>Pulls down</span>
        <span>Pulls up</span>
      </div>
      <ul className="space-y-1.5">
        {drivers.map((d, i) => {
          const feature = str((d as { feature?: unknown }).feature) ?? "feature";
          const contribution = num((d as { contribution?: unknown }).contribution) ?? 0;
          const pct = (Math.abs(contribution) / maxAbs) * 50;
          const isPos = contribution >= 0;
          const negligible = Math.abs(contribution) < 0.01;
          return (
            <li key={i} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-xs">
              <span className="truncate text-[var(--ink)]" title={feature}>{friendlyLabel(feature)}</span>
              <div className="relative h-2.5 rounded bg-white">
                <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
                {!negligible && (
                  <div
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      left: isPos ? "50%" : `${50 - Math.max(2, pct)}%`,
                    }}
                    className={`absolute inset-y-0 rounded ${isPos ? "bg-[var(--accent-good,oklch(0.72_0.13_155))]" : "bg-[var(--accent-warn,oklch(0.76_0.14_70))]"}`}
                  />
                )}
              </div>
              <span className={`text-right font-mono tabular-nums ${negligible ? "text-[var(--ink-subtle)]" : "text-[var(--ink)]"}`}>
                {contribution > 0 ? "+" : contribution < 0 ? "−" : ""}{Math.abs(contribution).toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FriendlyBody({ name, result }: { name: string; result: unknown }) {
  if (name === "forecast_point") return <ForecastBody result={result} />;
  if (name === "explain_drivers") return <DriversBody result={result} />;
  return null;
}

export function ToolTrace({ name, args, result }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const friendly = <FriendlyBody name={name} result={result} />;
  const hasFriendly = friendly !== null && (name === "forecast_point" || name === "explain_drivers");
  return (
    <div className="rounded-lg border border-[var(--border,#e5e7eb)] bg-[var(--surface-muted,#f9fafb)] text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-medium text-[var(--ink,#111827)]">
          <span className="mr-1 text-[var(--ink-subtle,#9ca3af)]">→</span>
          {friendlyTitle(name, args)}
        </span>
        {hasFriendly && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="rounded border border-[var(--border)] bg-white px-2 py-0.5 text-[10px] font-mono text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            {showRaw ? "hide raw" : "show raw"}
          </button>
        )}
      </div>
      {hasFriendly && (
        <div className="border-t border-[var(--border,#e5e7eb)] px-3 py-3">{friendly}</div>
      )}
      {(showRaw || !hasFriendly) && (
        <div className="space-y-2 border-t border-[var(--border,#e5e7eb)] px-3 py-2">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-subtle,#9ca3af)]">Arguments</p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[var(--ink,#111827)]">{JSON.stringify(args, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-subtle,#9ca3af)]">Result</p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[var(--ink,#111827)]">{JSON.stringify(result, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
