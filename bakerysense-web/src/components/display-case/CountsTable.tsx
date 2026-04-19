"use client";

import { useState } from "react";

interface CountsTableProps {
  counts: Record<string, number>;
  onChange: (c: Record<string, number>) => void;
}

export function CountsTable({ counts, onChange }: CountsTableProps) {
  const [newSku, setNewSku] = useState("");
  const [newCount, setNewCount] = useState("");

  function handleCountChange(sku: string, value: string) {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) return;
    onChange({ ...counts, [sku]: n });
  }

  function handleAddRow() {
    const sku = newSku.trim().toUpperCase();
    if (!sku) return;
    const n = parseInt(newCount, 10);
    onChange({ ...counts, [sku]: isNaN(n) ? 0 : n });
    setNewSku("");
    setNewCount("");
  }

  function handleDelete(sku: string) {
    const next = { ...counts };
    delete next[sku];
    onChange(next);
  }

  const rows = Object.entries(counts);

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
            <th className="pb-2 pr-4">SKU</th>
            <th className="pb-2 pr-4">Remaining units</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-[var(--ink-subtle)]">
                No counts detected — add rows manually.
              </td>
            </tr>
          )}
          {rows.map(([sku, count]) => (
            <tr key={sku} className="border-b border-[var(--border)] last:border-0">
              <td className="py-2 pr-4 font-mono font-medium">{sku}</td>
              <td className="py-2 pr-4">
                <input
                  type="number"
                  min={0}
                  value={count}
                  onChange={(e) => handleCountChange(sku, e.target.value)}
                  className="w-20 rounded border border-[var(--border)] px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-[var(--accent-info)]"
                />
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => handleDelete(sku)}
                  className="text-xs text-[var(--ink-subtle)] hover:text-red-500"
                  aria-label={`Remove ${sku}`}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="SKU"
          value={newSku}
          onChange={(e) => setNewSku(e.target.value)}
          className="rounded border border-[var(--border)] px-2 py-1 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-[var(--accent-info)]"
        />
        <input
          type="number"
          min={0}
          placeholder="Count"
          value={newCount}
          onChange={(e) => setNewCount(e.target.value)}
          className="w-20 rounded border border-[var(--border)] px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent-info)]"
          onKeyDown={(e) => { if (e.key === "Enter") handleAddRow(); }}
        />
        <button
          type="button"
          onClick={handleAddRow}
          className="rounded bg-[var(--accent-info)] px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          disabled={!newSku.trim()}
        >
          Add row
        </button>
      </div>
    </div>
  );
}
