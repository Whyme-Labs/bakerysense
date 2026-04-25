import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { DailyTotalsSparkline } from "@/components/admin/DailyTotalsSparkline";
import { getDb } from "@/db/client";
import { dailyActuals, branches } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export const runtime = "nodejs";

interface DataSummary {
  rows: number;
  families: number;
  branches: number;
  range: { start: string; end: string } | null;
}

interface DailyTotal { date: string; total: number }

interface RecentRow {
  date: string;
  branch: string;
  family: string;
  actualSales: number | null;
  recommendedBake: number | null;
  actualBake: number | null;
  wasteUnits: number | null;
  source: string;
}

async function loadSummary(env: CloudflareEnv, tid: string): Promise<DataSummary> {
  const db = getDb(env);
  const row = await db
    .select({
      rows: sql<number>`count(${dailyActuals.id})`,
      families: sql<number>`count(distinct ${dailyActuals.family})`,
      branches: sql<number>`count(distinct ${dailyActuals.branchId})`,
      minDate: sql<string | null>`min(${dailyActuals.date})`,
      maxDate: sql<string | null>`max(${dailyActuals.date})`,
    })
    .from(dailyActuals)
    .where(eq(dailyActuals.tenantId, tid))
    .get();
  return {
    rows: row?.rows ?? 0,
    families: row?.families ?? 0,
    branches: row?.branches ?? 0,
    range: row?.minDate && row?.maxDate ? { start: row.minDate, end: row.maxDate } : null,
  };
}

async function loadDailyTotals(env: CloudflareEnv, tid: string): Promise<DailyTotal[]> {
  const db = getDb(env);
  const rows = await db
    .select({
      date: dailyActuals.date,
      total: sql<number>`coalesce(sum(${dailyActuals.actualSales}), 0)`,
    })
    .from(dailyActuals)
    .where(eq(dailyActuals.tenantId, tid))
    .groupBy(dailyActuals.date)
    .orderBy(desc(dailyActuals.date))
    .limit(30)
    .all();
  return rows.reverse();
}

async function loadRecentRows(env: CloudflareEnv, tid: string): Promise<RecentRow[]> {
  const db = getDb(env);
  const rows = await db
    .select({
      date: dailyActuals.date,
      branchName: branches.name,
      family: dailyActuals.family,
      actualSales: dailyActuals.actualSales,
      recommendedBake: dailyActuals.recommendedBake,
      actualBake: dailyActuals.actualBake,
      wasteUnits: dailyActuals.wasteUnits,
      source: dailyActuals.source,
    })
    .from(dailyActuals)
    .innerJoin(branches, eq(branches.id, dailyActuals.branchId))
    .where(eq(dailyActuals.tenantId, tid))
    .orderBy(desc(dailyActuals.date), desc(dailyActuals.capturedAt))
    .limit(15)
    .all();
  return rows.map((r) => ({
    date: r.date,
    branch: r.branchName,
    family: r.family,
    actualSales: r.actualSales,
    recommendedBake: r.recommendedBake,
    actualBake: r.actualBake,
    wasteUnits: r.wasteUnits,
    source: r.source,
  }));
}

export default async function DataAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = getCloudflareContext();
  const h = await headers();
  const req = new Request("http://localhost/internal", { headers: h });
  const session = await resolveSession(env, req);
  if (!session) redirect("/signin");
  if (session.claims.role !== "tenant_admin" && session.claims.role !== "platform_admin") {
    redirect(`/t/${slug}/dashboard`);
  }
  const tid = session.claims.tid;
  const [summary, totals, recent] = await Promise.all([
    loadSummary(env, tid),
    loadDailyTotals(env, tid),
    loadRecentRows(env, tid),
  ]);

  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-2 text-2xl font-semibold">Data</h1>
      <p className="mb-6 text-sm text-[var(--ink-muted)]">
        Sales history loaded from your POS / connectors. The forecaster trains on this; the chat assistant grounds its answers in it.
      </p>

      <section
        data-testid="data-summary"
        className="mb-6 grid gap-4 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)] sm:grid-cols-4"
      >
        <Stat label="Sales rows" value={summary.rows.toLocaleString()} sub="per SKU per branch per day" />
        <Stat label="SKUs covered" value={String(summary.families)} sub="distinct product families" />
        <Stat label="Branches" value={String(summary.branches)} sub="loaded into history" />
        <Stat
          label="Date range"
          value={summary.range ? `${summary.range.start} → ${summary.range.end}` : "—"}
          sub={summary.range ? "earliest to latest actual" : "no data yet"}
        />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Total daily sales</h2>
        <p className="mb-4 text-xs text-[var(--ink-muted)]">All SKUs and branches, last {totals.length} days. The forecaster sees per-SKU per-branch decomposition behind this.</p>
        <DailyTotalsSparkline points={totals} />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Recent rows</h2>
        <p className="mb-4 text-xs text-[var(--ink-muted)]">Most recent 15 actuals across all branches.</p>
        <div className="overflow-x-auto">
          <table data-testid="data-preview-table" className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wider text-[var(--ink-subtle)]">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Branch</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 text-right font-medium">Sold</th>
                <th className="py-2 pr-4 text-right font-medium">Rec.</th>
                <th className="py-2 pr-4 text-right font-medium">Baked</th>
                <th className="py-2 pr-4 text-right font-medium">Waste</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {recent.map((r, i) => (
                <tr key={i} className="border-b border-[var(--border)]/40">
                  <td className="py-1.5 pr-4 text-[var(--ink-muted)]">{r.date}</td>
                  <td className="py-1.5 pr-4 text-[var(--ink)]">{r.branch}</td>
                  <td className="py-1.5 pr-4 text-[var(--ink)]">{r.family}</td>
                  <td className="py-1.5 pr-4 text-right">{r.actualSales ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right text-[var(--ink-muted)]">{r.recommendedBake ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right text-[var(--ink-muted)]">{r.actualBake ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right text-[var(--ink-muted)]">{r.wasteUnits ?? "—"}</td>
                  <td className="py-1.5 text-[var(--ink-subtle)]">{r.source}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-[var(--ink-muted)]">No rows yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-subtle)]">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums text-[var(--ink)]" title={value}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>}
    </div>
  );
}
