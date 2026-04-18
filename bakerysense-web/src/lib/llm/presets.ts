export type PresetId =
  | "openrouter" | "groq" | "together" | "openai"
  | "anthropic-via-oai" | "ollama-tunnel" | "cloudflare-ai" | "custom";

export interface ShapeArgs {
  baseUrl: string;
  model: string;
  messages: unknown[];
  tools: unknown[];
  maxTokens: number;
  temperature: number;
  stop: string[];
}

export interface ShapedRequest {
  url: string;
  body: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}

export function shapeRequest(preset: PresetId, args: ShapeArgs): ShapedRequest {
  const { baseUrl, model, messages, tools, maxTokens, temperature, stop } = args;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stop,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (preset === "openrouter") {
    return {
      url,
      body,
      extraHeaders: {
        "http-referer": "https://bakerysense.app",
        "x-title": "BakerySense",
      },
    };
  }
  return { url, body };
}
