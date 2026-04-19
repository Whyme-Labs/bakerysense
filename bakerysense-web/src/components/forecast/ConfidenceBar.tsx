interface Props {
  quantiles: Record<string, number>;
  bakeQuantity: number;
  max: number;
}

export function ConfidenceBar({ quantiles, bakeQuantity, max }: Props) {
  const q10 = quantiles["q0.1"] ?? 0;
  const q50 = quantiles["q0.5"] ?? 0;
  const q90 = quantiles["q0.9"] ?? 0;
  const scale = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <svg viewBox="0 0 100 12" className="h-3 w-40" role="img" aria-label={`quantile band: ${q10.toFixed(0)}–${q90.toFixed(0)}, bake ${bakeQuantity}`}>
      <rect x={scale(q10)} y="4" width={scale(q90 - q10)} height="4" fill="var(--brand-200)" rx="2" />
      <line x1={scale(q50)} y1="3" x2={scale(q50)} y2="9" stroke="var(--brand-700)" strokeWidth="1.2" />
      <circle cx={scale(bakeQuantity)} cy="6" r="2.2" fill="var(--accent-warn)" stroke="white" strokeWidth="1" />
    </svg>
  );
}
