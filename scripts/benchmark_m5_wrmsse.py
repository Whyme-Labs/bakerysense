"""Compute proper WRMSSE on M5 — actual leaderboard-comparable score.

Re-runs the M5 forecasts (V1.5 prior, seasonal-naive, TimesFM-2) and
scores them with the official 12-level Weighted Root Mean Squared
Scaled Error metric.

Public M5 ACCURACY leaderboard (Kaggle 2020, 5,558 teams):
  Private winner (YJ_STARK): WRMSSE 0.520
  Private top 10:            0.520 – 0.554
  Private top 100:           0.554 – 0.605
  Private median:            ~0.65
  Naive baselines:           0.85 – 1.10

Run:
    python scripts/benchmark_m5_wrmsse.py
"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from m5_wrmsse import compute_wrmsse  # noqa: E402

PREDICTION_LENGTH = 28
TRAIN_END_DAY = 1913


def seasonal_naive_batch(train: np.ndarray, horizon: int, season: int = 7) -> np.ndarray:
    n = train.shape[0]
    out = np.zeros((n, horizon), dtype=np.float64)
    for i in range(n):
        h = train[i]
        if len(h) < season:
            out[i] = h[-1] if len(h) else 0
            continue
        for j in range(horizon):
            out[i, j] = h[-(season - j % season)]
    return out


def predict_prior_batch(train: np.ndarray, horizon: int, start_dow: int = 0) -> np.ndarray:
    n_series, n_days = train.shape
    q50 = np.zeros((n_series, horizon))
    dow_per_day = np.array([(start_dow - (n_days - j)) % 7 for j in range(n_days)])
    for d in range(7):
        mask = dow_per_day == d
        if mask.sum() == 0:
            continue
        med = np.median(train[:, mask], axis=1)
        for j in range(horizon):
            if (start_dow + j) % 7 == d:
                q50[:, j] = med
    return q50


def predict_timesfm(train: np.ndarray, horizon: int) -> np.ndarray:
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"  loading TimesFM-2.0-500m on backend={backend} …", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=64,
            horizon_len=128,
            context_len=512,
            num_layers=50,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"    loaded in {time.time() - t0:.1f}s", flush=True)

    histories = []
    for i in range(train.shape[0]):
        h = train[i].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        histories.append(h)

    print(f"  forecasting {len(histories):,} series × {horizon} days…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"    inferred in {time.time() - t0:.1f}s", flush=True)
    return np.maximum(0.0, np.array([np.asarray(p)[:horizon] for p in point_fc]))


def main() -> int:
    print("=" * 78)
    print("M5 WRMSSE — proper leaderboard-comparable score")
    print("=" * 78)

    data_dir = REPO_ROOT / "data" / "raw" / "m5"
    print("\nloading M5 sales_train_evaluation.csv (~120 MB)…", flush=True)
    sales_df = pd.read_csv(data_dir / "sales_train_evaluation.csv")
    day_cols = [c for c in sales_df.columns if c.startswith("d_")]
    train_cols = day_cols[:TRAIN_END_DAY]
    test_cols = day_cols[TRAIN_END_DAY:TRAIN_END_DAY + PREDICTION_LENGTH]
    train_matrix = sales_df[train_cols].to_numpy(dtype=np.float32)
    truth_matrix = sales_df[test_cols].to_numpy(dtype=np.float32)
    print(f"  series: {train_matrix.shape[0]:,}  ·  train days: {train_matrix.shape[1]}  ·  test days: {truth_matrix.shape[1]}")

    print("loading calendar.csv + sell_prices.csv (~200 MB)…", flush=True)
    calendar = pd.read_csv(data_dir / "calendar.csv")
    sell_prices = pd.read_csv(data_dir / "sell_prices.csv")
    print(f"  calendar rows: {len(calendar):,}  ·  prices rows: {len(sell_prices):,}")

    # Determine forecast start dow — d_1914 = 2016-04-25 (Monday)
    forecast_start = pd.Timestamp("2011-01-29") + pd.Timedelta(days=TRAIN_END_DAY)
    start_dow = forecast_start.dayofweek

    # ── Forecasts ────────────────────────────────────────────────────────
    print("\n[1/3] seasonal-naive on full 30,490…", flush=True)
    t0 = time.time()
    naive = seasonal_naive_batch(train_matrix, PREDICTION_LENGTH, 7)
    print(f"  done in {time.time() - t0:.1f}s")

    print("\n[2/3] V1.5 prior (per-series × dow median) on full 30,490…", flush=True)
    t0 = time.time()
    prior = predict_prior_batch(train_matrix, PREDICTION_LENGTH, start_dow=start_dow)
    print(f"  done in {time.time() - t0:.1f}s")

    print("\n[3/3] TimesFM-2.0-500m zero-shot on full 30,490…", flush=True)
    try:
        tfm = predict_timesfm(train_matrix, PREDICTION_LENGTH)
    except Exception as e:
        print(f"  TimesFM failed: {e}")
        tfm = None

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE (M5 official metric — 12-level hierarchical, sales-weighted)")
    print("=" * 78)

    print("\n--- Seasonal-naive (lag-7) ---")
    naive_wrmsse, naive_levels = compute_wrmsse(
        sales_df, train_matrix, truth_matrix, naive, sell_prices, calendar, TRAIN_END_DAY,
    )
    print(f"  → WRMSSE = {naive_wrmsse:.4f}")

    print("\n--- V1.5 population prior ---")
    prior_wrmsse, prior_levels = compute_wrmsse(
        sales_df, train_matrix, truth_matrix, prior, sell_prices, calendar, TRAIN_END_DAY,
    )
    print(f"  → WRMSSE = {prior_wrmsse:.4f}")

    if tfm is not None:
        print("\n--- TimesFM-2.0-500m zero-shot ---")
        tfm_wrmsse, tfm_levels = compute_wrmsse(
            sales_df, train_matrix, truth_matrix, tfm, sell_prices, calendar, TRAIN_END_DAY,
        )
        print(f"  → WRMSSE = {tfm_wrmsse:.4f}")

    # ── Reference ────────────────────────────────────────────────────────
    print("\n" + "═" * 78)
    print("M5 ACCURACY LEADERBOARD — Kaggle 2020, 5,558 teams")
    print("═" * 78)
    print("  Private winner (YJ_STARK):    WRMSSE 0.520")
    print("  Private top 10:                0.520 – 0.554")
    print("  Private top 50:                0.554 – 0.585")
    print("  Private top 100:               0.554 – 0.605")
    print("  Private median:                ~0.65")
    print("  Public ‘naive’ benchmark:      ~0.85-1.05")
    return 0


if __name__ == "__main__":
    sys.exit(main())
