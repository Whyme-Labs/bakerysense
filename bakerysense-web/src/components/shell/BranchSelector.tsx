"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { apiJson } from "@/lib/api-client";

interface Branch { id: string; name: string; city?: string }

export function BranchSelector() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams<{ slug: string }>();
  const [branches, setBranches] = useState<Branch[]>([]);
  const current = search.get("branch") ?? branches[0]?.id ?? "";
  useEffect(() => {
    apiJson<{ branches: Branch[] }>("/api/branches").then((b) => setBranches(b.branches)).catch(() => {});
  }, []);
  if (branches.length === 0) return null;
  return (
    <select
      data-testid="branch-selector"
      value={current}
      onChange={(e) => {
        const url = new URL(window.location.href);
        url.searchParams.set("branch", e.target.value);
        router.push(url.pathname + "?" + url.searchParams.toString());
      }}
      className="rounded border border-[var(--border-strong)] bg-white px-2 py-1 text-sm"
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}{b.city ? ` — ${b.city}` : ""}
        </option>
      ))}
    </select>
  );
}
