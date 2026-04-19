"use client";

import { useRef } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function PromptInput({ onSend, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = textareaRef.current?.value.trim();
    if (!value) return;
    onSend(value);
    if (textareaRef.current) textareaRef.current.value = "";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const value = textareaRef.current?.value.trim();
      if (!value) return;
      onSend(value);
      if (textareaRef.current) textareaRef.current.value = "";
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-[var(--border,#e5e7eb)] p-3"
    >
      <textarea
        ref={textareaRef}
        rows={2}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        placeholder="Ask a question... (Ctrl+Enter to send)"
        data-testid="prompt-input"
        className="flex-1 resize-none rounded-md border border-[var(--border,#e5e7eb)] bg-white px-3 py-2 text-sm text-[var(--foreground,#111827)] placeholder-[var(--foreground-muted,#9ca3af)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-500,#3b82f6)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled}
        data-testid="prompt-submit"
        className="rounded-md bg-[var(--brand-500,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-600,#2563eb)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
