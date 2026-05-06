"use client";

// Client-side three-options bake-plan panel. Fetches /api/forecast/plans on
// mount, renders one card per option per SKU, posts the operator's choice
// to /api/bake-plans/commit. Optimistic UI with explicit error toast on 4xx.
//
// Design choice: numeric outcomes (waste, stockout %) come from the
// simulation engine on the server; this component only RENDERS them. No
// math here.
import { useEffect, useState, useCallback } from "react";
import { CommittedBadge } from "./CommittedBadge";

interface Outcome {
  expectedWasteUnits: number;
  expectedStockoutProb: number;
  expectedUnitsSold: number;
}

interface Option {
  kind: "conservative" | "balanced" | "aggressive";
  bakeQuantity: number;
  outcome: Outcome;
}

interface SkuPlan {
  family: string;
  options: { conservative: Option; balanced: Option; aggressive: Option };
  forecastSnapshotId: string | null;
}

interface CommittedRow {
  family: string;
  optionKind: string;
  bakeQuantity: number;
  committedAt: number;
}

interface Props {
  branchId: string;
  date: string;
  csrfToken: string;
  initialCommitted: CommittedRow[];
}

const KIND_ORDER: Array<keyof SkuPlan["options"]> = ["conservative", "balanced", "aggressive"];

const KIND_STYLE: Record<string, { tint: string; ring: string }> = {
  conservative: { tint: "bg-amber-50", ring: "ring-amber-300" },
  balanced:     { tint: "bg-emerald-50", ring: "ring-emerald-400" },
  aggressive:   { tint: "bg-blue-50", ring: "ring-blue-300" },
};

function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function PlanOptions({ branchId, date, csrfToken, initialCommitted }: Props) {
  const [plans, setPlans] = useState<SkuPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Map<string, CommittedRow>>(
    () => new Map(initialCommitted.map((r) => [r.family, r])),
  );
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const url = `/api/forecast/plans?branch=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`;
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`plans ${r.status}`);
        return r.json() as Promise<{ plans: SkuPlan[] }>;
      })
      .then((j) => setPlans(j.plans))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [branchId, date]);

  const commit = useCallback(
    async (family: string, opt: Option, snapshotId: string | null) => {
      setSubmitting((s) => ({ ...s, [family]: true }));
      try {
        const res = await fetch("/api/bake-plans/commit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          credentials: "include",
          body: JSON.stringify({
            branchId,
            family,
            date,
            optionKind: opt.kind,
            bakeQuantity: opt.bakeQuantity,
            forecastSnapshotId: snapshotId,
            expected: {
              wasteUnits: opt.outcome.expectedWasteUnits,
              stockoutProb: opt.outcome.expectedStockoutProb,
              unitsSold: opt.outcome.expectedUnitsSold,
            },
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `commit ${res.status}`);
        }
        setCommitted((m) => {
          const next = new Map(m);
          next.set(family, {
            family,
            optionKind: opt.kind,
            bakeQuantity: opt.bakeQuantity,
            committedAt: Date.now(),
          });
          return next;
        });
      } catch (e) {
        setError(`Commit failed for ${family}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSubmitting((s) => ({ ...s, [family]: false }));
      }
    },
    [branchId, date, csrfToken],
  );

  if (loading) {
    return (
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-white p-6">
        <p className="text-sm text-[var(--ink-muted)]">Computing plans…</p>
      </section>
    );
  }
  if (error && plans.length === 0) {
    return (
      <section className="mb-6 rounded-lg border border-red-300 bg-red-50 p-6">
        <p className="text-sm text-red-700">{error}</p>
      </section>
    );
  }
  if (plans.length === 0) return null;

  return (
    <section className="mb-8" data-testid="plan-options-panel">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
            Three plans per SKU
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Pick a plan to commit. Numbers are expected outcomes from the quantile forecast under your cost ratio.
          </p>
        </div>
        {error && plans.length > 0 && (
          <p className="text-xs text-red-700" role="alert">{error}</p>
        )}
      </div>

      <div className="space-y-4">
        {plans.map((p) => {
          const c = committed.get(p.family);
          return (
            <div key={p.family} className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-sm)]">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium">{p.family}</h3>
                {c && (
                  <CommittedBadge
                    optionKind={c.optionKind}
                    bakeQuantity={c.bakeQuantity}
                    committedAt={c.committedAt}
                  />
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {KIND_ORDER.map((kind) => {
                  const opt = p.options[kind];
                  const isCommitted = c?.optionKind === kind;
                  const style = KIND_STYLE[kind];
                  return (
                    <div
                      key={kind}
                      className={`flex flex-col rounded-md p-3 ring-1 ${style.tint} ${isCommitted ? `ring-2 ${style.ring}` : "ring-[var(--border)]"}`}
                      data-testid={`plan-option-${kind}`}
                    >
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">
                          {kind}
                        </span>
                        <span className="text-2xl font-semibold tabular-nums">{opt.bakeQuantity}</span>
                      </div>
                      <dl className="space-y-1 text-xs text-[var(--ink-muted)]">
                        <div className="flex justify-between">
                          <dt>Expected waste</dt>
                          <dd className="tabular-nums">{Math.round(opt.outcome.expectedWasteUnits)} units</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Stockout chance</dt>
                          <dd className="tabular-nums">{formatPct(opt.outcome.expectedStockoutProb)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Expected sold</dt>
                          <dd className="tabular-nums">{Math.round(opt.outcome.expectedUnitsSold)} units</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="mt-3 rounded bg-[var(--accent-info)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                        disabled={submitting[p.family] || isCommitted}
                        onClick={() => commit(p.family, opt, p.forecastSnapshotId)}
                        data-testid={`commit-${kind}`}
                      >
                        {isCommitted ? "Committed" : submitting[p.family] ? "…" : "Commit"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
