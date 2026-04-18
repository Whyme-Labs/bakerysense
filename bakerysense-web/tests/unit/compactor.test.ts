import { describe, it, expect } from "vitest";
import { shouldCompact, compact } from "@/lib/compactor";
import type { ChatMessage } from "@/lib/llm/client";

describe("compactor", () => {
  it("does not compact when below threshold", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(shouldCompact(msgs, 60_000)).toBe(false);
  });

  it("compacts when above threshold — preserves system + last 3 user/assistant pairs", () => {
    const long = "x".repeat(280_000);   // ≈ 80K tokens
    const msgs: ChatMessage[] = [
      { role: "system", content: "you are a bot" },
      { role: "user", content: "old q1" },
      { role: "assistant", content: long },
      { role: "user", content: "q2" }, { role: "assistant", content: "a2" },
      { role: "user", content: "q3" }, { role: "assistant", content: "a3" },
      { role: "user", content: "q4" }, { role: "assistant", content: "a4" },
    ];
    expect(shouldCompact(msgs, 60_000)).toBe(true);
    const { messages, stateSummary } = compact(msgs, { stateSummary: "prior: none" });
    expect(messages[0].role).toBe("system");
    const recent = messages.slice(-6).map((m) => m.content);
    expect(recent).toEqual(["q2", "a2", "q3", "a3", "q4", "a4"]);
    expect(stateSummary).toContain("compacted");
  });

  it("deterministic on the same input", () => {
    const msgs: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant", content: `turn ${i}`,
    } as ChatMessage));
    const a = compact(msgs, { stateSummary: "" });
    const b = compact(msgs, { stateSummary: "" });
    expect(a).toEqual(b);
  });
});
