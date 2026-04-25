interface Point {
  date: string;
  total: number;
}

interface Props {
  points: Point[];
}

export function DailyTotalsSparkline({ points }: Props) {
  if (points.length < 2) {
    return <div className="text-xs text-[var(--ink-muted)]">Not enough history to chart yet.</div>;
  }
  const W = 720;
  const H = 140;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const totals = points.map((p) => p.total);
  const maxV = Math.max(...totals, 1);
  const minV = 0;
  const span = maxV - minV;

  const xAt = (i: number) => PAD_L + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) => PAD_T + (1 - (v - minV) / span) * innerH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.total).toFixed(1)}`)
    .join(" ");
  const area = `${path} L ${xAt(points.length - 1).toFixed(1)} ${PAD_T + innerH} L ${xAt(0).toFixed(1)} ${PAD_T + innerH} Z`;

  const ticks = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= ticks; i++) yTicks.push(minV + (span * i) / ticks);

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % labelEvery === 0 || i === points.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label="daily sales totals">
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-500, oklch(0.7 0.12 75))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--brand-500, oklch(0.7 0.12 75))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yAt(v)}
            y2={yAt(v)}
            stroke="var(--border)"
            strokeWidth="0.5"
            strokeDasharray="2 3"
          />
          <text
            x={PAD_L - 6}
            y={yAt(v) + 3}
            fontSize="9"
            textAnchor="end"
            fill="var(--ink-subtle)"
            fontFamily="ui-monospace, monospace"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#sparkfill)" />
      <path d={path} fill="none" stroke="var(--brand-700, oklch(0.45 0.12 65))" strokeWidth="1.5" />
      {xLabels.map(({ p, i }) => (
        <text
          key={p.date}
          x={xAt(i)}
          y={H - PAD_B + 16}
          fontSize="9"
          textAnchor="middle"
          fill="var(--ink-muted)"
          fontFamily="ui-monospace, monospace"
        >
          {p.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}
