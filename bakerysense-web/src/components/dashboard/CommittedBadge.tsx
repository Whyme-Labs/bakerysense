// Server-rendered badge shown after the operator commits a bake plan for
// a (branch, family, date). The badge stays visible until the row is
// re-committed (which overwrites it). The dashboard server fetch joins
// commit rows by family before rendering so the badge appears in the
// right SKU rows on initial paint.
//
// The actual fetch happens in the dashboard page; this component is a
// pure presentational wrapper so it stays tree-shakeable.
const KIND_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
  custom: "Custom",
};

const KIND_COLOR: Record<string, string> = {
  conservative: "bg-amber-100 text-amber-800",
  balanced: "bg-emerald-100 text-emerald-800",
  aggressive: "bg-blue-100 text-blue-800",
  custom: "bg-gray-100 text-gray-800",
};

interface Props {
  optionKind: string;
  bakeQuantity: number;
  committedAt: number;
}

export function CommittedBadge({ optionKind, bakeQuantity, committedAt }: Props) {
  const time = new Date(committedAt).toISOString().slice(11, 16);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded px-2 py-0.5 text-xs font-medium ${KIND_COLOR[optionKind] ?? "bg-gray-100 text-gray-800"}`}
      data-testid="committed-badge"
      title={`Committed at ${time} UTC`}
    >
      <span aria-hidden>✓</span>
      {KIND_LABEL[optionKind] ?? optionKind} · bake {bakeQuantity}
    </span>
  );
}
