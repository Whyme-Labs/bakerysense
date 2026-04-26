import { friendlyLabel } from "@/lib/feature-registry";

interface Props {
  predictor: string;
  quantileHeads: string[];
  features: string[];
  trainedAt: number | null;
  rollingWape: number | null;
  rollingMae: number | null;
  version: number | null;
  trainingRows: number;
  trainingFamilies: number;
  trainingBranches: number;
  trainingDateRange: { start: string; end: string } | null;
}

function formatTime(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function ModelInfoPanel(p: Props) {
  return (
    <section
      data-testid="model-info-panel"
      className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
          Predictor
        </h2>
        {p.version != null && (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)]">
            v{p.version}
          </span>
        )}
      </div>

      <div className="mb-5">
        <div className="text-lg font-semibold text-[var(--ink)]">{p.predictor}</div>
        <div className="mt-1 text-xs text-[var(--ink-muted)]">
          Trained offline, exported as JSON, walked in pure TypeScript inside the Worker — no Python at request time.
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Quantile heads"
          value={String(p.quantileHeads.length)}
          sub={p.quantileHeads.length > 0 ? p.quantileHeads.map((q) => `p${Math.round(parseFloat(q) * 100)}`).join(" · ") : "—"}
        />
        <Stat
          label="Last trained"
          value={formatTime(p.trainedAt)}
          sub={p.rollingWape != null ? `Rolling WAPE ${(p.rollingWape * 100).toFixed(1)}%` : p.rollingMae != null ? `Rolling MAE ${p.rollingMae.toFixed(2)}` : "—"}
        />
        <Stat
          label="Training data"
          value={`${p.trainingRows.toLocaleString()} rows`}
          sub={`${p.trainingFamilies} SKUs · ${p.trainingBranches} branches`}
        />
        <Stat
          label="Date range"
          value={p.trainingDateRange ? `${p.trainingDateRange.start} → ${p.trainingDateRange.end}` : "—"}
          sub={p.trainingDateRange ? "earliest to latest actual" : "no actuals captured"}
        />
      </div>

      {p.features.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
            Features ({p.features.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {p.features.map((f) => (
              <span
                key={f}
                title={f}
                className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--ink-muted)]"
              >
                {friendlyLabel(f)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-subtle)]">{label}</div>
      <div className="mt-1 truncate font-semibold tabular-nums text-[var(--ink)]" title={value}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>}
    </div>
  );
}
