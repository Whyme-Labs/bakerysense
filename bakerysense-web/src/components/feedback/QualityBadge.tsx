interface QualityBadgeProps {
  wape: number | null;
  sampleCount: number;
}

export function QualityBadge({ wape, sampleCount }: QualityBadgeProps) {
  if (sampleCount < 3 || wape === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-[var(--ink-subtle)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-subtle)] opacity-40" />
        no signal
      </span>
    );
  }

  const pct = Math.round(wape * 100);

  let dotClass: string;
  let textClass: string;

  if (wape < 0.2) {
    dotClass = "bg-[var(--accent-good)]";
    textClass = "text-[var(--accent-good)]";
  } else if (wape < 0.35) {
    dotClass = "bg-[var(--accent-warn)]";
    textClass = "text-[var(--accent-warn)]";
  } else {
    dotClass = "bg-[oklch(0.60_0.19_25)]";
    textClass = "text-[oklch(0.60_0.19_25)]";
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${textClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {pct}%
    </span>
  );
}
