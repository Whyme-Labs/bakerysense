import type { PresetId } from "./presets";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: ToolCallInvocation[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallInvocation {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatResponse {
  content: string | null;
  tool_calls: ToolCallInvocation[];
  finish_reason: "stop" | "tool_calls" | "length" | "error";
  raw: unknown;
}

export interface LLMClientOpts {
  preset: PresetId;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  maxTokens?: number;
  temperature?: number;
}

export class LLMClient {
  constructor(private readonly opts: LLMClientOpts) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const { shapeRequest } = await import("./presets");
    const req = shapeRequest(this.opts.preset, {
      baseUrl: this.opts.baseUrl,
      model: this.opts.model,
      messages,
      tools,
      maxTokens: this.opts.maxTokens ?? 1024,
      temperature: this.opts.temperature ?? 0.3,
      stop: ["<turn|>", "<tool_response>"],
    });
    const res = await fetch(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        ...(req.extraHeaders ?? {}),
      },
      body: JSON.stringify(req.body),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM ${this.opts.preset} ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await res.json()) as unknown;
    return normalizeResponse(payload);
  }
}

function normalizeResponse(p: unknown): ChatResponse {
  const obj = p as { choices?: Array<{ message?: { content?: string; tool_calls?: ToolCallInvocation[] }; finish_reason?: string }> };
  const choice = obj.choices?.[0];
  if (!choice) throw new Error("LLM response missing choices");
  const msg = choice.message ?? {};
  return {
    content: msg.content ?? null,
    tool_calls: (msg.tool_calls ?? []) as ToolCallInvocation[],
    finish_reason: (choice.finish_reason ?? "stop") as ChatResponse["finish_reason"],
    raw: p,
  };
}
