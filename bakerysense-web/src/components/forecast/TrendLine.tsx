interface Props {
  values: number[];
}

export function TrendLine({ values }: Props) {
  if (values.length < 2) return <></>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 100;
  const H = 30;
  const PAD = 2;

  // Map each value to (x, y) in viewBox coords
  const points = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    // Invert y: higher value → lower y (SVG y grows downward)
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const lastX = PAD + (W - PAD * 2);
  const lastY = H - PAD - ((values[values.length - 1] - min) / range) * (H - PAD * 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-8 w-32"
      role="img"
      aria-label={`trend sparkline, last value ${values[values.length - 1]}`}
    >
      <polyline
        points={points.join(" ")}
        stroke="var(--brand-700)"
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={lastX.toFixed(2)}
        cy={lastY.toFixed(2)}
        r="2"
        fill="var(--brand-700)"
      />
    </svg>
  );
}
