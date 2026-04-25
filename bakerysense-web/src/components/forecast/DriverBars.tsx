interface Driver {
  feature: string;
  contribution: number;
}

interface Props {
  drivers: Driver[];
}

const FRIENDLY: Record<string, string> = {
  lag_1: "Yesterday's sales",
  lag_7: "Last week, same day",
  lag_14: "Two weeks ago",
  lag_28: "Four weeks ago",
  rolling_mean_7: "Past-week average",
  rolling_mean_28: "Past-month average",
  dow: "Day of week",
  is_weekend: "Weekend",
  is_holiday: "Holiday",
  month: "Month of year",
  promo: "Promotion active",
  price: "Price level",
  family: "SKU family",
};

function friendly(name: string): string {
  if (FRIENDLY[name]) return FRIENDLY[name];
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatContribution(val: number): string {
  if (Math.abs(val) < 0.01) return val >= 0 ? "+0.00" : "−0.00";
  const sign = val > 0 ? "+" : val < 0 ? "−" : "";
  return `${sign}${Math.abs(val).toFixed(2)}`;
}

export function DriverBars({ drivers }: Props) {
  if (drivers.length === 0) {
    return <p className="text-sm text-[var(--ink-subtle)]">No driver data available.</p>;
  }

  const sorted = [...drivers].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  const maxAbs = Math.max(...sorted.map((d) => Math.abs(d.contribution)), 0.001);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
        <span>Pulls demand DOWN</span>
        <span>Pulls demand UP</span>
      </div>
      <ul className="space-y-2.5">
        {sorted.map((d, i) => {
          const pct = (Math.abs(d.contribution) / maxAbs) * 50;
          const isPos = d.contribution >= 0;
          const negligible = Math.abs(d.contribution) < 0.01;
          return (
            <li key={d.feature + i} className="grid grid-cols-[10rem_1fr_3.5rem] items-center gap-3">
              <span className="truncate text-xs font-medium text-[var(--ink)]" title={d.feature}>
                {friendly(d.feature)}
              </span>
              <div className="relative h-4 rounded bg-[var(--surface-muted)]">
                <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
                {!negligible && (
                  <div
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      left: isPos ? "50%" : `${50 - Math.max(2, pct)}%`,
                    }}
                    className={`absolute inset-y-0 rounded ${
                      isPos
                        ? "bg-[var(--accent-good,oklch(0.72_0.13_155))]"
                        : "bg-[var(--accent-warn,oklch(0.76_0.14_70))]"
                    }`}
                  />
                )}
              </div>
              <span
                className={`text-right font-mono text-xs tabular-nums ${
                  negligible
                    ? "text-[var(--ink-subtle)]"
                    : isPos
                      ? "text-[oklch(0.55_0.13_155)]"
                      : "text-[oklch(0.55_0.14_50)]"
                }`}
              >
                {formatContribution(d.contribution)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
