interface DriftBannerProps {
  currentWape: number;
  baselineWape: number;
  sampleCount: number;
  slug: string;
}

export function DriftBanner({ currentWape, baselineWape, sampleCount, slug }: DriftBannerProps) {
  const driftDetected =
    sampleCount >= 7 && baselineWape > 0 && currentWape / baselineWape >= 1.5;

  if (!driftDetected) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-[var(--accent-warn)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] px-4 py-3">
      <p className="text-sm text-[var(--ink)]">
        Model accuracy has drifted for this product. Consider retraining or adding more recent actuals.
      </p>
      <a
        href={`/t/${slug}/admin/retraining`}
        className="mt-2 inline-block text-sm font-medium text-[var(--accent-warn)] hover:underline"
      >
        Go to retraining &rarr;
      </a>
    </div>
  );
}
