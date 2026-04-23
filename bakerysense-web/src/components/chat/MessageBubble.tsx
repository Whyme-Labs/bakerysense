interface Props {
  role: "user" | "assistant";
  content: string;
}

// Minimal markdown: **bold** and `code` only. Gemma occasionally emits both.
// Output renders only string fragments and React elements, never raw HTML.
function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={key++} className="font-semibold">{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<code key={key++} className="rounded bg-black/10 px-1 font-mono text-[0.9em]">{match[2]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function MessageBubble({ role, content }: Props) {
  const isUser = role === "user";
  return (
    <div data-testid={`message-bubble-${role}`} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted,#6b7280)]">
        {isUser ? "You" : "Assistant"}
      </span>
      <div
        className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--brand-100,#dbeafe)] text-[var(--foreground,#111827)]"
            : "bg-[var(--surface-muted,#f3f4f6)] text-[var(--foreground,#111827)]"
        }`}
      >
        {renderMarkdown(content)}
      </div>
    </div>
  );
}
