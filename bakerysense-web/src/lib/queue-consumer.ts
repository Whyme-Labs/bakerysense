import type { MessageBatch } from "@cloudflare/workers-types";
import { handleRetrainMessage, type RetrainJob } from "./retrain";
import { LLMClient, type ChatMessage, type ToolSchema } from "./llm/client";
import { TOOL_SCHEMAS, dispatch, type ToolContext } from "./tools";
import {
  loadChatSession, saveChatSession,
  appendTurnEvent, updateTurnStatus,
} from "./chat-session";
import { getDefaultConnector, resolveUpstreamCredential } from "./connector";
import { compact, shouldCompact } from "./compactor";
import { approxMessagesTokens } from "./llm/tokens";

interface QueueMessage {
  sessionId: string;
  turnId: string;
  tenantId: string;
  userId: string;
  branchId: string | null;
  userMessage: string;
  permittedBranches: string[] | null;
}

const MAX_TURN_ROUNDS = 4;
const MAX_SESSION_ROUNDS = 15;
const COMPACT_TRIGGER_TOKENS = 60_000;
const TRAINED_QUANTILES = [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9];

export default {
  async queue(batch: MessageBatch<QueueMessage | RetrainJob>, env: CloudflareEnv): Promise<void> {
    if (batch.queue === "retrain-queue" || batch.queue === "retrain-queue-test") {
      for (const msg of batch.messages) {
        try {
          await handleRetrainMessage(env, msg.body as RetrainJob);
          msg.ack();
        } catch (e) {
          console.error("retrain_message_failed", (e as Error).message);
          msg.retry();
        }
      }
      return;
    }
    // Existing chat path unchanged
    for (const msg of batch.messages) {
      try {
        await runTurn(env, msg.body as QueueMessage);
        msg.ack();
      } catch (e) {
        const body = msg.body as QueueMessage;
        try {
          await updateTurnStatus(env, body.sessionId, body.turnId, {
            status: "failed", error: (e as Error).message,
          });
          await appendTurnEvent(env, body.sessionId, body.turnId, {
            type: "error", message: (e as Error).message,
          });
        } catch { /* best-effort */ }
        msg.retry();
      }
    }
  },
};

async function runTurn(env: CloudflareEnv, body: QueueMessage): Promise<void> {
  const { sessionId, turnId, tenantId, userId, branchId, userMessage, permittedBranches } = body;
  await updateTurnStatus(env, sessionId, turnId, { status: "running" });

  const session = await loadChatSession(env, sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const connector = await getDefaultConnector(env, tenantId);
  if (!connector) throw new Error("no default connector for tenant");
  const apiKey = await resolveUpstreamCredential(env, connector);

  const client = new LLMClient({
    preset: connector.preset,
    baseUrl: connector.baseUrl,
    model: connector.model,
    apiKey,
  });

  // Append the user message to the persisted session
  session.messages.push({ role: "user", content: userMessage });

  // Compaction gate
  if (shouldCompact(session.messages, COMPACT_TRIGGER_TOKENS)) {
    const r = compact(session.messages, { stateSummary: session.stateSummary ?? "" });
    session.messages = r.messages;
    session.stateSummary = r.stateSummary;
    await appendTurnEvent(env, sessionId, turnId, {
      type: "compaction",
      tokens_after: approxMessagesTokens(session.messages),
    });
  }

  const ctx: ToolContext = {
    env, tenantId, userId,
    permittedBranches, defaultBranchId: branchId,
    costRatio: { cu: 2, co: 1 },
    quantiles: TRAINED_QUANTILES,
  };

  let rounds = 0;
  while (rounds < MAX_TURN_ROUNDS && session.toolRoundsUsed < MAX_SESSION_ROUNDS) {
    const messagesForLLM = prependSystemIfNeeded(session, ctx);
    const res = await client.chat(messagesForLLM, TOOL_SCHEMAS as unknown as ToolSchema[]);

    // Plain assistant response (no tool calls): this is the final answer.
    if ((!res.tool_calls || res.tool_calls.length === 0) && res.content) {
      const cleaned = stripThoughts(res.content);
      session.messages.push({ role: "assistant", content: cleaned });
      await appendTurnEvent(env, sessionId, turnId, { type: "answer", content: cleaned });
      await updateTurnStatus(env, sessionId, turnId, { status: "done", finalAnswer: cleaned });
      await saveChatSession(env, session);
      return;
    }

    // Handle tool calls (may be multiple per turn — Gemma 4 can emit parallel calls).
    if (res.tool_calls && res.tool_calls.length > 0) {
      const toolResultMessages: ChatMessage[] = [];
      for (const call of res.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
        const sanitizedArgs = sanitizeIn(args);
        const result = await dispatch(call.function.name, sanitizedArgs, ctx);
        const sanitizedResult = sanitizeOut(result);
        await appendTurnEvent(env, sessionId, turnId, {
          type: "tool_call",
          name: call.function.name,
          arguments: sanitizedArgs,
          result: sanitizedResult,
        });
        toolResultMessages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(sanitizedResult),
        });
      }

      // Persist the assistant-with-tool-calls message AND all tool results for the next loop iteration.
      session.messages.push({
        role: "assistant",
        content: null,
        tool_calls: res.tool_calls,
      });
      session.messages.push(...toolResultMessages);

      session.toolRoundsUsed++;
      rounds++;
      continue;
    }

    // Neither content nor tool_calls — stop gracefully.
    break;
  }

  // Cap reached
  const fallback = "I couldn't finish that within the allotted tool rounds. Try a more specific question.";
  session.messages.push({ role: "assistant", content: fallback });
  await appendTurnEvent(env, sessionId, turnId, { type: "answer", content: fallback });
  await updateTurnStatus(env, sessionId, turnId, { status: "done", finalAnswer: fallback });
  await saveChatSession(env, session);
}

function prependSystemIfNeeded(session: { messages: ChatMessage[] }, ctx: ToolContext): ChatMessage[] {
  if (session.messages.some((m) => m.role === "system")) return session.messages;
  const branches = ctx.permittedBranches ? ctx.permittedBranches.join(", ") : "all";
  const sys: ChatMessage = {
    role: "system",
    content:
      `<|think|>You are BakerySense, an AI copilot for a retail chain. ` +
      `Call tools to ground every numeric claim. Never invent quantities. ` +
      `When a tool returns an empty result, the answer is "no action needed". ` +
      `Dates are ISO YYYY-MM-DD. ` +
      `Branches accessible to this user: ${branches}.`,
  };
  return [sys, ...session.messages];
}

function stripThoughts(s: string): string {
  // Strip Gemma's channel/thought blocks from stored history (§6.0 rule 4).
  return s.replace(/<\|channel\|thought[^>]*>[\s\S]*?<\|\/thought\|>/g, "").trim();
}

function sanitizeIn(args: unknown): unknown {
  if (args && typeof args === "object") return JSON.parse(JSON.stringify(args));
  return args;
}

function sanitizeOut(result: unknown): unknown {
  // Escape Gemma special tokens in any string value so tool output cannot inject control tokens.
  const walk = (o: unknown): unknown => {
    if (typeof o === "string") {
      return o
        .replaceAll("<turn|>", "<turn_>")
        .replaceAll("<tool_response>", "<tool_resp_>")
        .replaceAll("<|think|>", "<think_>");
    }
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return o;
  };
  return walk(result);
}
