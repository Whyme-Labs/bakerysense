import type { ActivePointer, VersionEntry, RetrainState } from "@/lib/model-pointer";

interface Props {
  active: ActivePointer | null;
  versions: VersionEntry[];
  state: RetrainState;
}

const STATUS_COLORS: Record<RetrainState["status"], string> = {
  idle: "bg-gray-100 text-gray-700",
  queued: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  awaiting_publish: "bg-purple-100 text-purple-800",
  published: "bg-green-100 text-green-800",
  aborted: "bg-red-100 text-red-700",
};

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmt(n: number | undefined): string {
  return n !== undefined ? n.toFixed(3) : "—";
}

export function RetrainingHistory({ active, versions, state }: Props) {
  return (
    <div className="space-y-6">
      {/* Active model card */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">
          Active model
        </h3>
        {active === null ? (
          <p className="text-sm text-[var(--ink-muted)]">
            No active model published yet — the seed model is in use.
          </p>
        ) : (
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-[var(--ink-subtle)]">Version</span>
              <p className="font-medium">{active.version}</p>
            </div>
            <div>
              <span className="text-[var(--ink-subtle)]">Trained</span>
              <p className="font-medium">{formatDate(active.trainedAt)}</p>
            </div>
            <div>
              <span className="text-[var(--ink-subtle)]">Rolling MAE</span>
              <p className="font-medium">{fmt(active.rollingMae)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Retrain state panel */}
      <div className="flex items-start gap-3">
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${STATUS_COLORS[state.status]}`}
        >
          {state.status.replace(/_/g, " ")}
        </span>
        {state.reason && (
          <p className="text-sm text-[var(--ink-muted)]">{state.reason}</p>
        )}
      </div>

      {/* Versions table */}
      {versions.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No retrain history yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">
                <th className="pb-2 pr-4">Version</th>
                <th className="pb-2 pr-4">Trained</th>
                <th className="pb-2 pr-4">Rolling MAE</th>
                <th className="pb-2">Rolling WAPE</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr
                  key={v.version}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="py-2 pr-4 font-medium">{v.version}</td>
                  <td className="py-2 pr-4 text-[var(--ink-muted)]">{formatDate(v.trainedAt)}</td>
                  <td className="py-2 pr-4 text-[var(--ink-muted)]">{fmt(v.metrics?.rollingMae)}</td>
                  <td className="py-2 text-[var(--ink-muted)]">{fmt(v.metrics?.rollingWape)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
