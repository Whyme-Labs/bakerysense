"use client";

interface MarkdownItem {
  sku: string;
  remaining?: number;
  discount_pct: number;
  reason?: string;
}

interface MarkdownListProps {
  suggestions: MarkdownItem[];
}

export function MarkdownList({ suggestions }: MarkdownListProps) {
  if (!suggestions || suggestions.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        No markdowns suggested — inventory looks healthy.
      </p>
    );
  }

  return (
    <ul data-testid="markdown-list" className="flex flex-col gap-3">
      {suggestions.map((item) => (
        <li
          key={item.sku}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono font-semibold">{item.sku}</span>
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-800">
              -{item.discount_pct}% off
            </span>
          </div>
          {item.remaining !== undefined && (
            <p className="mt-1 text-xs text-[var(--ink-subtle)]">
              {item.remaining} unit{item.remaining !== 1 ? "s" : ""} remaining
            </p>
          )}
          {item.reason && (
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.reason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
