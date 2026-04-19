interface Props {
  role: "user" | "assistant";
  content: string;
}

export function MessageBubble({ role, content }: Props) {
  const isUser = role === "user";
  return (
    <div data-testid={`message-bubble-${role}`} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted,#6b7280)]">
        {isUser ? "You" : "Assistant"}
      </span>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--brand-100,#dbeafe)] text-[var(--foreground,#111827)]"
            : "bg-[var(--surface-muted,#f3f4f6)] text-[var(--foreground,#111827)]"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
