#!/usr/bin/env python3
"""
Generate the ENTIRE demo voiceover in a SINGLE Qwen-TTS synthesis call so
prosody flows continuously across sentences (no fresh-take seam every section).

Joins all section texts in script.json into one merged input string with
explicit pause punctuation between beats, calls qwen-tts-flash once, writes
out/_merged.wav and a one-entry manifest with scenario_anchor="global" — the
Remotion composition mounts that as a single <Audio> at composition root.

Run:
    cd bakerysense-web
    python3 e2e-demo/voiceover/generate_merged.py

Per-section output from generate.py (per-anchor mounting) is preserved on
disk; whichever manifest is current at compose time decides how Remotion
plays the audio.
"""
from __future__ import annotations

import json
import time
import wave
from pathlib import Path
from typing import Any

import torch

ROOT = Path(__file__).resolve().parent
SCRIPT_PATH = ROOT / "script.json"
OUT_DIR = ROOT / "out"
MERGED_WAV = OUT_DIR / "_merged.wav"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def pick_device_and_dtype() -> tuple[str, torch.dtype, str]:
    if torch.cuda.is_available():
        return "cuda", torch.bfloat16, "flash_attention_2"
    if torch.backends.mps.is_available():
        return "mps", torch.float16, "eager"
    return "cpu", torch.float32, "eager"


def wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as wf:
        return int(wf.getnframes() * 1000 / wf.getframerate())


def main() -> None:
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel

    plan = json.loads(SCRIPT_PATH.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Concatenate sections. Use period + double-space between sections — that
    # gives Qwen-TTS a natural sentence boundary without an awkward long pause.
    parts: list[str] = []
    for s in plan["sections"]:
        text = s["text"].strip()
        if not text.endswith((".", "!", "?", ":", ";", "—")):
            text += "."
        parts.append(text)
    merged_text = "  ".join(parts)
    print(f"[init] merged text: {len(merged_text)} chars across {len(parts)} sections")

    # Qwen3-TTS-12Hz-1.7B-CustomVoice handles long contexts well; the model's
    # default voice (Aiden) was already chosen via per-section voice tags but
    # for a single take we pick one voice for the whole narration.
    voice = "Aiden"
    model_id = plan.get("model_id", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    language = plan.get("language", "English")

    device, dtype, attn_impl = pick_device_and_dtype()
    print(f"[init] device={device} dtype={dtype} attn={attn_impl} model={model_id}")
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(
        model_id,
        device_map=device,
        dtype=dtype,
        attn_implementation=attn_impl,
    )
    print(f"[init] model loaded in {time.time() - t0:.1f}s")

    print(f"[tts] synthesizing {len(merged_text)} chars in one take ({voice})...")
    t0 = time.time()
    result = model.generate_custom_voice(text=merged_text, language=language, speaker=voice)
    if isinstance(result, tuple) and len(result) == 2:
        wavs, sr = result
    else:
        wavs = result
        sr = 24000
    sf.write(MERGED_WAV, wavs[0], sr)
    dur_ms = wav_duration_ms(MERGED_WAV)
    size_kb = MERGED_WAV.stat().st_size / 1024
    print(f"  ✓ {size_kb:.1f} KB · {dur_ms} ms · {time.time() - t0:.1f}s synth")

    manifest = [{
        "id": "_merged",
        "voice": voice,
        "speaker": "vo",
        "scenario_anchor": "global",
        "text": merged_text,
        "audio_file": MERGED_WAV.name,
        "duration_ms": dur_ms,
        "byte_size": MERGED_WAV.stat().st_size,
    }]
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Manifest: 1 global section at {MANIFEST_PATH.relative_to(ROOT.parent.parent)}")


if __name__ == "__main__":
    main()
