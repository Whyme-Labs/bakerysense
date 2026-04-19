import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { TenantHeader } from "@/components/shell/TenantHeader";
import { BranchEditor } from "@/components/admin/BranchEditor";
import { BranchTable } from "@/components/admin/BranchTable";

export const runtime = "nodejs";

export default async function BranchesAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = getCloudflareContext();
  const h = await headers();
  const req = new Request("http://localhost/internal", { headers: h });
  const session = await resolveSession(env, req);
  if (!session) redirect("/signin");
  if (session.claims.role !== "tenant_admin" && session.claims.role !== "platform_admin") {
    redirect(`/t/${slug}/dashboard`);
  }
  return (
    <>
      <TenantHeader slug={slug} />
      <h1 className="mb-6 text-2xl font-semibold">Branches</h1>
      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">Add branch</h2>
        <BranchEditor />
      </section>
      <BranchTable />
    </>
  );
}
