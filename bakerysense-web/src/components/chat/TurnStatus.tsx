interface Props {
  status: string;
}

export function TurnStatus({ status }: Props) {
  if (status === "idle" || status === "done") return null;
  return (
    <p className="text-xs text-[var(--foreground-muted,#9ca3af)] italic">
      {status === "posting" ? "Sending..." : status === "streaming" ? "..." : status}
    </p>
  );
}
