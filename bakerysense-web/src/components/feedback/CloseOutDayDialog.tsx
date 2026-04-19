"use client";

import { useState } from "react";
import { apiJson } from "@/lib/api-client";

interface CloseOutRow {
  sku: string;
  recommendedBake: number;
}

interface CloseOutDayDialogProps {
  slug: string;
  branch: string;
  date: string;
  rows: CloseOutRow[];
  open: boolean;
  onClose: () => void;
}

interface RowState {
  actualBake: string;
  actualSales: string;
}

export function CloseOutDayDialog({ branch, date, rows, open, onClose }: CloseOutDayDialogProps) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.sku, { actualBake: "", actualSales: "" }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function updateRow(sku: string, field: keyof RowState, value: string) {
    setRowStates((prev) => ({ ...prev, [sku]: { ...prev[sku], [field]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const filled = rows.filter((r) => {
      const s = rowStates[r.sku];
      return s && (s.actualBake.trim() !== "" || s.actualSales.trim() !== "");
    });
    try {
      await Promise.all(
        filled.map((r) => {
          const s = rowStates[r.sku];
          const body: Record<string, unknown> = {
            branchId: branch,
            family: r.sku,
            date,
            recommendedBake: r.recommendedBake,
            source: "manual",
          };
          if (s.actualBake.trim() !== "") body.actualBake = parseInt(s.actualBake, 10);
          if (s.actualSales.trim() !== "") body.actualSales = parseInt(s.actualSales, 10);
          return apiJson("/api/actuals", {
            method: "POST",
            body: JSON.stringify(body),
          });
        })
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "oklch(0 0 0 / 0.40)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow)",
          width: "min(640px, 95vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--ink)" }}>
            Close out today — {date}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-subtle)",
              fontSize: "1.25rem",
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            x
          </button>
        </div>

        <p style={{ fontSize: "0.8125rem", color: "var(--ink-muted)", marginBottom: "16px" }}>
          Enter actuals for each SKU. Leave blank to skip.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--surface-muted)", textAlign: "left" }}>
                <th style={{ padding: "8px 12px", color: "var(--ink-subtle)", fontWeight: 500, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>SKU</th>
                <th style={{ padding: "8px 12px", color: "var(--ink-subtle)", fontWeight: 500, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Recommended</th>
                <th style={{ padding: "8px 12px", color: "var(--ink-subtle)", fontWeight: 500, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Actual bake</th>
                <th style={{ padding: "8px 12px", color: "var(--ink-subtle)", fontWeight: 500, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Actual sales</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.sku}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--ink)" }}>{r.sku}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--ink-muted)" }}>{r.recommendedBake}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={rowStates[r.sku]?.actualBake ?? ""}
                      onChange={(e) => updateRow(r.sku, "actualBake", e.target.value)}
                      style={{
                        width: "80px",
                        padding: "4px 8px",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius-sm)",
                        textAlign: "right",
                        fontSize: "0.875rem",
                        color: "var(--ink)",
                        background: "var(--surface)",
                      }}
                    />
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={rowStates[r.sku]?.actualSales ?? ""}
                      onChange={(e) => updateRow(r.sku, "actualSales", e.target.value)}
                      style={{
                        width: "80px",
                        padding: "4px 8px",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "var(--radius-sm)",
                        textAlign: "right",
                        fontSize: "0.875rem",
                        color: "var(--ink)",
                        background: "var(--surface)",
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <p style={{ marginTop: "12px", fontSize: "0.8125rem", color: "var(--accent-warn)" }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: "8px 16px",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "none",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              color: "var(--ink-muted)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "8px 20px",
              border: "none",
              borderRadius: "var(--radius-sm)",
              background: "var(--brand-500)",
              color: "white",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save all"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CloseOutDayTrigger(props: {
  slug: string;
  branch: string;
  date: string;
  rows: Array<{ sku: string; recommendedBake: number }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "6px 14px",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          background: "none",
          cursor: "pointer",
          fontSize: "0.875rem",
          color: "var(--ink)",
          fontWeight: 500,
        }}
      >
        Close out today
      </button>
      <CloseOutDayDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
