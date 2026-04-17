"""Chat session loop with tool calling.

Runs the agentic loop:

    user message
    -> Gemma emits message OR tool_call
    -> if tool_call, run tool, append result, loop
    -> once Gemma emits a plain message, return to user

Bounded by ``max_tool_rounds`` so a confused model cannot spin forever.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date

from bakerysense.agent.prompts import SYSTEM_PROMPT, today_banner
from bakerysense.agent.server import GemmaServer
from bakerysense.agent.state import AgentState
from bakerysense.agent.tools import TOOL_SCHEMAS, dispatch
from bakerysense.agent.vision import count_units_from_photo


@dataclass
class ChatSession:
    state: AgentState
    server: GemmaServer
    max_tool_rounds: int = 4
    messages: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.messages:
            last_date_iso = self.state.last_date.date().isoformat()
            today_iso = date.today().isoformat()
            system = SYSTEM_PROMPT + "\n\n" + today_banner(today_iso, last_date_iso)
            self.messages = [{"role": "system", "content": system}]

    # ------------------------------------------------------------------ ask
    def ask(self, user_message: str, verbose_tools: bool = False) -> str:
        self.messages.append({"role": "user", "content": user_message})

        for _ in range(self.max_tool_rounds + 1):
            response = self.server.chat(self.messages, tools=TOOL_SCHEMAS)
            choice = response["choices"][0]["message"]
            tool_calls = choice.get("tool_calls") or []

            # Persist the assistant turn (with or without tool calls).
            self.messages.append({
                "role": "assistant",
                "content": choice.get("content") or "",
                "tool_calls": tool_calls,
            })

            if not tool_calls:
                return choice.get("content") or ""

            for call in tool_calls:
                fn = call["function"]
                name = fn["name"]
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = dispatch(self.state, name, args)
                if verbose_tools:
                    print(f"  [tool] {name}({args}) -> {json.dumps(result)[:200]}")
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id", name),
                    "name": name,
                    "content": json.dumps(result),
                })

        return "(reached max tool-call rounds without a final answer)"

    # ------------------------------------------------------- multimodal path
    def ask_with_photo(
        self,
        user_message: str,
        image_path: str,
        verbose_tools: bool = False,
    ) -> str:
        """Run a vision pass, then inject the resulting counts into the next turn.

        The photo → structured counts step is deterministic from the loop's
        point of view: Gemma's vision returns a JSON count map, we append it
        to the user message as context, and the normal tool-calling loop
        handles everything downstream.
        """
        result = count_units_from_photo(
            server=self.server,
            image_path=image_path,
            known_skus=self.state.skus(),
        )
        if verbose_tools:
            print(f"  [vision] {image_path} -> {result.counts}")

        enriched = (
            f"{user_message}\n\n"
            f"[Display-case photo analysed — Gemma counted the following "
            f"remaining units: {json.dumps(result.counts)}]"
        )
        return self.ask(enriched, verbose_tools=verbose_tools)
