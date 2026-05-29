#!/usr/bin/env python3
"""
Generate scene narration for the HarnessStory video using VoxCPM2.

Input:  e2e-demo/voiceover/harness-script.json
Output: e2e-demo/video/public/vo-harness/<id>.wav
        e2e-demo/video/public/vo-harness/manifest.json  (anchor, file, duration_ms)

Run:
    pip install voxcpm soundfile
    python3 e2e-demo/voiceover/generate_voxcpm.py

VoxCPM2 is CUDA-oriented (~8GB VRAM). On a CUDA-less machine it falls back to
CPU, which works but is slow; the seven short lines here total ~40s of audio.
If VoxCPM2 cannot be loaded, this script exits non-zero so the caller can fall
back to the Qwen pipeline (generate.py).
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT_PATH = ROOT / "harness-script.json"
OUT_DIR = ROOT.parent / "video" / "public" / "vo-harness"
MANIFEST_PATH = OUT_DIR / "manifest.json"


def wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as w:
        return int(round(w.getnframes() / float(w.getframerate()) * 1000))


def main() -> int:
    import os
    import soundfile as sf  # noqa: F401
    from voxcpm import VoxCPM

    # Optional reference voice for cloning — keeps all clips in ONE voice.
    # VoxCPM2's reference_wav_path works alone (no transcript needed).
    ref = os.environ.get("REFERENCE_WAV")
    if ref and not os.path.exists(ref):
        raise FileNotFoundError(f"REFERENCE_WAV not found: {ref}")

    # Idempotent: skip lines whose wav already exists unless FORCE=1. Lets us
    # add a single new narration line without regenerating the rest.
    force = os.environ.get("FORCE", "") == "1"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    script = json.loads(SCRIPT_PATH.read_text())
    sections = script["sections"]

    todo = [s for s in sections if force or not (OUT_DIR / f"{s['id']}.wav").exists()]
    model = None
    if todo:
        print("Loading VoxCPM2 (first run downloads weights)...")
        if ref:
            print(f"Cloning voice from reference: {ref}")
        model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    else:
        print("All clips already present; rebuilding manifest only.")

    kw = {"cfg_value": 2.0, "inference_timesteps": 10}
    if ref:
        kw["reference_wav_path"] = ref

    manifest = []
    for s in sections:
        out = OUT_DIR / f"{s['id']}.wav"
        if force or not out.exists():
            print(f"  → {s['id']}: {s['text'][:60]}...")
            wav = model.generate(text=s["text"], **kw)
            sf.write(str(out), wav, model.tts_model.sample_rate)
        else:
            print(f"  · {s['id']}: kept (exists)")
        manifest.append({
            "id": s["id"],
            "anchor": s["anchor"],
            "audio_file": out.name,
            "duration_ms": wav_duration_ms(out),
        })

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(manifest)} clips + manifest to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
