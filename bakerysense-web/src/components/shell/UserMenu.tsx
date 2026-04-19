"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";

export function UserMenu() {
  const { claims } = useSession();
  const router = useRouter();
  async function signOut() {
    await apiFetch("/api/auth/signout", { method: "POST" });
    router.push("/signin");
  }
  if (!claims) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link href="/account/settings" className="text-[var(--ink-muted)] hover:text-[var(--ink)]">
        Settings
      </Link>
      <button data-testid="user-menu-signout" onClick={signOut} className="rounded border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--surface-muted)]">
        Sign out
      </button>
    </div>
  );
}
