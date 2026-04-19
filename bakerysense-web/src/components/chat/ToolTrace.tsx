"use client";

interface Props {
  name: string;
  args: unknown;
  result: unknown;
}

export function ToolTrace({ name, args, result }: Props) {
  return (
    <details className="rounded border border-[var(--border,#e5e7eb)] bg-[var(--surface-muted,#f9fafb)] text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 font-mono font-medium text-[var(--foreground-muted,#6b7280)] hover:text-[var(--foreground,#111827)]">
        {`-> ${name}`}
      </summary>
      <div className="border-t border-[var(--border,#e5e7eb)] px-3 py-2 space-y-2">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted,#9ca3af)]">
            Arguments
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[var(--foreground,#111827)]">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground-muted,#9ca3af)]">
            Result
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[var(--foreground,#111827)]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  );
}
