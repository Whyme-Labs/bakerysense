import { randomBytes } from "@noble/hashes/utils.js";
import { base64url } from "@scure/base";
import type { ChatMessage } from "./llm/client";

const TTL_7D = 7 * 24 * 60 * 60;
const TTL_1H = 60 * 60;

export interface ChatSession {
  sessionId: string;
  tenantId: string;
  userId: string;
  branchId: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  stateSummary?: string;
  toolRoundsUsed: number;
}

export interface TurnState {
  turnId: string;
  sessionId: string;
  status: "queued" | "running" | "done" | "failed";
  events: Array<{ type: string; [k: string]: unknown }>;
  finalAnswer?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export function newSessionId(): string {
  return "s_" + base64url.encode(randomBytes(12));
}

export function newTurnId(): string {
  return "t_" + base64url.encode(randomBytes(9));
}

export async function createChatSession(
  env: CloudflareEnv,
  rec: { tenantId: string; userId: string; branchId: string | null },
): Promise<ChatSession> {
  const sessionId = newSessionId();
  const now = Date.now();
  const s: ChatSession = {
    sessionId, ...rec,
    createdAt: now, updatedAt: now,
    messages: [], toolRoundsUsed: 0,
  };
  await env.KV.put(`chat:session:${sessionId}`, JSON.stringify(s), { expirationTtl: TTL_7D });
  await env.KV.put(`chat:user:${rec.userId}:${sessionId}`, JSON.stringify({ createdAt: now }), { expirationTtl: TTL_7D });
  await env.KV.put(`chat:tenant:${rec.tenantId}:${sessionId}`, JSON.stringify({ createdAt: now }), { expirationTtl: TTL_7D });
  return s;
}

export async function loadChatSession(env: CloudflareEnv, sessionId: string): Promise<ChatSession | null> {
  const raw = await env.KV.get(`chat:session:${sessionId}`);
  return raw ? (JSON.parse(raw) as ChatSession) : null;
}

export async function saveChatSession(env: CloudflareEnv, s: ChatSession): Promise<void> {
  s.updatedAt = Date.now();
  await env.KV.put(`chat:session:${s.sessionId}`, JSON.stringify(s), { expirationTtl: TTL_7D });
}

export async function createTurn(env: CloudflareEnv, sessionId: string): Promise<TurnState> {
  const turnId = newTurnId();
  const now = Date.now();
  const t: TurnState = {
    turnId, sessionId,
    status: "queued", events: [],
    startedAt: now, updatedAt: now,
  };
  await env.KV.put(`chat:turn:${sessionId}:${turnId}`, JSON.stringify(t), { expirationTtl: TTL_1H });
  return t;
}

export async function appendTurnEvent(
  env: CloudflareEnv, sessionId: string, turnId: string,
  event: { type: string; [k: string]: unknown },
): Promise<void> {
  const key = `chat:turn:${sessionId}:${turnId}`;
  const raw = await env.KV.get(key);
  if (!raw) return;
  const t = JSON.parse(raw) as TurnState;
  t.events.push(event);
  t.updatedAt = Date.now();
  await env.KV.put(key, JSON.stringify(t), { expirationTtl: TTL_1H });
}

export async function updateTurnStatus(
  env: CloudflareEnv, sessionId: string, turnId: string,
  patch: Partial<Pick<TurnState, "status" | "finalAnswer" | "error">>,
): Promise<void> {
  const key = `chat:turn:${sessionId}:${turnId}`;
  const raw = await env.KV.get(key);
  if (!raw) return;
  const t = JSON.parse(raw) as TurnState;
  Object.assign(t, patch);
  t.updatedAt = Date.now();
  await env.KV.put(key, JSON.stringify(t), { expirationTtl: TTL_1H });
}

export async function loadTurn(
  env: CloudflareEnv, sessionId: string, turnId: string,
): Promise<TurnState | null> {
  const raw = await env.KV.get(`chat:turn:${sessionId}:${turnId}`);
  return raw ? (JSON.parse(raw) as TurnState) : null;
}
