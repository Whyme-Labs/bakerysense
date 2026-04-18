import { describe, it, expect } from "vitest";
import { shapeRequest } from "@/lib/llm/presets";

describe("presets.shapeRequest", () => {
  it("openrouter adds referer + title headers", () => {
    const r = shapeRequest("openrouter", {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "google/gemma-4-e4b-it",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxTokens: 256,
      temperature: 0.2,
      stop: ["<turn|>"],
    });
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r.extraHeaders?.["http-referer"]).toBe("https://bakerysense.app");
    expect((r.body as any).model).toBe("google/gemma-4-e4b-it");
    expect((r.body as any).stop).toContain("<turn|>");
    expect((r.body as any).tools).toBeUndefined();    // no tools given
  });

  it("generic OpenAI-compatible endpoint has no extra headers", () => {
    const r = shapeRequest("openai", {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5",
      messages: [], tools: [], maxTokens: 100, temperature: 0.2, stop: [],
    });
    expect(r.extraHeaders).toBeUndefined();
  });

  it("includes tools + tool_choice when tools given", () => {
    const r = shapeRequest("openrouter", {
      baseUrl: "https://openrouter.ai/api/v1",
      model: "m",
      messages: [], tools: [{ type: "function", function: { name: "f", description: "", parameters: {} } }],
      maxTokens: 100, temperature: 0.2, stop: [],
    });
    expect((r.body as any).tools).toHaveLength(1);
    expect((r.body as any).tool_choice).toBe("auto");
  });

  it("trailing slash in baseUrl normalized", () => {
    const r = shapeRequest("openrouter", {
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "m", messages: [], tools: [], maxTokens: 100, temperature: 0.2, stop: [],
    });
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });
});
