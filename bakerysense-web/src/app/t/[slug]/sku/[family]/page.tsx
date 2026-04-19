import { headers } from "next/headers";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { QuantileChart } from "@/components/forecast/QuantileChart";
import { DriverBars } from "@/components/forecast/DriverBars";

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
  const [forecastRaw, explainRaw] = await Promise.all([
    fetchJson(`/api/forecast/${familyPath}${qs}`, cookie),
    fetchJson(`/api/explain/${familyPath}${qs}`, cookie).catch(() => null),
  ]);

  const forecast = forecastRaw as { bake_quantity: number; quantiles: Record<string, number> };
  const explain = explainRaw as { drivers?: Array<{ feature: string; contribution: number }> } | null;

  const bake = forecast.bake_quantity;
  const quantiles = forecast.quantiles;
  const drivers = explain?.drivers ?? [];

  const prefill = encodeURIComponent(`Ask Gemma why ${decodedFamily} is forecast ${bake} for ${onDate}`);

  return (
    <>
      <TenantHeader slug={slug} />
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{decodedFamily}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Branch {branch} · {onDate} · bake {bake}</p>
        </div>
        <a href={`/t/${slug}/chat?branch=${branch}&prefill=${prefill}`}
           className="text-sm text-[var(--accent-info)] hover:underline">
          Ask Gemma why →
        </a>
      </div>
      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Quantile band</h2>
        <QuantileChart quantiles={quantiles} bakeQuantity={bake} />
      </section>
      <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Top drivers</h2>
        <DriverBars drivers={drivers} />
      </section>
    </>
  );
}
