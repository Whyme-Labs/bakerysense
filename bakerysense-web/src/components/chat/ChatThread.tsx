"use client";
import { useEffect, useState, useRef } from "react";
import { apiJson } from "@/lib/api-client";
import { subscribe, type SSEEvent } from "@/lib/sse";
import { MessageBubble } from "./MessageBubble";
import { ToolTrace } from "./ToolTrace";
import { PromptInput } from "./PromptInput";
import { TurnStatus } from "./TurnStatus";

interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  tool?: { name: string; args: unknown; result: unknown };
}

interface TurnCreate {
  sessionId: string;
  turnId: string;
  streamUrl: string;
}

function activityFor(status: string, messages: Message[]): string | undefined {
  if (status === "posting") return "Queuing your question on chat-queue…";
  if (status !== "streaming") return undefined;
  const lastTool = [...messages].reverse().find((m) => m.role === "tool")?.tool;
  if (!lastTool) return "Gemma is reading the system prompt and deciding which tool to call first.";
  const lastIdx = messages.map((m) => m.role).lastIndexOf("tool");
  const toolCount = messages.filter((m) => m.role === "tool").length;
  const hasAssistant = messages.some((m) => m.role === "assistant");
  if (hasAssistant) return "Drafting a short, plain-language answer grounded in the tool results.";
  if (lastIdx === messages.length - 1) {
    return `Ran \`${lastTool.name}\` (call ${toolCount}). Reading the result and deciding what to do next.`;
  }
  return `Last tool: \`${lastTool.name}\`. Composing the next step.`;
}

export function ChatThread({ branchId, prefill }: { branchId: string; prefill?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnStatus, setTurnStatus] = useState<string>("idle");
  const unsubRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefill) void send(prefill);
    return () => unsubRef.current?.();
  }, []);

  // Keep the latest tool-trace / assistant bubble in view as SSE events arrive.
  // Without this, new messages accumulate below the fold and the viewer only
  // ever sees the first user bubble + a "…" placeholder.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, turnStatus]);

  async function send(text: string) {
    setMessages((m) => [...m, { role: "user", content: text }]);
    setTurnStatus("posting");
    const body = JSON.stringify({ message: text, branchId, sessionId: sessionId ?? undefined });
    const turn = await apiJson<TurnCreate>("/api/chat", { method: "POST", body });
    if (!sessionId) setSessionId(turn.sessionId);
    setTurnStatus("streaming");
    unsubRef.current?.();
    unsubRef.current = subscribe(turn.streamUrl, (ev: SSEEvent) => {
      if (ev.type === "tool_call") {
        setMessages((m) => [
          ...m,
          {
            role: "tool",
            content: "",
            tool: {
              name: String(ev.name),
              args: ev.arguments,
              result: ev.result,
            },
          },
        ]);
      } else if (ev.type === "answer") {
        setMessages((m) => [...m, { role: "assistant", content: String(ev.content ?? "") }]);
      } else if (ev.type === "final") {
        setTurnStatus("done");
        unsubRef.current?.();
      }
    });
  }

  const activity = activityFor(turnStatus, messages);

  return (
    <div className="flex h-[70vh] flex-col rounded-lg border border-[var(--border)] bg-white">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) =>
          m.role === "tool" && m.tool ? (
            <ToolTrace key={i} name={m.tool.name} args={m.tool.args} result={m.tool.result} />
          ) : (
            <MessageBubble key={i} role={m.role as "user" | "assistant"} content={m.content} />
          ),
        )}
        <TurnStatus status={turnStatus} activity={activity} />
      </div>
      <PromptInput
        onSend={send}
        disabled={turnStatus === "streaming" || turnStatus === "posting"}
      />
    </div>
  );
}
