interface Driver {
  feature: string;
  contribution: number;
}

interface Props {
  drivers: Driver[];
}

const ROW_H = 24;
const LABEL_W = 100;
const CENTER_X = 150;
const BAR_MAX = 100; // max bar half-width in px

export function DriverBars({ drivers }: Props) {
  if (drivers.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-subtle)]">No driver data available.</p>
    );
  }

  const sorted = [...drivers].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  const maxAbs = Math.max(...sorted.map((d) => Math.abs(d.contribution)), 1);
  const H = sorted.length * ROW_H + 8;

  return (
    <svg
      viewBox={`0 0 300 ${H}`}
      className="w-full max-w-md"
      style={{ height: H }}
      role="img"
      aria-label="SHAP feature contributions"
    >
      {sorted.map((d, i) => {
        const y = i * ROW_H + 4;
        const barW = (Math.abs(d.contribution) / maxAbs) * BAR_MAX;
        const isPos = d.contribution >= 0;
        const barX = isPos ? CENTER_X : CENTER_X - barW;
        const barColor = isPos ? "var(--accent-good)" : "var(--accent-warn)";
        const labelX = LABEL_W - 4;
        const valueX = isPos ? CENTER_X + barW + 4 : CENTER_X - barW - 4;
        const valueAnchor = isPos ? "start" : "end";

        return (
          <g key={d.feature}>
            {/* Feature label */}
            <text
              x={labelX}
              y={y + ROW_H / 2 + 4}
              textAnchor="end"
              fontSize="9"
              fill="var(--ink-muted)"
            >
              {d.feature.replace(/_/g, " ")}
            </text>
            {/* Bar */}
            <rect
              x={barX}
              y={y + 6}
              width={barW}
              height={ROW_H - 10}
              fill={barColor}
              fillOpacity="0.85"
              rx="2"
            />
            {/* Value label */}
            <text
              x={valueX}
              y={y + ROW_H / 2 + 4}
              textAnchor={valueAnchor}
              fontSize="8"
              fill="var(--ink)"
            >
              {d.contribution > 0 ? "+" : ""}
              {d.contribution.toFixed(1)}
            </text>
          </g>
        );
      })}
      {/* Center axis line */}
      <line
        x1={CENTER_X}
        y1="0"
        x2={CENTER_X}
        y2={H}
        stroke="var(--border-strong)"
        strokeWidth="0.5"
      />
    </svg>
  );
}
