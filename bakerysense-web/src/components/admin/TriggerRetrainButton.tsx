"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function TriggerRetrainButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function handleClick() {
    setPending(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/admin/retrain", { method: "POST" });
      if (res.status === 202) {
        setMessage({ text: "Retrain job queued.", error: false });
      } else {
        const body = await res.text();
        let msg = `Error ${res.status}`;
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch { /* use raw status */ }
        setMessage({ text: msg, error: true });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Request failed", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span
          className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}
        >
          {message.text}
        </span>
      )}
      <button
        data-testid="trigger-retrain-button"
        onClick={() => void handleClick()}
        disabled={pending}
        className="rounded px-3 py-1.5 text-xs font-medium border border-[var(--border)] bg-white hover:bg-[var(--surface-raised)] disabled:opacity-50"
      >
        {pending ? "Enqueuing..." : "Trigger retrain"}
      </button>
    </div>
  );
}
