"""Tier 10: Multi-level M5 forecasting + top-down reconciliation.

The bottom-up WRMSSE result (TimesFM 1.864) is dominated by upper-level
RMSSEs (L1=2.31, L4=2.32) because per-leaf smooth forecasts don't
aggregate to a good total — naive's lag-7 copy preserves total weekly
seasonality by construction, TimesFM doesn't.

Fix: forecast TimesFM directly at upper levels (L1 = TOTAL has rich
signal — denser series, better suited to a foundation model), then
DISAGGREGATE downward using historical leaf proportions. Result is a
coherent forecast that respects both:
  • the TOTAL forecast (TimesFM at L1)
  • the per-leaf relative shape (from training-period proportions)

Reference: Hyndman et al. "Forecasting: Principles and Practice" §11.3
(top-down with historical proportions).

Run:
    python scripts/benchmark_m5_multilevel.py
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


def predict_timesfm_one_or_many(histories: list[np.ndarray], horizon: int) -> np.ndarray:
    """TimesFM-2 zero-shot on a list of series. Returns (n_series, horizon)."""
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

    # Cap context
    capped = []
    for h in histories:
        h32 = h.astype(np.float32)
        if len(h32) > 512:
            h32 = h32[-512:]
        capped.append(h32)

    print(f"  forecasting {len(capped):,} series × {horizon} days…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(capped, freq=[0] * len(capped))
    print(f"    inferred in {time.time() - t0:.1f}s", flush=True)
    return np.maximum(0.0, np.array([np.asarray(p)[:horizon] for p in point_fc]))


def main() -> int:
    print("=" * 78)
    print("Tier 10: M5 multi-level forecasting + top-down reconciliation")
    print("=" * 78)

    data_dir = REPO_ROOT / "data" / "raw" / "m5"
    print("\nloading M5 sales + calendar + sell_prices…", flush=True)
    sales_df = pd.read_csv(data_dir / "sales_train_evaluation.csv")
    day_cols = [c for c in sales_df.columns if c.startswith("d_")]
    train_cols = day_cols[:TRAIN_END_DAY]
    test_cols = day_cols[TRAIN_END_DAY:TRAIN_END_DAY + PREDICTION_LENGTH]
    train_matrix = sales_df[train_cols].to_numpy(dtype=np.float32)  # (30490, 1913)
    truth_matrix = sales_df[test_cols].to_numpy(dtype=np.float32)
    calendar = pd.read_csv(data_dir / "calendar.csv")
    sell_prices = pd.read_csv(data_dir / "sell_prices.csv")
    print(f"  series: {train_matrix.shape[0]:,}  ·  train days: {train_matrix.shape[1]}  ·  test days: {truth_matrix.shape[1]}")

    # ── Step 1: forecast TOTAL series with TimesFM ──────────────────────
    # Aggregate all 30,490 series into one daily TOTAL training series.
    print("\n[1/4] forecasting L1 TOTAL with TimesFM-2…", flush=True)
    total_train = train_matrix.sum(axis=0)  # (1913,)
    total_truth = truth_matrix.sum(axis=0)  # (28,)
    total_fc = predict_timesfm_one_or_many([total_train], PREDICTION_LENGTH)[0]
    # Reshape for downstream broadcasting
    print(f"  TOTAL train mean: {total_train.mean():.0f}  test mean: {total_truth.mean():.0f}  forecast mean: {total_fc.mean():.0f}")

    # ── Step 2: leaf shares from last-28-day actuals ────────────────────
    # share_i = sum(train[i, last 28]) / sum(train[:, last 28])
    last28 = train_matrix[:, -28:]
    leaf_revenue = last28.sum(axis=1)  # (30490,) — units, not dollars, for share calc
    total_revenue = leaf_revenue.sum()
    leaf_shares = leaf_revenue / max(total_revenue, 1e-9)  # (30490,)
    print(f"\n[2/4] computed leaf shares from last 28 train days")
    print(f"  share min/max/mean: {leaf_shares.min():.6f} / {leaf_shares.max():.6f} / {leaf_shares.mean():.6f}")
    print(f"  shares sum (sanity): {leaf_shares.sum():.6f}")

    # ── Step 3: top-down forecast = TOTAL forecast × leaf share ─────────
    # New per-leaf forecast: f_i,t = share_i × total_fc_t
    print("\n[3/4] top-down disaggregation: leaf_forecast = share × TOTAL_forecast")
    td_forecast = leaf_shares[:, None] * total_fc[None, :]  # (30490, 28)
    print(f"  td_forecast bottom-up sanity (sum across leaves vs total_fc): {td_forecast.sum(axis=0)[0]:.1f} vs {total_fc[0]:.1f}")

    # ── Step 4: WRMSSE comparison ───────────────────────────────────────
    # Bottom-up reference: per-leaf TimesFM forecasts (loaded from cache or recomputed)
    # For speed, we'll just compute the bottom-up TimesFM forecast inline here too.
    print("\n[4/4] forecasting all 30,490 leaves with TimesFM-2 for bottom-up comparison…")
    leaf_histories = []
    for i in range(train_matrix.shape[0]):
        h = train_matrix[i].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        leaf_histories.append(h)
    bu_forecast = predict_timesfm_one_or_many(leaf_histories, PREDICTION_LENGTH)

    # ── Compute WRMSSE for both ─────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — Tier 10 reconciliation comparison")
    print("=" * 78)

    print("\n--- TimesFM-2 BOTTOM-UP (per-leaf, sum to upper levels) ---")
    bu_wrmsse, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, bu_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {bu_wrmsse:.4f}")

    print("\n--- TimesFM-2 TOP-DOWN (TOTAL forecast × leaf share) — Tier 10 ---")
    td_wrmsse, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {td_wrmsse:.4f}")

    # 50/50 blend
    blend_forecast = 0.5 * bu_forecast + 0.5 * td_forecast
    print("\n--- TimesFM-2 50/50 BLEND of bottom-up + top-down ---")
    bl_wrmsse, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, blend_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {bl_wrmsse:.4f}")

    # Reference
    print("\n" + "═" * 78)
    print("M5 ACCURACY LEADERBOARD reference")
    print("═" * 78)
    print("  Winner:   WRMSSE 0.520")
    print("  Top 100:  WRMSSE 0.554-0.605")
    print("  Median:   ~0.65")
    print("  Naive:    ~0.91")
    return 0


if __name__ == "__main__":
    sys.exit(main())
