import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveSession } from "@/lib/auth/session";
import { PasswordChange } from "@/components/account/PasswordChange";
import { DevOverridesPanel } from "@/components/account/DevOverridesPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const { env } = getCloudflareContext();
  const h = await headers();
  const req = new Request("http://localhost/internal", { headers: h });
  const session = await resolveSession(env, req);
  if (!session) redirect("/signin");

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Account settings</h1>

      <section className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
          Change password
        </h2>
        <PasswordChange />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
          Dev overrides
        </h2>
        <DevOverridesPanel />
      </section>
    </>
  );
}
