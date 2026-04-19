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
    console.log(`queue invoked: queue=${batch.queue} messages=${batch.messages.length}`);
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
      console.log(`chat_turn_start turnId=${(msg.body as QueueMessage).turnId} session=${(msg.body as QueueMessage).sessionId}`);
      try {
        await runTurn(env, msg.body as QueueMessage);
        console.log(`chat_turn_done turnId=${(msg.body as QueueMessage).turnId}`);
        msg.ack();
      } catch (e) {
        console.error(`chat_turn_failed turnId=${(msg.body as QueueMessage).turnId}:`, (e as Error).message, (e as Error).stack);
        const body = msg.body as QueueMessage;
        try {
          await updateTurnStatus(env, body.sessionId, body.turnId, {
            status: "failed", error: (e as Error).message,
          });
          await appendTurnEvent(env, body.sessionId, body.turnId, {
            type: "error", message: (e as Error).message,
          });
        } catch (inner) { console.error("status_update_failed:", (inner as Error).message); }
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
    env,
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
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const branchList = ctx.permittedBranches && ctx.permittedBranches.length > 0
    ? ctx.permittedBranches.join(", ")
    : "(user has tenant-wide access — always pass a specific branch id)";
  const defaultBranch = ctx.defaultBranchId
    ? `\nThe user is currently viewing branch_id="${ctx.defaultBranchId}" — pass this exact id to tool calls unless the user asks about a different branch.`
    : "";
  const sys: ChatMessage = {
    role: "system",
    content:
      `You are BakerySense, an AI copilot for a retail chain. ` +
      `Call tools to ground every numeric claim. Never invent quantities. ` +
      `When a tool returns an empty result, the answer is "no action needed". ` +
      `Dates are ISO YYYY-MM-DD. Today is ${today}; tomorrow is ${tomorrow}. ` +
      `Branch ids always start with "brn_" — never pass literals like "all" or "current".` +
      `\nBranches: ${branchList}.` +
      defaultBranch,
  };
  return [sys, ...session.messages];
}

function stripThoughts(s: string): string {
  // Gemma 4's chain-of-thought bleeds through in a few shapes:
  //   (a) leading `thought\n...reasoning...\n<channel|>actual answer`
  //   (b) `<|think|>...<|/think|>answer`
  //   (c) stray `<channel|>` / `<|anything|>` control tokens anywhere
  // Heuristic: if a `<channel|>` sentinel exists, everything before it is CoT;
  // keep everything after. Then nuke all remaining pseudo-tokens.
  let out = s;
  const channelIdx = out.lastIndexOf("<channel|>");
  if (channelIdx >= 0) out = out.slice(channelIdx + "<channel|>".length);
  out = out
    .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/g, "")
    .replace(/<\|?[a-z_/]+\|?>/gi, "")
    .replace(/^(thought|thinking)[\s\S]*?\n(?=\S)/i, "");
  return out.trim();
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
