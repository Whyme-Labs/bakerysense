import { describe, it, expect } from "vitest";
import { requestHash } from "@/lib/llm/replay";

describe("requestHash", () => {
  it("produces identical hash for identical requests", () => {
    const a = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user" as const, content: "hi" }], tools: [], temperature: 0.3 };
    const b = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user" as const, content: "hi" }], tools: [], temperature: 0.3 };
    expect(requestHash(a)).toBe(requestHash(b));
  });
  it("differs on content change", () => {
    const a = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user" as const, content: "hi" }], tools: [], temperature: 0.3 };
    const b = { ...a, messages: [{ role: "user" as const, content: "bye" }] };
    expect(requestHash(a)).not.toBe(requestHash(b));
  });
  it("is order-invariant on object keys", () => {
    const a = { preset: "openrouter", model: "x", messages: [{ role: "user" as const, content: "hi" }], tools: [], temperature: 0.3 };
    const b = { temperature: 0.3, tools: [], messages: [{ role: "user" as const, content: "hi" }], model: "x", preset: "openrouter" };
    expect(requestHash(a)).toBe(requestHash(b));
  });
  it("returns a 16-char hex string", () => {
    const a = { preset: "openrouter", model: "x", messages: [], tools: [], temperature: 0 };
    const h = requestHash(a);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
