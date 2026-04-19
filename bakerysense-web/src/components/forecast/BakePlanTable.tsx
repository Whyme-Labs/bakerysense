import Link from "next/link";
import { ConfidenceBar } from "./ConfidenceBar";
import { ReportWrongForecastButton } from "@/components/feedback/ReportWrongForecastButton";
import { QualityBadge } from "@/components/feedback/QualityBadge";

interface ForecastRow {
  sku: string;
  bake_quantity: number;
  quantiles: Record<string, number>;
}

interface BakePlanTableProps {
  rows: ForecastRow[];
  slug: string;
  branch: string;
  onDate: string;
  wapeByFamily?: Map<string, { wape: number; sampleCount: number }>;
}

export function BakePlanTable({ rows, slug, branch, onDate, wapeByFamily }: BakePlanTableProps) {
  const max = Math.max(...rows.map((r) => r.quantiles["q0.9"] ?? 0), 1);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-muted)] text-left text-xs uppercase tracking-wider text-[var(--ink-subtle)]">
          <tr>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3 text-right tabular-nums">q0.5</th>
            <th className="px-4 py-3 text-right tabular-nums">q0.7</th>
            <th className="px-4 py-3">confidence</th>
            {wapeByFamily && <th className="px-4 py-3">7d WAPE</th>}
            <th className="px-4 py-3 text-right tabular-nums">bake</th>
            <th className="sr-only">actions</th>
            <th className="sr-only">report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const entry = wapeByFamily?.get(r.sku);
            return (
              <tr key={r.sku} data-testid={`row-sku-${r.sku}`}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]">
                <td className="px-4 py-3 font-medium text-[var(--ink)]">{r.sku}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(r.quantiles["q0.5"] ?? 0).toFixed(0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(r.quantiles["q0.7"] ?? 0).toFixed(0)}</td>
                <td className="px-4 py-3"><ConfidenceBar quantiles={r.quantiles} bakeQuantity={r.bake_quantity} max={max} /></td>
                {wapeByFamily && (
                  <td className="px-4 py-3">
                    <QualityBadge wape={entry?.wape ?? null} sampleCount={entry?.sampleCount ?? 0} />
                  </td>
                )}
                <td className="px-4 py-3 text-right text-lg font-semibold tabular-nums text-[var(--brand-700)]">{r.bake_quantity}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/t/${slug}/sku/${encodeURIComponent(r.sku)}?on_date=${onDate}`}
                        className="text-xs text-[var(--accent-info)] hover:underline">drivers →</Link>
                </td>
                <td className="px-4 py-3 text-right">
                  <ReportWrongForecastButton slug={slug} branch={branch} family={r.sku} date={onDate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
