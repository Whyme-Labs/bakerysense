import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ChatMessage, ChatResponse, ToolSchema } from "./client";

export interface ReplayRequest {
  preset: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  temperature: number;
}

function canonicalize(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonicalize).join(",") + "]";
  const keys = Object.keys(o as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((o as Record<string, unknown>)[k])).join(",") + "}";
}

export function requestHash(req: ReplayRequest): string {
  const canon = canonicalize(req);
  return bytesToHex(sha256(new TextEncoder().encode(canon))).slice(0, 16);
}

export async function readFixture(env: CloudflareEnv, hash: string): Promise<ChatResponse | null> {
  const obj = await env.MODELS.get(`fixtures/llm/${hash}.json`);
  if (!obj) return null;
  return JSON.parse(await obj.text()) as ChatResponse;
}

export async function writeFixture(env: CloudflareEnv, hash: string, response: ChatResponse): Promise<void> {
  await env.MODELS.put(`fixtures/llm/${hash}.json`, JSON.stringify(response, null, 2));
}
