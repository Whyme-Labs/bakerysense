interface Props {
  status: string;
  /** Human-readable subtext describing what Gemma is currently doing. */
  activity?: string;
}

const DOTS_CSS = `
@keyframes bs-pulse-dot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
.bs-dot { animation: bs-pulse-dot 1.2s infinite both; display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: currentColor; margin: 0 2px; }
.bs-dot:nth-child(2) { animation-delay: .15s; }
.bs-dot:nth-child(3) { animation-delay: .3s; }
@keyframes bs-shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
.bs-shimmer { background: linear-gradient(90deg, oklch(0.95 0.04 70) 0%, oklch(0.92 0.06 70) 50%, oklch(0.95 0.04 70) 100%); background-size: 400px 100%; animation: bs-shimmer 1.5s infinite linear; }
`;

function label(status: string): string {
  if (status === "posting") return "Connecting to Gemma";
  if (status === "streaming") return "Gemma is working";
  return status;
}

export function TurnStatus({ status, activity }: Props) {
  if (status === "idle" || status === "done") return null;
  return (
    <div data-testid="turn-status" className="flex flex-col gap-2 rounded-lg border border-[var(--border,#e5e7eb)] bg-[var(--brand-50,oklch(0.98_0.02_70))] p-3">
      <style>{DOTS_CSS}</style>
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--brand-700,oklch(0.52_0.13_60))]">
        <span aria-hidden>
          <span className="bs-dot" />
          <span className="bs-dot" />
          <span className="bs-dot" />
        </span>
        <span>{label(status)}</span>
      </div>
      {activity && (
        <p className="text-xs text-[var(--ink-muted,oklch(0.50_0.01_0))]">{activity}</p>
      )}
      <div className="bs-shimmer h-1 w-full rounded-full" aria-hidden />
    </div>
  );
}
