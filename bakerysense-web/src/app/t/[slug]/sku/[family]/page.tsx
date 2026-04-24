import { headers } from "next/headers";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { QuantileChart } from "@/components/forecast/QuantileChart";
import { DriverBars } from "@/components/forecast/DriverBars";
import { DriftBanner } from "@/components/feedback/DriftBanner";

interface PageProps {
  params: Promise<{ slug: string; family: string }>;
  searchParams: Promise<{ branch?: string; on_date?: string }>;
}

async function fetchJson(path: string, cookie: string) {
  const h = await headers();
  const host = h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  const res = await fetch(`${protocol}://${host}${path}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status}`);
  return res.json();
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--ink-subtle)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>}
    </div>
  );
}

export default async function SkuDetailPage({ params, searchParams }: PageProps) {
  const { slug, family } = await params;
  const decodedFamily = decodeURIComponent(family);
  const sp = await searchParams;
  const onDate = sp.on_date ?? new Date().toISOString().slice(0, 10);
  const branch = sp.branch ?? "";
  const h = await headers();
  const cookie = h.get("cookie") ?? "";

  if (!branch) {
    return (
      <>
        <TenantHeader slug={slug} />
        <h1 className="text-2xl font-semibold">{decodedFamily}</h1>
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Select a branch in the nav to view this SKU&rsquo;s forecast.</p>
      </>
    );
  }

  const qs = `?on_date=${onDate}&branch=${encodeURIComponent(branch)}`;
  const familyPath = encodeURIComponent(decodedFamily);
  const [forecastRaw, explainRaw, metricsRaw] = await Promise.all([
    fetchJson(`/api/forecast/${familyPath}${qs}`, cookie),
    fetchJson(`/api/explain/${familyPath}${qs}&top_k=5`, cookie).catch(() => null),
    fetchJson(`/api/actuals/metrics?branch=${encodeURIComponent(branch)}&window=14&family=${familyPath}`, cookie).catch(() => null),
  ]);

  const forecast = forecastRaw as { bake_quantity: number; quantiles: Record<string, number> };
  const explain = explainRaw as { drivers?: Array<{ feature: string; contribution: number }> } | null;
  const metrics = metricsRaw as { entries: Array<{ family: string; wape: number; sampleCount: number }> } | null;

  const bake = forecast.bake_quantity;
  const quantiles = forecast.quantiles;
  const drivers = explain?.drivers ?? [];

  const currentWape = metrics?.entries[0]?.wape ?? 0;
  const sampleCount = metrics?.entries[0]?.sampleCount ?? 0;

  const q10 = Math.round(quantiles["q0.1"] ?? 0);
  const q50 = Math.round(quantiles["q0.5"] ?? 0);
  const q90 = Math.round(quantiles["q0.9"] ?? 0);
  const bandWidth = q90 - q10;
  const wapePct = currentWape > 0 ? `${(currentWape * 100).toFixed(1)}%` : "—";
  const accuracyLabel = currentWape > 0 ? `${((1 - currentWape) * 100).toFixed(0)}% accurate` : "no recent actuals";

  const prefill = encodeURIComponent(`Ask Gemma why ${decodedFamily} is forecast ${bake} for ${onDate}`);

  return (
    <>
      <TenantHeader slug={slug} />
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{decodedFamily}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Branch {branch} · {onDate}</p>
        </div>
        <a href={`/t/${slug}/chat?branch=${branch}&prefill=${prefill}`}
           data-testid="ask-gemma-why"
           className="rounded border border-[var(--border-strong)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--accent-info)] hover:bg-[var(--surface-muted)]">
          Ask Gemma why →
        </a>
      </div>
      <DriftBanner currentWape={currentWape} baselineWape={0.25} sampleCount={sampleCount} slug={slug} />
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Recommended bake" value={String(bake)} sub="newsvendor-picked" />
        <StatTile label="Median demand" value={String(q50)} sub={`p10 ${q10} — p90 ${q90}`} />
        <StatTile label="Band width" value={String(bandWidth)} sub="p90 − p10 units" />
        <StatTile label="14-day WAPE" value={wapePct} sub={sampleCount > 0 ? `${accuracyLabel} · n=${sampleCount}` : "no recent actuals"} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Quantile band</h2>
          <QuantileChart quantiles={quantiles} bakeQuantity={bake} />
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            The amber dot is the bake recommendation. The darker band is the p30–p70 core; the lighter band is p10–p90.
          </p>
        </section>
        <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Top drivers</h2>
          <DriverBars drivers={drivers} />
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Green bars push demand up, amber push it down. Values are SHAP-style feature contributions.
          </p>
        </section>
      </div>
    </>
  );
}
