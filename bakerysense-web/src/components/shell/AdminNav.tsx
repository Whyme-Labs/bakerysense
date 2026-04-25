"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const TABS = [
  { href: "connectors", label: "Connectors" },
  { href: "data", label: "Data" },
  { href: "users", label: "Users" },
  { href: "branches", label: "Branches" },
  { href: "retraining", label: "Model" },
  { href: "audit", label: "Audit" },
];

export function AdminNav() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const slug = params?.slug ?? "";
  return (
    <nav className="mb-6 flex gap-1 border-b border-[var(--border)] text-sm">
      {TABS.map((t) => {
        const active = pathname?.endsWith(`/admin/${t.href}`);
        return (
          <Link
            key={t.href}
            href={`/t/${slug}/admin/${t.href}`}
            data-testid={`admin-nav-${t.href}`}
            className={`-mb-px border-b-2 px-3 py-2 ${
              active
                ? "border-[var(--brand-700,oklch(0.52_0.13_60))] text-[var(--ink)] font-medium"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
