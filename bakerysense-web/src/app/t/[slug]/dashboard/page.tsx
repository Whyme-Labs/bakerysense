import { headers, cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { bakePlanDecisions } from "@/db/schema";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { BakePlanTable } from "@/components/forecast/BakePlanTable";
import { CloseOutDayTrigger } from "@/components/feedback/CloseOutDayDialog";
import { PlanOptions } from "@/components/dashboard/PlanOptions";

interface SearchParams { branch?: string; on_date?: string }

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}`;
}

async function loadForecasts(slug: string, branch: string, onDate: string, cookie: string) {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/forecast/batch?branch=${encodeURIComponent(branch)}&on_date=${onDate}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`forecast batch ${res.status}`);
  return res.json();
}

async function fetchJson<T>(path: string, cookie: string): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
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

  const [data, metrics] = await Promise.all([
    loadForecasts(slug, branch, onDate, cookie) as Promise<{
      forecasts: Array<{ sku: string; bake_quantity: number; quantiles: Record<string, number> }>;
    }>,
    fetchJson<{ entries: Array<{ family: string; wape: number; sampleCount: number }> }>(
      `/api/actuals/metrics?branch=${encodeURIComponent(branch)}&window=7`,
      cookie,
    ).catch(() => ({ entries: [] })),
  ]);
  const wapeByFamily = new Map(metrics.entries.map((e) => [e.family, { wape: e.wape, sampleCount: e.sampleCount }]));
  const closeOutRows = data.forecasts.map((f) => ({ sku: f.sku, recommendedBake: f.bake_quantity }));

  // Server-side fetch of already-committed plans + CSRF for the client commit
  // call. Lets the page render committed badges on initial paint without a
  // round-trip flash. Failure is non-fatal — empty state degrades gracefully.
  const { env } = getCloudflareContext();
  const req = new Request("http://localhost/internal", { headers: h });
  const session = await resolveSession(env, req);
  let committedRows: Array<{ family: string; optionKind: string; bakeQuantity: number; committedAt: number }> = [];
  if (session) {
    const db = getDb(env);
    const rows = await db
      .select({
        family: bakePlanDecisions.family,
        optionKind: bakePlanDecisions.optionKind,
        bakeQuantity: bakePlanDecisions.bakeQuantity,
        committedAt: bakePlanDecisions.committedAt,
      })
      .from(bakePlanDecisions)
      .where(and(
        eq(bakePlanDecisions.tenantId, session.claims.tid),
        eq(bakePlanDecisions.branchId, branch),
        eq(bakePlanDecisions.date, onDate),
      ))
      .all();
    committedRows = rows;
  }
  const cookieJar = await cookies();
  const csrfToken = cookieJar.get("bs_csrf")?.value ?? "";

  return (
    <>
      <TenantHeader slug={slug} />
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Today&rsquo;s bake plan</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Branch {branch} · {onDate}</p>
        </div>
        <div className="flex items-center gap-4">
          <CloseOutDayTrigger slug={slug} branch={branch} date={onDate} rows={closeOutRows} />
          <a href={`/t/${slug}/chat?prefill=Summarise%20today's%20bake%20plan%20for%20branch%20${branch}`}
             className="text-sm text-[var(--accent-info)] hover:underline">
            Ask Gemma for a narrative →
          </a>
        </div>
      </div>
      <PlanOptions
        branchId={branch}
        date={onDate}
        csrfToken={csrfToken}
        initialCommitted={committedRows}
      />
      <BakePlanTable rows={data.forecasts} slug={slug} branch={branch} onDate={onDate} wapeByFamily={wapeByFamily} />
    </>
  );
}
