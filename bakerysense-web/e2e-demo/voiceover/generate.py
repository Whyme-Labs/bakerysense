#!/usr/bin/env python3
"""
Generate per-section voiceover audio via Qwen3-TTS-12Hz-1.7B-CustomVoice
running locally on Apple Silicon (MPS), CUDA, or CPU.

Input:  e2e-demo/voiceover/script.json
Output: e2e-demo/voiceover/out/<section_id>.wav
        e2e-demo/voiceover/out/manifest.json (durations, picked up by compose.ts)

Run:
    cd bakerysense-web
    python3 e2e-demo/voiceover/generate.py

The qwen-tts package and the model weights download on first run
(~3.4 GB for the 1.7B model in bf16). Subsequent runs use the cached
weights at ~/.cache/huggingface/hub/.

No API key, no network calls after the first download.
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
MANIFEST_PATH = OUT_DIR / "manifest.json"


def pick_device_and_dtype() -> tuple[str, torch.dtype, str]:
    """Prefer CUDA + flash_attention_2, fall back to MPS + eager, then CPU."""
    if torch.cuda.is_available():
        return "cuda", torch.bfloat16, "flash_attention_2"
    if torch.backends.mps.is_available():
        return "mps", torch.float16, "eager"
    return "cpu", torch.float32, "eager"


def wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        return int(frames * 1000 / rate)


def main() -> None:
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel

    plan = json.loads(SCRIPT_PATH.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Only synthesise sections whose .wav is missing — pass --force to regen all.
    import sys
    force = "--force" in sys.argv[1:]
    pending = [s for s in plan["sections"] if force or not (OUT_DIR / f"{s['id']}.wav").exists()]
    if not pending:
        print("All sections already rendered. Pass --force to regenerate.")
        # Still rebuild manifest from existing files so durations stay current.
        _write_manifest_from_existing(plan)
        return

    device, dtype, attn_impl = pick_device_and_dtype()
    print(f"[init] device={device} dtype={dtype} attn={attn_impl} model={plan['model_id']}")

    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(
        plan["model_id"],
        device_map=device,
        dtype=dtype,
        attn_implementation=attn_impl,
    )
    print(f"[init] model loaded in {time.time() - t0:.1f}s")

    language = plan.get("language", "English")
    print(f"  rendering {len(pending)}/{len(plan['sections'])} sections " + ("(--force)" if force else "(missing only)"))
    for s in pending:
        voice = s.get("voice") or plan["default_voice"]
        out_path = OUT_DIR / f"{s['id']}.wav"
        kwargs = dict(text=s["text"], language=language, speaker=voice)
        if s.get("instruct"):
            kwargs["instruct"] = s["instruct"]
        print(f"[tts] {s['id']:<24} voice={voice:<7} chars={len(s['text']):>3} → {out_path.name}")

        t0 = time.time()
        result = model.generate_custom_voice(**kwargs)
        if isinstance(result, tuple) and len(result) == 2:
            wavs, sr = result
        else:
            wavs = result
            sr = 24000  # documented default for Qwen3-TTS-12Hz
        sf.write(out_path, wavs[0], sr)
        dur_ms = wav_duration_ms(out_path)
        size_kb = out_path.stat().st_size / 1024
        print(f"  ✓ {size_kb:.1f} KB · {dur_ms} ms · {time.time() - t0:.1f}s synth")

    # Always rebuild the full manifest from whatever .wav files now exist on disk
    # so the manifest stays consistent with the script (text + voice metadata).
    _write_manifest_from_existing(plan)


def _write_manifest_from_existing(plan: dict[str, Any]) -> None:
    manifest: list[dict[str, Any]] = []
    for s in plan["sections"]:
        out_path = OUT_DIR / f"{s['id']}.wav"
        if not out_path.exists():
            print(f"  [warn] {out_path.name} missing — skipping in manifest")
            continue
        voice = s.get("voice") or plan["default_voice"]
        manifest.append({
            "id": s["id"],
            "voice": voice,
            "speaker": s["speaker"],
            "scenario_anchor": s["scenario_anchor"],
            "text": s["text"],
            "audio_file": out_path.name,
            "duration_ms": wav_duration_ms(out_path),
            "byte_size": out_path.stat().st_size,
        })
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Manifest: {len(manifest)} sections at {MANIFEST_PATH.relative_to(ROOT.parent.parent)}")


if __name__ == "__main__":
    main()
