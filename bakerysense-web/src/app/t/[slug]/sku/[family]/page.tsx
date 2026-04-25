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

function StatTile({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
        <span>{label}</span>
        {hint && (
          <span
            title={hint}
            aria-label={hint}
            className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-[var(--border-strong)] text-[9px] font-semibold normal-case text-[var(--ink-muted)]"
          >
            i
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>}
      {hint && <div className="mt-2 text-[11px] leading-snug text-[var(--ink-muted)]">{hint}</div>}
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
      <details className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--ink-muted)]">
        <summary className="cursor-pointer font-medium text-[var(--ink)]">How to read this page</summary>
        <ul className="mt-3 space-y-2 leading-relaxed">
          <li><strong className="text-[var(--ink)]">Recommended bake</strong> — how many units we suggest baking today. It balances the cost of baking one too many (waste) against the cost of running out (lost sale).</li>
          <li><strong className="text-[var(--ink)]">Median demand (p50)</strong> — our middle estimate. Half the time we expect to sell more than this, half the time less.</li>
          <li><strong className="text-[var(--ink)]">Band width (p90 − p10)</strong> — how uncertain the forecast is. A wider band means more variable demand; a narrow band means the day is predictable.</li>
          <li><strong className="text-[var(--ink)]">Forecast accuracy (WAPE)</strong> — how close recent forecasts came to real sales. 100% accurate would mean zero error; lower is worse.</li>
          <li><strong className="text-[var(--ink)]">Quantile band chart</strong> — shows the range real demand usually lands in. The darker middle is where it lands most often; the lighter band covers 80% of days. The amber dot is what we bake.</li>
        </ul>
      </details>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Recommended bake"
          value={String(bake)}
          sub="newsvendor-picked"
          hint="How many to bake today — balances waste vs stockouts."
        />
        <StatTile
          label="Median demand"
          value={String(q50)}
          sub={`p10 ${q10} — p90 ${q90}`}
          hint="Middle estimate: half the time sales beat this, half the time fall short."
        />
        <StatTile
          label="Band width"
          value={String(bandWidth)}
          sub="p90 − p10 units"
          hint="Uncertainty: wider band means demand varies a lot day-to-day."
        />
        <StatTile
          label="Forecast accuracy"
          value={currentWape > 0 ? `${((1 - currentWape) * 100).toFixed(0)}%` : "—"}
          sub={sampleCount > 0 ? `WAPE ${wapePct} · n=${sampleCount}` : "no recent actuals"}
          hint="How close the last 14 days of forecasts came to real sales."
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Quantile band</h2>
          <p className="mb-4 text-xs text-[var(--ink-muted)]">The range real demand usually lands in.</p>
          <QuantileChart quantiles={quantiles} bakeQuantity={bake} />
          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            <strong className="text-[var(--ink)]">How to read it:</strong> 80% of days, real demand falls inside the lighter band (p10–p90). The darker band (p30–p70) is where it lands most often. The amber dot is the bake we recommend — picked to keep waste and stockouts in balance, not just the middle.
          </p>
        </section>
        <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
          <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Top drivers</h2>
          <p className="mb-4 text-xs text-[var(--ink-muted)]">Why today&rsquo;s forecast looks the way it does.</p>
          <DriverBars drivers={drivers} />
          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            <strong className="text-[var(--ink)]">How to read it:</strong> Green bars are reasons demand is higher today (e.g. weekend, payday, promo). Amber bars are reasons it&rsquo;s lower (e.g. rain, holiday closure). Longer bar = bigger effect.
          </p>
        </section>
      </div>
    </>
  );
}
