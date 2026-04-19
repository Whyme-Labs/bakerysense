"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

interface Branch {
  id: string;
  name: string;
}

interface ImportResult {
  imported: number;
  errors?: string[];
}

interface Props {
  branches: Branch[];
}

export function ImportActualsCsv({ branches }: Props) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please select a CSV file.");
      return;
    }
    if (!branchId) {
      setError("Please select a branch.");
      return;
    }

    setPending(true);
    setResult(null);
    setError(null);

    try {
      const csv = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
      });

      const res = await apiFetch("/api/actuals/bulk", {
        method: "POST",
        body: JSON.stringify({ branchId, csv }),
      });

      const body = await res.json() as ImportResult & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Error ${res.status}`);
      } else {
        setResult(body);
        // Reset file input
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="import-branch" className="text-xs font-medium text-[var(--ink-subtle)]">
            Branch
          </label>
          {branches.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No branches available.</p>
          ) : (
            <select
              id="import-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-info)]"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="import-file" className="text-xs font-medium text-[var(--ink-subtle)]">
            CSV file
          </label>
          <input
            id="import-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-sm text-[var(--ink-subtle)] file:mr-3 file:rounded file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium hover:file:bg-[var(--surface-raised)]"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || branches.length === 0}
          className="rounded px-3 py-1.5 text-xs font-medium border border-[var(--border)] bg-white hover:bg-[var(--surface-raised)] disabled:opacity-50"
        >
          {pending ? "Importing..." : "Import"}
        </button>

        {result && (
          <div className="text-sm text-green-700">
            Imported: {result.imported}
            {result.errors && result.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-red-600">
                {result.errors.map((err, i) => (
                  <li key={i} className="text-xs">{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
      </div>
    </form>
  );
}
