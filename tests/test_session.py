"""ChatSession — verify the tool-calling loop shape against a mocked server.

We don't exercise Gemma here; we mock ``GemmaServer.chat`` so the loop's
plumbing (tool dispatch, message appending, bounded rounds) is tested
deterministically.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

from bakerysense.agent.session import ChatSession
from bakerysense.agent.state import AgentState
from bakerysense.forecaster import QuantileGBM


@pytest.fixture(scope="module")
def state(features, raw_bakery) -> AgentState:
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    model = QuantileGBM(
        quantiles=(0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9),
        num_boost_round=40,
    ).fit(train)
    return AgentState(model=model, features=features, raw=raw_bakery)


def _final_response(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


def _tool_call_response(name: str, args: dict) -> dict:
    return {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": f"call_{name}",
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)},
                }],
            }
        }]
    }


def test_loop_returns_first_plain_response(state):
    server = MagicMock()
    server.chat.return_value = _final_response("Bake 256 baguettes tomorrow.")
    session = ChatSession(state=state, server=server)
    answer = session.ask("How many baguettes?")
    assert "256" in answer
    # exactly one round: initial user → assistant
    assert server.chat.call_count == 1


def test_loop_executes_tool_then_answers(state):
    server = MagicMock()
    last = state.last_date.date().isoformat()
    server.chat.side_effect = [
        _tool_call_response("forecast", {"sku": "baguette", "on_date": last}),
        _final_response("Forecast received — bake 256."),
    ]
    session = ChatSession(state=state, server=server)
    answer = session.ask("How many baguettes for the last day?")

    # server saw two rounds: initial, then post-tool
    assert server.chat.call_count == 2
    # a tool-response message was appended before the second call
    final_messages = session.messages
    tool_messages = [m for m in final_messages if m.get("role") == "tool"]
    assert len(tool_messages) == 1
    tool_payload = json.loads(tool_messages[0]["content"])
    assert tool_payload["sku"] == "baguette"
    assert tool_payload["bake_quantity"] > 0
    assert "256" in answer


def test_loop_bounds_max_rounds(state):
    server = MagicMock()
    # server always returns a tool call → loop must terminate via max_tool_rounds
    last = state.last_date.date().isoformat()
    server.chat.return_value = _tool_call_response(
        "forecast", {"sku": "baguette", "on_date": last}
    )
    session = ChatSession(state=state, server=server, max_tool_rounds=2)
    answer = session.ask("Loop forever.")
    # max_tool_rounds=2 → loop runs max_tool_rounds + 1 = 3 model calls
    assert server.chat.call_count == 3
    assert "reached max" in answer.lower() or "without a final answer" in answer
