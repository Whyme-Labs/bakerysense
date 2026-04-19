"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api-client";

interface ReportWrongForecastButtonProps {
  slug: string;
  branch: string;
  family: string;
  date: string;
}

export function ReportWrongForecastButton({ branch, family, date }: ReportWrongForecastButtonProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  async function handleSubmit() {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) {
      setError("Enter a valid number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiJson("/api/actuals", {
        method: "POST",
        body: JSON.stringify({
          branchId: branch,
          family,
          date,
          actualSales: parsed,
          source: "manual",
        }),
      });
      setOpen(false);
      setValue("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        style={{
          padding: "3px 8px",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          background: "none",
          cursor: "pointer",
          fontSize: "0.75rem",
          color: saved ? "var(--accent-good)" : "var(--ink-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {saved ? "Saved" : "Report actual"}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 20,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
            padding: "12px",
            width: "200px",
          }}
        >
          <p style={{ fontSize: "0.75rem", color: "var(--ink-muted)", marginBottom: "8px" }}>
            Actual sales for <strong>{family}</strong>
          </p>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="number"
              min={0}
              autoFocus
              placeholder="qty"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") setOpen(false);
              }}
              style={{
                flex: 1,
                padding: "4px 8px",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.875rem",
                color: "var(--ink)",
                background: "var(--surface)",
                minWidth: 0,
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: "4px 10px",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "var(--brand-500)",
                color: "white",
                fontWeight: 600,
                fontSize: "0.8125rem",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "..." : "OK"}
            </button>
          </div>
          {error && (
            <p style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--accent-warn)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
