export function targetServiceLevel(cu: number, co: number): number {
  if (cu < 0 || co < 0 || cu + co === 0) throw new Error("invalid cost ratio");
  return cu / (cu + co);
}

export function orderQuantity(
  forecasts: Record<number, number>,
  cu: number,
  co: number,
): { quantity: number; quantile: number } {
  const target = targetServiceLevel(cu, co);
  const entries = Object.entries(forecasts).map(([q, v]) => [parseFloat(q), v] as const);
  if (entries.length === 0) throw new Error("no quantile forecasts");
  let best = entries[0];
  let bestDist = Math.abs(best[0] - target);
  for (const e of entries.slice(1)) {
    const d = Math.abs(e[0] - target);
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return { quantile: best[0], quantity: Math.ceil(best[1]) };
}
