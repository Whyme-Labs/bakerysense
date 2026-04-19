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

  const maxVal = Math.max(q90, bakeQuantity, 1);
  // Scale a demand value to x coordinate within 10..190 range
  const scaleX = (v: number) => 10 + (v / maxVal) * 180;

  const x10 = scaleX(q10);
  const x30 = scaleX(q30);
  const x50 = scaleX(q50);
  const x70 = scaleX(q70);
  const x90 = scaleX(q90);
  const xBake = scaleX(bakeQuantity);

  return (
    <svg
      viewBox="0 0 200 100"
      className="h-32 w-full max-w-sm"
      role="img"
      aria-label={`quantile band: ${q10.toFixed(0)}–${q90.toFixed(0)}, median ${q50.toFixed(0)}, bake ${bakeQuantity}`}
    >
      {/* Outer band: q0.1 to q0.9 */}
      <rect
        x={x10}
        y="30"
        width={x90 - x10}
        height="30"
        fill="var(--brand-200)"
        rx="3"
      />
      {/* Inner band: q0.3 to q0.7 */}
      <rect
        x={x30}
        y="30"
        width={x70 - x30}
        height="30"
        fill="var(--brand-500)"
        fillOpacity="0.3"
        rx="2"
      />
      {/* Median line at q0.5 */}
      <line
        x1={x50}
        y1="25"
        x2={x50}
        y2="65"
        stroke="var(--brand-700)"
        strokeWidth="2"
      />
      {/* Bake quantity marker */}
      <circle
        cx={xBake}
        cy="45"
        r="4"
        fill="var(--accent-warn)"
        stroke="white"
        strokeWidth="1.5"
      />
      {/* Axis labels */}
      <text x={x10} y="80" textAnchor="middle" fontSize="8" fill="var(--ink-subtle)">
        {q10.toFixed(0)}
      </text>
      <text x={x50} y="80" textAnchor="middle" fontSize="8" fill="var(--ink-muted)">
        {q50.toFixed(0)}
      </text>
      <text x={x90} y="80" textAnchor="middle" fontSize="8" fill="var(--ink-subtle)">
        {q90.toFixed(0)}
      </text>
      {/* Label legend */}
      <text x={x10} y="22" textAnchor="middle" fontSize="7" fill="var(--ink-subtle)">p10</text>
      <text x={x50} y="22" textAnchor="middle" fontSize="7" fill="var(--ink-subtle)">p50</text>
      <text x={x90} y="22" textAnchor="middle" fontSize="7" fill="var(--ink-subtle)">p90</text>
    </svg>
  );
}
