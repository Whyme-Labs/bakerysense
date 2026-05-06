// Decision lineage timeline — durable D1 source of truth.
//
// Sits below RetrainingHistory in /t/[slug]/admin/retraining and surfaces
// the model_versions + retrain_events tables. Where RetrainingHistory
// shows the runtime KV pointer (fast, ephemeral), this panel shows the
// durable lineage chain — useful for audits, SOC2 reporting, and "why
// did the forecast change overnight" debugging.
//
// Server component — receives pre-fetched rows from the page. Read-only,
// no client-side mutation.
export interface ModelVersionRow {
  id: string;
  modelKind: string;
  versionNumber: number;
  r2Key: string | null;
  parentModelId: string | null;
  trainedAt: number;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  trainingActualsCount: number;
  validationMetrics: Record<string, number> | null;
  status: string;
  activatedAt: number | null;
  supersededAt: number | null;
  notes: string | null;
  createdAt: number;
}

export interface RetrainEventRow {
  id: string;
  modelKind: string;
  triggeredBy: string;
  triggerMetric: string | null;
  triggerValue: string | null;
  triggerThreshold: string | null;
  outputModelId: string | null;
  parentModelId: string | null;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  status: string;
  statusMessage: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

interface Props {
  modelVersions: ModelVersionRow[];
  retrainEvents: RetrainEventRow[];
}

const MODEL_STATUS_COLOR: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-700",
  superseded: "bg-blue-100 text-blue-800",
  rolled_back: "bg-red-100 text-red-700",
};

const RETRAIN_STATUS_COLOR: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-700",
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  wape_breach: "WAPE breach",
  ops_force: "Ops forced",
  first_train: "First training",
};

function formatTs(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

function formatMetrics(m: Record<string, number> | null): string {
  if (!m) return "—";
  const parts: string[] = [];
  if (m.wape != null) parts.push(`WAPE ${m.wape.toFixed(3)}`);
  if (m.mase != null) parts.push(`MASE ${m.mase.toFixed(3)}`);
  if (m.rolling_mae != null) parts.push(`MAE ${m.rolling_mae.toFixed(2)}`);
  if (parts.length === 0) {
    // Fall back to first 2 keys in the JSON blob so the UI never silently hides metrics it doesn't recognise.
    const keys = Object.keys(m).slice(0, 2);
    return keys.map((k) => `${k} ${m[k].toFixed(3)}`).join(" · ") || "—";
  }
  return parts.join(" · ");
}

export function DecisionLineagePanel({ modelVersions, retrainEvents }: Props) {
  const hasAny = modelVersions.length > 0 || retrainEvents.length > 0;
  return (
    <section
      className="mb-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]"
      data-testid="decision-lineage-panel"
    >
      <div className="mb-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--ink-subtle)]">
          Decision lineage
        </h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Durable D1 record of every trained model and retrain attempt. Use this for audits and to trace why a particular forecast was served. The KV history above is the runtime fast path; this is the queryable source of truth.
        </p>
      </div>

      {!hasAny && (
        <p className="text-sm text-[var(--ink-muted)]" data-testid="lineage-empty">
          No lineage rows yet. Trigger a retrain to begin recording.
        </p>
      )}

      {modelVersions.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">
            Model versions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="model-versions-table">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                <tr>
                  <th className="py-2 pr-4">Version</th>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Trained</th>
                  <th className="py-2 pr-4">Window</th>
                  <th className="py-2 pr-4">Actuals</th>
                  <th className="py-2 pr-4">Metrics</th>
                </tr>
              </thead>
              <tbody>
                {modelVersions.map((v) => (
                  <tr key={v.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-4 font-mono">v{v.versionNumber}</td>
                    <td className="py-2 pr-4">{v.modelKind}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${MODEL_STATUS_COLOR[v.status] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs">{formatTs(v.trainedAt)}</td>
                    <td className="py-2 pr-4 text-xs">
                      {v.trainingWindowStart} → {v.trainingWindowEnd}
                    </td>
                    <td className="py-2 pr-4 text-xs">{v.trainingActualsCount.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-xs">{formatMetrics(v.validationMetrics)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {retrainEvents.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">
            Retrain events
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="retrain-events-table">
              <thead className="text-left text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                <tr>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Output</th>
                  <th className="py-2 pr-4">Detail</th>
                </tr>
              </thead>
              <tbody>
                {retrainEvents.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-4 text-xs">{formatTs(e.createdAt)}</td>
                    <td className="py-2 pr-4 text-xs">{TRIGGER_LABELS[e.triggeredBy] ?? e.triggeredBy}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${RETRAIN_STATUS_COLOR[e.status] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs font-mono">
                      {e.outputModelId ? e.outputModelId.slice(0, 12) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-[var(--ink-muted)]">
                      {e.statusMessage ??
                        (e.triggerMetric && e.triggerValue
                          ? `${e.triggerMetric}: ${e.triggerValue}${e.triggerThreshold ? ` (threshold ${e.triggerThreshold})` : ""}`
                          : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
