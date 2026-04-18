import type { ChatMessage } from "./llm/client";
import { approxMessagesTokens } from "./llm/tokens";

const KEEP_RECENT_PAIRS = 3;

export function shouldCompact(messages: ChatMessage[], thresholdTokens: number): boolean {
  return approxMessagesTokens(messages) > thresholdTokens;
}

export function compact(
  messages: ChatMessage[],
  opts: { stateSummary: string },
): { messages: ChatMessage[]; stateSummary: string } {
  const system = messages.find((m) => m.role === "system");
  const body = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const recent = body.slice(-KEEP_RECENT_PAIRS * 2);
  const older = body.slice(0, body.length - recent.length);
  const summary = summarize(older, opts.stateSummary);
  const kept: ChatMessage[] = [];
  if (system) kept.push(system);
  if (summary.length > 0) {
    kept.push({ role: "system", content: `Prior-conversation summary: ${summary}` });
  }
  kept.push(...recent);
  return { messages: kept, stateSummary: summary };
}

function summarize(older: ChatMessage[], prior: string): string {
  if (older.length === 0) return prior;
  const pairs: string[] = [];
  for (let i = 0; i < older.length - 1; i += 2) {
    const u = older[i], a = older[i + 1];
    if (u?.role !== "user" || a?.role !== "assistant") continue;
    const q = (u.content ?? "").slice(0, 80);
    const ans = (a.content ?? "").slice(0, 80);
    pairs.push(`Q: ${q}… → A: ${ans}…`);
  }
  return `compacted: ${prior ? `${prior}; ` : ""}${pairs.join(" | ")}`;
}
