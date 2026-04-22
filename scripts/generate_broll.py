"""Generate on-cam bakery B-roll via OpenRouter's video API (alibaba/wan-2.6).

Budget-capped at USD_BUDGET (default $4.50). Each shot:
 1. POST /api/v1/videos with prompt + duration
 2. Poll /api/v1/videos/{id} until status == "completed" (or "failed")
 3. Download /api/v1/videos/{id}/content?index=0 to docs/demo/broll/<id>.mp4
 4. Abort the whole batch if cumulative usage.cost exceeds budget

Usage:
    OPENROUTER_API_KEY=sk-or-... python scripts/generate_broll.py

The prompts are in STORYBOARD; edit there before re-running to iterate.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "demo" / "broll"
USD_BUDGET = 4.50
MODEL = "alibaba/wan-2.6"
BASE = "https://openrouter.ai/api/v1"
TIMEOUT_S = 600  # per-job wall clock

STORYBOARD: list[dict[str, Any]] = [
    {
        "id": "shot1-cold-open",
        "duration": 10,
        "aspect_ratio": "16:9",
        "prompt": (
            "Small artisan French bakery at dawn, warm morning light streaming through "
            "the front window. A middle-aged female baker in a flour-dusted white apron "
            "stands behind a glass display case filled with golden croissants and crusty "
            "baguettes. She faces the camera with a calm, thoughtful expression, as if "
            "speaking honestly to a friend. Handheld camera with subtle natural motion, "
            "cinematic, shallow depth of field, soft film grain, warm honey-amber color "
            "palette. Documentary style, authentic, not performed."
        ),
    },
    {
        "id": "shot7b-display-case",
        "duration": 5,
        "aspect_ratio": "16:9",
        "prompt": (
            "Close-up over-the-shoulder shot. A baker's hands hold a modern smartphone "
            "horizontally over a half-empty glass display tray containing a few remaining "
            "croissants and pains au chocolat at end of day. The phone screen glows "
            "faintly. Shallow depth of field, warm indoor incandescent lighting, wooden "
            "bakery counter. No faces visible — just hands, phone, and pastries. Cinematic, "
            "authentic, calm."
        ),
    },
    {
        "id": "shot9-close",
        "duration": 10,
        "aspect_ratio": "16:9",
        "prompt": (
            "Medium shot of a middle-aged female baker in a flour-dusted white apron "
            "standing at the counter of a small artisan French bakery. Early morning "
            "light, warm amber and honey tones. She looks directly at the camera with a "
            "warm, confident, settled smile — the quiet satisfaction of someone who has "
            "solved a daily problem. Handheld camera with subtle natural motion. "
            "Cinematic, soft-focus background of shelves with fresh baked goods, film "
            "grain, documentary style, not performed."
        ),
    },
]


def log(msg: str) -> None:
    print(msg, flush=True)


def submit(session: requests.Session, shot: dict[str, Any]) -> dict[str, Any]:
    body = {
        "model": MODEL,
        "prompt": shot["prompt"],
        "duration": shot["duration"],
        "aspect_ratio": shot["aspect_ratio"],
        "resolution": "1080p",
        "generate_audio": False,  # we dub the owner's real voice separately
    }
    log(f"[{shot['id']}] POST /videos  ({shot['duration']}s, ~${shot['duration']*0.04:.2f})")
    r = session.post(f"{BASE}/videos", json=body, timeout=60)
    if r.status_code >= 300:
        raise RuntimeError(f"submit failed {r.status_code}: {r.text[:500]}")
    return r.json()


def poll(session: requests.Session, polling_url: str, shot_id: str) -> dict[str, Any]:
    t0 = time.time()
    while time.time() - t0 < TIMEOUT_S:
        time.sleep(5)
        r = session.get(polling_url, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"poll failed {r.status_code}: {r.text[:500]}")
        data = r.json()
        status = data.get("status", "?")
        elapsed = int(time.time() - t0)
        log(f"[{shot_id}] t+{elapsed:3d}s  status={status}")
        if status == "completed":
            return data
        if status == "failed":
            raise RuntimeError(f"job failed: {json.dumps(data)[:500]}")
    raise RuntimeError(f"timed out after {TIMEOUT_S}s")


def download(session: requests.Session, job_id: str, out_path: Path) -> None:
    url = f"{BASE}/videos/{job_id}/content?index=0"
    log(f"GET {url}")
    r = session.get(url, timeout=120, stream=True)
    if r.status_code >= 300:
        raise RuntimeError(f"download failed {r.status_code}: {r.text[:500]}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 16):
            if chunk:
                f.write(chunk)
    log(f"  wrote {out_path} ({out_path.stat().st_size // 1024} KiB)")


def main() -> None:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        sys.exit("OPENROUTER_API_KEY not set")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
        "HTTP-Referer": "https://bakerysense-web.swmengappdev.workers.dev",
        "X-Title": "BakerySense demo B-roll",
    })

    ledger: list[dict[str, Any]] = []
    cum_cost = 0.0
    for shot in STORYBOARD:
        projected = cum_cost + shot["duration"] * 0.04 * 1.25  # 25% pricing safety margin
        if projected > USD_BUDGET:
            log(f"!! would exceed budget (${projected:.2f} > ${USD_BUDGET}). Skipping {shot['id']}")
            continue
        try:
            submit_resp = submit(session, shot)
            polling_url = submit_resp.get("polling_url") or f"{BASE}/videos/{submit_resp['id']}"
            final = poll(session, polling_url, shot["id"])
            cost = float(final.get("usage", {}).get("cost", 0.0))
            cum_cost += cost
            out_path = OUT_DIR / f"{shot['id']}.mp4"
            download(session, submit_resp["id"], out_path)
            ledger.append({
                "id": shot["id"],
                "job_id": submit_resp["id"],
                "duration_s": shot["duration"],
                "cost_usd": cost,
                "cumulative_usd": cum_cost,
                "out": str(out_path.relative_to(OUT_DIR.parent.parent.parent)),
            })
            log(f"[{shot['id']}] done.  cost=${cost:.3f}  cumulative=${cum_cost:.3f}")
        except Exception as e:
            log(f"[{shot['id']}] ERROR: {e}")
            ledger.append({"id": shot["id"], "error": str(e), "cumulative_usd": cum_cost})
        if cum_cost >= USD_BUDGET:
            log(f"!! budget cap hit (${cum_cost:.2f} >= ${USD_BUDGET}). Stopping.")
            break

    ledger_path = OUT_DIR / "ledger.json"
    ledger_path.write_text(json.dumps(ledger, indent=2))
    log(f"\nLedger written to {ledger_path}")
    log(f"Total spend: ${cum_cost:.3f} / ${USD_BUDGET}")


if __name__ == "__main__":
    main()
