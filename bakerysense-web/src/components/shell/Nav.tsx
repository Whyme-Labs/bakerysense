"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/lib/use-session";
import { BranchSelector } from "./BranchSelector";
import { UserMenu } from "./UserMenu";
import { StatusBadge } from "./StatusBadge";

const ITEMS = [
  { href: "dashboard", label: "Dashboard" },
  { href: "chat", label: "Chat" },
  { href: "display-case", label: "Display case" },
];

export function Nav() {
  const { claims } = useSession();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const isAdmin = claims?.role === "tenant_admin" || claims?.role === "platform_admin";
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <Link href={`/t/${slug}/dashboard`} className="text-sm font-semibold tracking-tight">
          BakerySense
        </Link>
        <nav className="ml-4 flex gap-1 text-sm">
          {ITEMS.map((it) => (
            <Link key={it.href} href={`/t/${slug}/${it.href}`}
                  className="rounded px-3 py-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]">
              {it.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href={`/t/${slug}/admin/connectors`}
                  className="rounded px-3 py-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]">
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <BranchSelector />
          <StatusBadge />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
