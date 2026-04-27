"""TimesFM-2 serving for the BakerySense V2 forecaster — Sprint 2 backend.

Exposes the same interface that bakerysense-web/src/lib/forecasters/timesfm.ts
expects, so the Cloudflare Worker can call this service when the env
var TIMESFM_ENDPOINT is set. Model is preloaded at startup so request
latency is dominated by inference, not setup.

Endpoints:
    GET  /healthz              → {"ok": true, "model": "...", "loaded": bool}
    POST /infer  {TimesFmInput} → {TimesFmOutput}

Run locally:
    uvicorn scripts.serve_timesfm:app --host 0.0.0.0 --port 8080

Container (CPU-first, GPU optional via env):
    See scripts/Dockerfile.timesfm. Deploys to Modal / Cloudflare Container
    / Replicate / any K8s. Each TimesFM call is independent; horizontal
    scale is just "more pods".

The wire format matches `TimesFmInput` / `TimesFmOutput` from
bakerysense-web/src/lib/forecasters/timesfm.ts byte-for-byte.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("timesfm-serve")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Configurable via env so the same image deploys to CPU / GPU.
MODEL_REPO = os.environ.get("TIMESFM_MODEL_REPO", "google/timesfm-2.0-500m-pytorch")
BACKEND = os.environ.get("TIMESFM_BACKEND", "cpu")  # "cpu" / "gpu" (=mps on mac, cuda on linux)
CONTEXT_LEN = int(os.environ.get("TIMESFM_CONTEXT_LEN", "512"))
HORIZON_LEN = int(os.environ.get("TIMESFM_HORIZON_LEN", "128"))
PER_CORE_BATCH_SIZE = int(os.environ.get("TIMESFM_BATCH_SIZE", "8"))

_MODEL: Any = None  # lazy-loaded TimesFm instance


def _load_model() -> Any:
    import timesfm  # type: ignore
    is_500m = "500m" in MODEL_REPO
    logger.info("loading %s on backend=%s …", MODEL_REPO, BACKEND)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=BACKEND,
            per_core_batch_size=PER_CORE_BATCH_SIZE,
            horizon_len=HORIZON_LEN,
            context_len=CONTEXT_LEN,
            num_layers=50 if is_500m else 20,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=MODEL_REPO),
    )
    logger.info("loaded in %.1fs", time.time() - t0)
    return tfm


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _MODEL
    _MODEL = _load_model()
    yield
    _MODEL = None


app = FastAPI(title="bakerysense-timesfm", version="1.0.0", lifespan=lifespan)


class InferRequest(BaseModel):
    """Wire format mirrors the TS `TimesFmInput`."""
    history: list[float] = Field(..., description="Most-recent N days of observed sales (oldest first)")
    horizon: int = Field(..., gt=0, le=512)
    quantiles: list[float] = Field(default_factory=lambda: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    static_covariates: dict[str, float | None] | None = None
    future_known: list[dict[str, float | None]] | None = None
    tenant_lora: str | None = None


class InferResponse(BaseModel):
    """Wire format mirrors the TS `TimesFmOutput`."""
    quantiles: dict[str, list[float]]
    model: str
    lora_applied: bool
    latency_ms: int


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "model": MODEL_REPO,
        "backend": BACKEND,
        "loaded": _MODEL is not None,
    }


@app.post("/infer", response_model=InferResponse)
def infer(req: InferRequest) -> InferResponse:
    if _MODEL is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    if req.horizon > HORIZON_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"horizon={req.horizon} exceeds server-configured max {HORIZON_LEN}",
        )
    if req.tenant_lora:
        # LoRA is V2 roadmap — the stub already documents this.
        logger.warning("tenant_lora=%s requested but LoRA serving not yet implemented; ignored", req.tenant_lora)

    history = np.asarray(req.history, dtype=np.float32)
    if history.ndim != 1 or history.size == 0:
        raise HTTPException(status_code=400, detail="history must be a non-empty 1-D array")

    t0 = time.time()
    # frequency 0 = high-freq (daily). future_known and static_covariates are
    # accepted for forward compatibility with TimesFM-2.5 / LoRA but the
    # current Pytorch model ignores them; documented in the doc string.
    point_fc, quantile_fc = _MODEL.forecast([history], freq=[0])
    latency_ms = int((time.time() - t0) * 1000)

    # quantile_fc shape: (1, horizon, 1 + len(default_quantiles))
    # column 0 = mean point forecast, columns 1..9 = q0.1 .. q0.9
    qmat = np.asarray(quantile_fc[0])
    default_q = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)

    out: dict[str, list[float]] = {}
    for q in req.quantiles:
        # Find nearest default quantile column.
        idx = min(range(len(default_q)), key=lambda i: abs(default_q[i] - q))
        col = qmat[: req.horizon, 1 + idx]
        # Floor at 0 — sales are non-negative.
        out[f"q{q:.1f}"] = [float(max(0.0, v)) for v in col]

    return InferResponse(
        quantiles=out,
        model=MODEL_REPO.split("/", 1)[-1].replace("-pytorch", ""),
        lora_applied=False,
        latency_ms=latency_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("scripts.serve_timesfm:app", host="0.0.0.0", port=8080, reload=False)
