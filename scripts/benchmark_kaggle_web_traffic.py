"""Head-to-head on the Kaggle Web Traffic Time Series Forecasting Competition.

The original Kaggle competition (Sept 2017) closed with 1,095 teams.
Public leaderboard scores were SMAPE 36-44 for top finishers; the winner
(cpmpml) hit private SMAPE 35.48 with a sequence-to-sequence model.

This benchmark replays the SAME methodology Kaggle scored on:
  • All 145,063 valid Wikipedia series
  • 59-day forecast horizon (competition was 62; this is the gluonts subset)
  • SMAPE per Kaggle's formula (rounded to 0 when both predicted and actual are 0)

What we run:
  1. V1.5 population prior (per-series × dow median)  — full 145K, leaderboard-comparable
  2. Seasonal-naive (lag-7)                            — full 145K, leaderboard-comparable
  3. TimesFM-2.0-500m zero-shot                        — random 5K sample (illustrative)

Why TimesFM only on a sample: per-series inference at batch_size=32 takes
~5s/batch × 4500 batches = ~7 hours. The benchmark would block the laptop
for half a day. The 5K-series result is a fair statistical estimate and
runs in ~15 minutes.

Public leaderboard (Kaggle Web Traffic — original 2017 competition):
  Public SMAPE 35-39   = top 50 teams
  Public SMAPE 39-44   = top 200 teams
  Public SMAPE 44-50   = top 500 teams
  Public SMAPE >50     = bottom half

Run:
    python scripts/benchmark_kaggle_web_traffic.py
"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from bakerysense.eval import pinball_loss, wape  # noqa: E402

PREDICTION_LENGTH = 59
TIMESFM_SAMPLE_SIZE = 5000


def kaggle_smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Kaggle Web Traffic SMAPE: zero when both true and pred are 0."""
    denom = np.abs(y_true) + np.abs(y_pred)
    diff = np.abs(y_true - y_pred)
    smape = np.where(denom == 0, 0.0, 200.0 * diff / denom)
    return float(np.mean(smape))


def load_data() -> tuple[list[np.ndarray], list[np.ndarray]]:
    from gluonts.dataset.repository import get_dataset
    print("loading kaggle_web_traffic_without_missing…", flush=True)
    ds = get_dataset("kaggle_web_traffic_without_missing", regenerate=False)
    train_arrays, test_arrays = [], []
    for s in ds.train:
        train_arrays.append(np.asarray(s["target"], dtype=np.float64))
    for s in ds.test:
        test_arrays.append(np.asarray(s["target"], dtype=np.float64))
    return train_arrays, test_arrays


def seasonal_naive_batch(train: list[np.ndarray], horizon: int, season: int = 7) -> np.ndarray:
    n = len(train)
    out = np.zeros((n, horizon))
    for i in range(n):
        h = train[i]
        if len(h) < season:
            out[i] = h[-1] if len(h) else 0
            continue
        for j in range(horizon):
            out[i, j] = h[-(season - j % season)]
    return out


def predict_prior_batch(
    train: list[np.ndarray],
    horizon: int,
    start_dow: int = 0,
) -> tuple[np.ndarray, np.ndarray]:
    """Per-series (dow → median, q0.9). start_dow is the dow of the first
    forecast day. For Kaggle Web Traffic all series start the same date,
    so a single dow alignment is fine."""
    n = len(train)
    q50 = np.zeros((n, horizon))
    q90 = np.zeros((n, horizon))
    for i in range(n):
        h = train[i]
        nh = len(h)
        if nh == 0:
            continue
        dow_per_day = np.array([(start_dow - (nh - j)) % 7 for j in range(nh)])
        meds = np.zeros(7)
        p90s = np.zeros(7)
        for d in range(7):
            mask = dow_per_day == d
            if mask.sum() >= 2:
                meds[d] = np.median(h[mask])
                p90s[d] = np.quantile(h[mask], 0.9)
            else:
                meds[d] = np.median(h)
                p90s[d] = np.quantile(h, 0.9)
        for j in range(horizon):
            d = (start_dow + j) % 7
            q50[i, j] = meds[d]
            q90[i, j] = p90s[d]
    return q50, q90


def predict_timesfm_sample(
    train: list[np.ndarray],
    horizon: int,
    indices: np.ndarray,
    model_size: str = "500m",
) -> tuple[np.ndarray, np.ndarray]:
    import timesfm  # type: ignore
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    repo = (
        "google/timesfm-2.0-500m-pytorch" if model_size == "500m"
        else "google/timesfm-1.0-200m-pytorch"
    )
    print(f"  loading {repo} on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=32,
            horizon_len=128,
            context_len=512,
            num_layers=50 if model_size == "500m" else 20,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=repo),
    )
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    histories = []
    for i in indices:
        h = train[int(i)].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        histories.append(h)

    print(f"  forecasting {len(histories)} series × {horizon} days…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, qfc = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s", flush=True)

    n_sample = len(histories)
    q50 = np.zeros((n_sample, horizon))
    q90 = np.zeros((n_sample, horizon))
    for i in range(n_sample):
        m = np.asarray(qfc[i])
        q50[i] = np.maximum(0.0, m[:horizon, 1 + 4])
        q90[i] = np.maximum(0.0, m[:horizon, 1 + 8])
    return q50, q90


