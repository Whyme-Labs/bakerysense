import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { RetrainingHistory } from "@/components/admin/RetrainingHistory";
import { TriggerRetrainButton } from "@/components/admin/TriggerRetrainButton";
import { ImportActualsCsv } from "@/components/admin/ImportActualsCsv";
import { ModelInfoPanel } from "@/components/admin/ModelInfoPanel";
import { readActive, readVersions, readRetrainState } from "@/lib/model-pointer";
import { loadTenantModels } from "@/lib/features";
import { loadTrees } from "@/lib/gbm-walker";
import { getDb } from "@/db/client";
import { branches, dailyActuals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

interface ModelMeta {
  quantiles: string[];
  features: string[];
}

async function loadModelMeta(env: CloudflareEnv, tenantId: string): Promise<ModelMeta> {
  try {
    const m = await loadTenantModels(env, tenantId);
    const keys = Object.keys(m.quantiles).sort((a, b) => parseFloat(a) - parseFloat(b));
    let features: string[] = [];
    if (keys.length > 0) {
      try {
        features = loadTrees(m.quantiles[keys[0]]).feature_names;
      } catch { /* model JSON shape mismatch — show empty feature list */ }
    }
    return { quantiles: keys, features };
  } catch {
    return { quantiles: [], features: [] };
  }
}

interface TrainingStats {
  rows: number;
  families: number;
  branches: number;
  range: { start: string; end: string } | null;
}

async function loadTrainingStats(env: CloudflareEnv, tenantId: string): Promise<TrainingStats> {
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
    .where(eq(dailyActuals.tenantId, tenantId))
    .get();
  return {
    rows: row?.rows ?? 0,
    families: row?.families ?? 0,
    branches: row?.branches ?? 0,
    range: row?.minDate && row?.maxDate ? { start: row.minDate, end: row.maxDate } : null,
  };
}

export default async function RetrainingAdminPage({ params }: { params: Promise<{ slug: string }> }) {
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
  const [active, versions, state, branchRows, modelMeta, training] = await Promise.all([
    readActive(env, tid),
    readVersions(env, tid),
    readRetrainState(env, tid),
    getDb(env).select().from(branches).where(eq(branches.tenantId, tid)).all(),
    loadModelMeta(env, tid),
    loadTrainingStats(env, tid),
  ]);
  const branchList = branchRows.map((b) => ({ id: b.id, name: b.name }));
  const latestVersion = versions[0];
  const rollingWape = latestVersion?.metrics?.rollingWape ?? null;
  const rollingMae = active?.rollingMae ?? latestVersion?.metrics?.rollingMae ?? null;
  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-6 text-2xl font-semibold">Model &amp; retraining</h1>
      <ModelInfoPanel
        predictor="LightGBM gradient-boosted trees · 7 quantile heads"
        quantileHeads={modelMeta.quantiles}
        features={modelMeta.features}
        trainedAt={active?.trainedAt ?? null}
        rollingWape={rollingWape}
        rollingMae={rollingMae}
        version={active?.version ?? null}
        trainingRows={training.rows}
        trainingFamilies={training.families}
        trainingBranches={training.branches}
        trainingDateRange={training.range}
      />
      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Retrain history</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Each retrain reads the latest actuals, refits the trees on a rolling window, and atomically swaps the active model.
            </p>
          </div>
          <TriggerRetrainButton />
        </div>
        <RetrainingHistory active={active} versions={versions} state={state} />
      </section>
      <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Import actuals</h2>
        <ImportActualsCsv branches={branchList} />
      </section>
    </>
  );
}
