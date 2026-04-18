import { describe, it, expect } from "vitest";
import { approxTokens, approxMessagesTokens } from "@/lib/llm/tokens";

describe("token counting", () => {
  it("empty string = 0 tokens", () => {
    expect(approxTokens("")).toBe(0);
  });
  it("short string ≈ chars/3.5 (rounded up)", () => {
    expect(approxTokens("hello")).toBe(Math.ceil(5 / 3.5));
  });
  it("long string scales", () => {
    const s = "x".repeat(350);
    expect(approxTokens(s)).toBe(100);
  });
  it("approxMessagesTokens sums per-message overhead + content", () => {
    const n = approxMessagesTokens([
      { role: "user", content: "hello there" },
      { role: "assistant", content: "hi!" },
    ]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(30);
  });
  it("handles null content", () => {
    expect(approxMessagesTokens([{ role: "assistant", content: null as any }])).toBeGreaterThanOrEqual(0);
  });
});