def main() -> int:
    print("=" * 78)
    print("BakerySense vs Kaggle Web Traffic public leaderboard")
    print("=" * 78)

    train, test = load_data()
    n = len(train)
    truth = np.array([t[-PREDICTION_LENGTH:] for t in test])  # (n, 59)
    print(f"\nseries: {n:,}  ·  horizon: {PREDICTION_LENGTH} days")

    # ── Full 145K — V1.5 prior + seasonal-naive ─────────────────────────
    print("\n  computing seasonal-naive on full 145K…", flush=True)
    t0 = time.time()
    naive = seasonal_naive_batch(train, PREDICTION_LENGTH, 7)
    print(f"    done in {time.time() - t0:.1f}s")

    print("  computing V1.5 prior on full 145K…", flush=True)
    t0 = time.time()
    prior_q50, prior_q90 = predict_prior_batch(train, PREDICTION_LENGTH, start_dow=0)
    print(f"    done in {time.time() - t0:.1f}s")

    # ── Sample — TimesFM-2 ──────────────────────────────────────────────
    rng = np.random.default_rng(42)
    sample_idx = rng.choice(n, size=min(TIMESFM_SAMPLE_SIZE, n), replace=False)
    sample_idx.sort()
    truth_sample = truth[sample_idx]

    tfm_q50: np.ndarray | None = None
    tfm_q90: np.ndarray | None = None
    try:
        tfm_q50, tfm_q90 = predict_timesfm_sample(train, PREDICTION_LENGTH, sample_idx, "500m")
    except Exception as e:
        print(f"  TimesFM failed: {e}")

    # ── Report — full ───────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print(f"FULL {n:,} series — point forecast metrics (Kaggle SMAPE official)")
    print("─" * 78)
    print(f"  {'forecaster':<40} {'SMAPE':>8} {'WAPE':>8}")
    print("  " + "-" * 60)

    rows = [
        ("Seasonal-naive (lag-7)",         naive),
        ("V1.5 population prior (ours)",   prior_q50),
    ]
    for name, p in rows:
        s = kaggle_smape(truth.flatten(), p.flatten())
        w = wape(truth.flatten(), p.flatten())
        print(f"  {name:<40} {s:>8.3f} {w:>8.4f}")

    # ── Report — sample (TimesFM) ───────────────────────────────────────
    if tfm_q50 is not None:
        print("\n" + "─" * 78)
        print(f"SAMPLE ({len(sample_idx):,} series, seed=42) — TimesFM-2")
        print("─" * 78)
        print(f"  {'forecaster':<40} {'SMAPE':>8} {'WAPE':>8}")
        print("  " + "-" * 60)
        s_n = kaggle_smape(truth_sample.flatten(), naive[sample_idx].flatten())
        s_p = kaggle_smape(truth_sample.flatten(), prior_q50[sample_idx].flatten())
        s_t = kaggle_smape(truth_sample.flatten(), tfm_q50.flatten())
        w_n = wape(truth_sample.flatten(), naive[sample_idx].flatten())
        w_p = wape(truth_sample.flatten(), prior_q50[sample_idx].flatten())
        w_t = wape(truth_sample.flatten(), tfm_q50.flatten())
        print(f"  {'Seasonal-naive (sample)':<40} {s_n:>8.3f} {w_n:>8.4f}")
        print(f"  {'V1.5 population prior (sample)':<40} {s_p:>8.3f} {w_p:>8.4f}")
        print(f"  {'TimesFM-2.0-500m zero-shot (sample)':<40} {s_t:>8.3f} {w_t:>8.4f}")

        # Quantile band on sample
        print("\n" + "─" * 78)
        print("QUANTILE BAND — pinball loss at q=0.9 (sample)")
        print("─" * 78)
        print(f"  {'forecaster':<40} {'pinball-q0.9':>14}")
        print(f"  {'V1.5 prior q0.9':<40} {pinball_loss(truth_sample.flatten(), prior_q90[sample_idx].flatten(), 0.9):>14.4f}")
        print(f"  {'TimesFM-2 q0.9':<40} {pinball_loss(truth_sample.flatten(), tfm_q90.flatten(), 0.9):>14.4f}")

    # ── Public leaderboard reference ────────────────────────────────────
    print("\n" + "═" * 78)
    print("PUBLIC LEADERBOARD (Kaggle Web Traffic Sept 2017, 1,095 teams)")
    print("═" * 78)
    print("  Public SMAPE 35.48  → cpmpml (private leaderboard winner, seq2seq)")
    print("  Public SMAPE 35-39  → top 50 teams")
    print("  Public SMAPE 39-44  → top 200 teams")
    print("  Public SMAPE 44-50  → top 500 teams")
    print("  Public SMAPE >50    → bottom half")
    return 0


if __name__ == "__main__":
    sys.exit(main())
