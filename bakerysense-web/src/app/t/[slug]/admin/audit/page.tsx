import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { AuditLogTable } from "@/components/admin/AuditLogTable";

export const runtime = "nodejs";

export default async function AuditAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = getCloudflareContext();
  const h = await headers();
  const req = new Request("http://localhost/internal", { headers: h });
  const session = await resolveSession(env, req);
  if (!session) redirect("/signin");
  if (session.claims.role !== "tenant_admin" && session.claims.role !== "platform_admin") {
    redirect(`/t/${slug}/dashboard`);
  }

  const db = getDb(env);
  const entries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, session.claims.tid))
    .orderBy(desc(auditLog.createdAt))
    .limit(100)
    .all();

  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-6 text-2xl font-semibold">Audit Log</h1>
      <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <AuditLogTable entries={entries} />
      </section>
    </>
  );
}
