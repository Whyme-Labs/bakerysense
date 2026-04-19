import { headers } from "next/headers";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { BakePlanTable } from "@/components/forecast/BakePlanTable";

interface SearchParams { branch?: string; on_date?: string }

async function loadForecasts(slug: string, branch: string, onDate: string, cookie: string) {
  const h = await headers();
  const host = h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  const res = await fetch(`${protocol}://${host}/api/forecast/batch?branch=${encodeURIComponent(branch)}&on_date=${onDate}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`forecast batch ${res.status}`);
  return res.json();
}

export default async function DashboardPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const onDate = sp.on_date ?? new Date().toISOString().slice(0, 10);
  const branch = sp.branch ?? "";
  const h = await headers();
  const cookie = h.get("cookie") ?? "";

  if (!branch) {
    return (
      <>
        <TenantHeader slug={slug} />
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-4 text-sm text-[var(--ink-muted)]">Select a branch above to see today&rsquo;s bake plan.</p>
      </>
    );
  }

  const data = await loadForecasts(slug, branch, onDate, cookie) as {
    forecasts: Array<{ sku: string; bake_quantity: number; quantiles: Record<string, number> }>;
  };
  return (
    <>
      <TenantHeader slug={slug} />
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Today&rsquo;s bake plan</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Branch {branch} · {onDate}</p>
        </div>
        <a href={`/t/${slug}/chat?prefill=Summarise%20today's%20bake%20plan%20for%20branch%20${branch}`}
           className="text-sm text-[var(--accent-info)] hover:underline">
          Ask Gemma for a narrative →
        </a>
      </div>
      <BakePlanTable rows={data.forecasts} slug={slug} onDate={onDate} />
    </>
  );
}
