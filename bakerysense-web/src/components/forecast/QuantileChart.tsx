interface Props {
  quantiles: Record<string, number>;
  bakeQuantity: number;
}

export function QuantileChart({ quantiles, bakeQuantity }: Props) {
  const q10 = quantiles["q0.1"] ?? 0;
  const q30 = quantiles["q0.3"] ?? 0;
  const q50 = quantiles["q0.5"] ?? 0;
  const q70 = quantiles["q0.7"] ?? 0;
  const q90 = quantiles["q0.9"] ?? 0;

  const W = 360;
  const H = 200;
  const PAD_L = 24;
  const PAD_R = 24;
  const PAD_T = 30;
  const TRACK_Y = 90;
  const TRACK_H = 36;

  const minVal = Math.max(0, Math.floor((Math.min(q10, bakeQuantity) - 5) / 5) * 5);
  const maxVal = Math.ceil((Math.max(q90, bakeQuantity) + 5) / 5) * 5;
  const span = Math.max(1, maxVal - minVal);

  const scaleX = (v: number) => PAD_L + ((v - minVal) / span) * (W - PAD_L - PAD_R);

  const x10 = scaleX(q10);
  const x30 = scaleX(q30);
  const x50 = scaleX(q50);
  const x70 = scaleX(q70);
  const x90 = scaleX(q90);
  const xBake = scaleX(bakeQuantity);

  const tickStep = span <= 20 ? 5 : span <= 60 ? 10 : span <= 200 ? 25 : 50;
  const tickStart = Math.ceil(minVal / tickStep) * tickStep;
  const ticks: number[] = [];
  for (let v = tickStart; v <= maxVal; v += tickStep) ticks.push(v);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-48 w-full"
      role="img"
      aria-label={`quantile band: ${q10.toFixed(0)}–${q90.toFixed(0)} units, median ${q50.toFixed(0)}, recommended bake ${bakeQuantity}`}
    >
      <defs>
        <linearGradient id="qband-outer" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--brand-200, oklch(0.92 0.04 80))" stopOpacity="0.55" />
          <stop offset="50%" stopColor="var(--brand-200, oklch(0.92 0.04 80))" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--brand-200, oklch(0.92 0.04 80))" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <text x={PAD_L} y={18} fontSize="10" fontWeight="600" fill="var(--ink-muted)">
        Range of likely demand (units)
      </text>

      <rect
        x={x10}
        y={TRACK_Y}
        width={Math.max(0, x90 - x10)}
        height={TRACK_H}
        fill="url(#qband-outer)"
        rx="6"
      />
      <rect
        x={x30}
        y={TRACK_Y + 4}
        width={Math.max(0, x70 - x30)}
        height={TRACK_H - 8}
        fill="var(--brand-500, oklch(0.7 0.12 75))"
        fillOpacity="0.42"
        rx="4"
      />
      <line
        x1={x50}
        y1={TRACK_Y - 6}
        x2={x50}
        y2={TRACK_Y + TRACK_H + 6}
        stroke="var(--brand-700, oklch(0.45 0.12 65))"
        strokeWidth="2"
      />

      <text x={(x10 + x30) / 2} y={TRACK_Y + TRACK_H / 2 + 3} fontSize="8" textAnchor="middle" fill="var(--ink-subtle)" fontWeight="500">
        unlikely
      </text>
      <text x={(x30 + x70) / 2} y={TRACK_Y + TRACK_H / 2 + 3} fontSize="9" textAnchor="middle" fill="var(--ink)" fontWeight="600">
        most likely
      </text>
      <text x={(x70 + x90) / 2} y={TRACK_Y + TRACK_H / 2 + 3} fontSize="8" textAnchor="middle" fill="var(--ink-subtle)" fontWeight="500">
        unlikely
      </text>

      <text x={x10} y={TRACK_Y - 10} fontSize="8" textAnchor="middle" fill="var(--ink-subtle)" fontWeight="600">p10</text>
      <text x={x50} y={TRACK_Y - 10} fontSize="8" textAnchor="middle" fill="var(--brand-700, oklch(0.45 0.12 65))" fontWeight="700">p50</text>
      <text x={x90} y={TRACK_Y - 10} fontSize="8" textAnchor="middle" fill="var(--ink-subtle)" fontWeight="600">p90</text>

      <line
        x1={xBake}
        y1={TRACK_Y - 18}
        x2={xBake}
        y2={TRACK_Y + TRACK_H + 18}
        stroke="var(--accent-warn, oklch(0.7 0.14 60))"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <circle cx={xBake} cy={TRACK_Y + TRACK_H / 2} r="6" fill="var(--accent-warn, oklch(0.7 0.14 60))" stroke="white" strokeWidth="2" />
      <g transform={`translate(${xBake}, ${TRACK_Y + TRACK_H + 24})`}>
        <rect x="-22" y="-9" width="44" height="14" rx="3" fill="var(--accent-warn, oklch(0.7 0.14 60))" />
        <text x="0" y="1" fontSize="9" textAnchor="middle" fill="white" fontWeight="700">bake {bakeQuantity}</text>
      </g>

      <line x1={PAD_L} y1={TRACK_Y + TRACK_H + 50} x2={W - PAD_R} y2={TRACK_Y + TRACK_H + 50} stroke="var(--border-strong)" strokeWidth="0.5" />
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={scaleX(t)}
            y1={TRACK_Y + TRACK_H + 48}
            x2={scaleX(t)}
            y2={TRACK_Y + TRACK_H + 53}
            stroke="var(--border-strong)"
            strokeWidth="0.5"
          />
          <text
            x={scaleX(t)}
            y={TRACK_Y + TRACK_H + 64}
            fontSize="9"
            textAnchor="middle"
            fill="var(--ink-muted)"
            fontFamily="ui-monospace, monospace"
          >
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}
