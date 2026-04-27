"""Deploy the TimesFM FastAPI service to Modal.

Why Modal: free tier covers our QPS (one forecast per SKU per day), auto-scales to
zero when idle (no idle cost), one-command deploy, ~5s cold start. The container
runs the same scripts/serve_timesfm.py used locally — Modal's ASGI bridge wraps
the FastAPI app unchanged.

Run:
    modal deploy scripts/deploy_modal.py

After deploy, Modal prints a public URL. Bind it on the worker:
    cd bakerysense-web
    npx wrangler secret put TIMESFM_ENDPOINT  # paste the Modal URL
    npm run deploy
"""
from __future__ import annotations

import sys
from pathlib import Path

import modal

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))


# ── image ─────────────────────────────────────────────────────────────────
# Pre-cache the 500m weights at image-build time so the first request after
# deploy doesn't pay the ~5min HF download. The cache layer is reused across
# rebuilds as long as MODEL_REPO doesn't change.
MODEL_REPO = "google/timesfm-2.0-500m-pytorch"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "libomp-dev", "curl", "ca-certificates")
    .pip_install(
        "timesfm[torch]==1.3.0",
        "fastapi==0.117.0",
        "uvicorn[standard]==0.32.0",
        "pydantic==2.9.0",
    )
    .run_commands(
        f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{MODEL_REPO}')\"",
    )
    .add_local_file(
        REPO_ROOT / "scripts" / "serve_timesfm.py",
        "/root/serve_timesfm.py",
    )
)


# ── app ───────────────────────────────────────────────────────────────────
app = modal.App("bakerysense-timesfm")


@app.function(
    image=image,
    cpu=2.0,
    memory=8192,           # 8 GB — comfortable for 500m FP32 inference
    timeout=120,           # generous for cold-start
    min_containers=0,      # scale to zero when idle (free)
    max_containers=2,      # cap blast radius if a runaway loop hits us
)
@modal.asgi_app(label="infer")
def fastapi_app():
    """Modal's ASGI bridge — wraps the unchanged FastAPI app."""
    import sys as _sys
    _sys.path.insert(0, "/root")
    from serve_timesfm import app as _app  # type: ignore
    return _app
