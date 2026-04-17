"""End-to-end demo: a bakery manager asks Gemma 4 questions.

Three modes:

    python scripts/demo_agent.py --tools-only
        Exercise each tool directly with fixed inputs. No LLM loaded.
        Useful for verifying the numeric layer works before plumbing Gemma.

    python scripts/demo_agent.py
        Run a scripted merchant conversation against a local Gemma 4 model
        loaded via llama.cpp. Requires ``uv pip install -e '.[agent]'`` and
        a downloadable GGUF (default: ``ggml-org/gemma-4-E4B-it-GGUF``).

    python scripts/demo_agent.py --interactive
        Drop into a REPL. Type ``/quit`` to exit.

Environment variables (see bakerysense/agent/server.py):

    BAKERYSENSE_MODEL_REPO   override the HuggingFace repo
    BAKERYSENSE_MODEL_FILE   override the GGUF filename pattern
    BAKERYSENSE_N_GPU_LAYERS number of layers on GPU (-1 = all)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from bakerysense.agent import AgentState, ChatSession, TOOL_SCHEMAS, dispatch  # noqa: E402


SCRIPTED_QUESTIONS = [
    "Which products are you trained on?",
    "How many TRADITIONAL BAGUETTE should I bake tomorrow? Use the last date available in the data.",
    "Why that number? Explain the drivers.",
    "What's my waste risk on CROISSANT for that same date?",
    "At 6pm I still have 80 CROISSANT, 30 ECLAIR, and 20 TARTELETTE left. What should I mark down?",
]


def run_tools_only(state: AgentState) -> None:
    print("=" * 72)
    print("TOOLS-ONLY MODE  (no LLM — direct tool invocation)")
    print("=" * 72)
    last = state.last_date.date().isoformat()
    print(f"\nLast data date: {last}. Exercising each tool:\n")

    cases: list[tuple[str, dict]] = [
        ("list_skus", {}),
        ("forecast", {"sku": "baguette", "on_date": last}),
        ("explain_drivers", {"sku": "baguette", "on_date": last, "top_k": 3}),
        ("waste_risk", {"sku": "pandan_bun", "on_date": last, "threshold_pct": 10}),
        ("suggest_markdowns", {
            "inventory": {"croissant": 60, "pandan_bun": 40, "baguette": 30},
            "as_of": last,
        }),
    ]

    for name, args in cases:
        print(f"  → {name}({json.dumps(args)})")
        result = dispatch(state, name, args)
        print(f"    {json.dumps(result, indent=6)[:800]}")
        print()


def run_scripted(
    state: AgentState,
    verbose_tools: bool,
    transcript_path: str | None = None,
) -> None:
    from bakerysense.agent.server import GemmaServer  # local import — optional dep

    print("=" * 72)
    print("SCRIPTED MERCHANT CONVERSATION")
    print("=" * 72)
    server = GemmaServer()
    try:
        server.load()
    except Exception as e:
        print(f"\nCould not load Gemma model: {e}\n")
        print("Falling back to tools-only mode.\n")
        run_tools_only(state)
        return

    session = ChatSession(state=state, server=server)
    transcript: list[dict] = []

    for q in SCRIPTED_QUESTIONS:
        print(f"\n--- merchant ----------------------------------------------------------")
        print(f"  {q}")
        tool_log: list[str] = []
        if transcript_path or verbose_tools:
            # wrap verbose_tools so we also capture it for the transcript
            before = len(session.messages)
            answer = session.ask(q, verbose_tools=verbose_tools)
            # snapshot tool messages added during this turn
            for m in session.messages[before:]:
                if m.get("role") == "tool":
                    tool_log.append(f"{m.get('name')} -> {m.get('content', '')}")
        else:
            answer = session.ask(q, verbose_tools=verbose_tools)
        print(f"--- BakerySense -------------------------------------------------------")
        print(f"  {answer}")
        transcript.append({"merchant": q, "tools": tool_log, "bakerysense": answer})

    if transcript_path:
        _write_transcript(transcript_path, transcript, state, server.config.describe())
        print(f"\nTranscript saved to {transcript_path}")


def _write_transcript(
    path: str,
    turns: list[dict],
    state: AgentState,
    model_label: str,
) -> None:
    lines: list[str] = []
    lines.append(f"# BakerySense — Live Demo Transcript\n")
    lines.append(f"- **Model**: `{model_label}`")
    lines.append(f"- **SKUs**: {len(state.skus())} — "
                 f"{', '.join(state.skus())}")
    lines.append(f"- **Forecaster coverage**: through {state.last_date.date()}")
    lines.append("")
    lines.append("Numeric work (forecasting, newsvendor, SHAP) runs deterministically in Python. "
                 "Gemma 4 is the semantic layer: it picks tools, reads their JSON output, and "
                 "renders the result as plain merchant-facing language.\n")
    for i, t in enumerate(turns, 1):
        lines.append(f"## Turn {i}")
        lines.append(f"**Merchant:** {t['merchant']}\n")
        if t["tools"]:
            lines.append("_Tools invoked:_")
            for call in t["tools"]:
                lines.append(f"- `{call[:300]}`")
            lines.append("")
        lines.append(f"**BakerySense:** {t['bakerysense']}\n")
    Path(path).write_text("\n".join(lines))


def run_interactive(state: AgentState) -> None:
    from bakerysense.agent.server import GemmaServer

    server = GemmaServer()
    server.load()
    session = ChatSession(state=state, server=server)
    print("BakerySense REPL. Type /quit to exit, /tools to see trace.\n")
    verbose = False
    while True:
        try:
            msg = input("merchant> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not msg:
            continue
        if msg == "/quit":
            return
        if msg == "/tools":
            verbose = not verbose
            print(f"(tool-call trace {'on' if verbose else 'off'})")
            continue
        answer = session.ask(msg, verbose_tools=verbose)
        print(f"BakerySense> {answer}\n")


def run_vision(state: AgentState, image_path: str, question: str) -> None:
    from bakerysense.agent.server import GemmaServer

    print("=" * 72)
    print("MULTIMODAL PATH  (photo → counts → forecast reasoning)")
    print("=" * 72)
    server = GemmaServer()
    server.load()
    from bakerysense.agent.session import ChatSession
    session = ChatSession(state=state, server=server)
    print(f"\n--- merchant ----------------------------------------------------------")
    print(f"  {question}")
    print(f"  [attached image: {image_path}]")
    answer = session.ask_with_photo(question, image_path, verbose_tools=True)
    print(f"--- BakerySense -------------------------------------------------------")
    print(f"  {answer}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tools-only", action="store_true",
                        help="Exercise tools directly; do not load Gemma.")
    parser.add_argument("--interactive", action="store_true",
                        help="Interactive REPL after loading Gemma.")
    parser.add_argument("--quiet", action="store_true",
                        help="Hide tool-call trace in scripted mode.")
    parser.add_argument("--image", type=str, default=None,
                        help="Path to a display-case photo; triggers the vision path.")
    parser.add_argument("--question", type=str,
                        default="I have the inventory shown in this photo. What should I mark down?",
                        help="Question paired with --image.")
    parser.add_argument("--transcript", type=str, default=None,
                        help="Write the scripted conversation to this markdown file.")
    args = parser.parse_args()

    print(f"Loading agent state from models/gbm …")
    state = AgentState.from_disk()
    print(f"  Loaded {len(state.skus())} SKUs; features through {state.last_date.date()}")
    print(f"  Tool surface: {[t['function']['name'] for t in TOOL_SCHEMAS]}")

    if args.tools_only:
        run_tools_only(state)
    elif args.image:
        run_vision(state, args.image, args.question)
    elif args.interactive:
        run_interactive(state)
    else:
        run_scripted(state, verbose_tools=not args.quiet, transcript_path=args.transcript)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
