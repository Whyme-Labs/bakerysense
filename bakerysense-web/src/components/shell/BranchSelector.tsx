"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { apiJson } from "@/lib/api-client";

interface Branch { id: string; name: string; city?: string }

function label(b: Branch): string {
  return `${b.name}${b.city ? ` — ${b.city}` : ""}`;
}

export function BranchSelector() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams<{ slug: string }>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiJson<{ branches: Branch[] }>("/api/branches").then((b) => setBranches(b.branches)).catch(() => {});
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (branches.length === 0) return null;

  const currentId = search.get("branch") ?? branches[0]?.id ?? "";
  const current = branches.find((b) => b.id === currentId) ?? branches[0];

  function pick(b: Branch) {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("branch", b.id);
    router.push(url.pathname + "?" + url.searchParams.toString());
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="branch-selector"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-white px-2.5 py-1 text-sm hover:bg-[var(--surface-muted)]"
      >
        <span>{label(current)}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          data-testid="branch-selector-menu"
          role="listbox"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded border border-[var(--border-strong)] bg-white shadow-[var(--shadow-md,0_6px_20px_rgba(20,15,10,0.08))]"
        >
          {branches.map((b) => {
            const isCurrent = b.id === current.id;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  data-testid={`branch-option-${b.id}`}
                  onClick={() => pick(b)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)] ${
                    isCurrent ? "font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
                  }`}
                >
                  <span>{label(b)}</span>
                  {isCurrent && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
