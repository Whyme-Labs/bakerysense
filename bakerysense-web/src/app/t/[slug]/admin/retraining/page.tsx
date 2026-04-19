import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { RetrainingHistory } from "@/components/admin/RetrainingHistory";
import { TriggerRetrainButton } from "@/components/admin/TriggerRetrainButton";
import { ImportActualsCsv } from "@/components/admin/ImportActualsCsv";
import { readActive, readVersions, readRetrainState } from "@/lib/model-pointer";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

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
  const [active, versions, state, branchRows] = await Promise.all([
    readActive(env, session.claims.tid),
    readVersions(env, session.claims.tid),
    readRetrainState(env, session.claims.tid),
    getDb(env).select().from(branches).where(eq(branches.tenantId, session.claims.tid)).all(),
  ]);
  const branchList = branchRows.map((b) => ({ id: b.id, name: b.name }));
  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-6 text-2xl font-semibold">Retraining</h1>
      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">History</h2>
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
