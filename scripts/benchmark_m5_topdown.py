"""Tier 10 (lean): M5 top-down reconciliation with TimesFM L1 forecast.

Skips the slow L12 recompute — we already established TimesFM bottom-up
WRMSSE = 1.864 in scripts/benchmark_m5_wrmsse.py. This script tests
whether forecasting at L1 (TOTAL) and disaggregating downward gives a
better WRMSSE.

Run:
    python scripts/benchmark_m5_topdown.py
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


def main() -> int:
    print("=" * 78)
    print("Tier 10 (lean): M5 top-down reconciliation via TimesFM L1 forecast")
    print("=" * 78)

    data_dir = REPO_ROOT / "data" / "raw" / "m5"
    print("\nloading M5…", flush=True)
    sales_df = pd.read_csv(data_dir / "sales_train_evaluation.csv")
    day_cols = [c for c in sales_df.columns if c.startswith("d_")]
    train_cols = day_cols[:TRAIN_END_DAY]
    test_cols = day_cols[TRAIN_END_DAY:TRAIN_END_DAY + PREDICTION_LENGTH]
    train_matrix = sales_df[train_cols].to_numpy(dtype=np.float32)
    truth_matrix = sales_df[test_cols].to_numpy(dtype=np.float32)
    calendar = pd.read_csv(data_dir / "calendar.csv")
    sell_prices = pd.read_csv(data_dir / "sell_prices.csv")
    print(f"  series {train_matrix.shape[0]:,} · train {train_matrix.shape[1]} · test {truth_matrix.shape[1]}")

    # ── L1 forecast ─────────────────────────────────────────────────────
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L1 TOTAL with TimesFM-2.0-500m on backend={backend} …", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=8,
            horizon_len=128,
            context_len=512,
            num_layers=50,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    total_train = train_matrix.sum(axis=0).astype(np.float32)
    total_truth = truth_matrix.sum(axis=0)
    if len(total_train) > 512:
        ctx = total_train[-512:]
    else:
        ctx = total_train

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast([ctx], freq=[0])
    total_fc = np.maximum(0.0, np.asarray(point_fc[0])[:PREDICTION_LENGTH])
    print(f"  L1 inferred in {time.time() - t0:.1f}s")
    print(f"  TOTAL train_mean={total_train.mean():.0f}  test_mean={total_truth.mean():.0f}  fc_mean={total_fc.mean():.0f}")
    # Free the model to reclaim memory
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Leaf shares from last 28 days ───────────────────────────────────
    last28 = train_matrix[:, -28:]
    leaf_revenue = last28.sum(axis=1)
    total_revenue = leaf_revenue.sum()
    leaf_shares = leaf_revenue / max(total_revenue, 1e-9)

    # ── Top-down forecast: leaf_i,t = share_i × TOTAL_t ─────────────────
    td_forecast = leaf_shares[:, None] * total_fc[None, :]
    print(f"\nleaf shares: min={leaf_shares.min():.6f} max={leaf_shares.max():.6f} sum={leaf_shares.sum():.4f}")
    print(f"top-down sum across leaves day0: {td_forecast.sum(axis=0)[0]:.1f} vs L1 forecast day0: {total_fc[0]:.1f}")

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — TimesFM-2 top-down (Tier 10) vs known references")
    print("=" * 78)
    print("\n--- TimesFM-2 TOP-DOWN (L1 × leaf shares) ---")
    td_wrmsse, td_levels = compute_wrmsse(
        sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY,
    )
    print(f"  → WRMSSE = {td_wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("Reference WRMSSE numbers (from earlier runs and Kaggle leaderboard)")
    print("═" * 78)
    print(f"  TimesFM-2 BOTTOM-UP (per-leaf, sum upward) :  WRMSSE 1.864  (earlier run)")
    print(f"  TimesFM-2 TOP-DOWN (Tier 10, this run)     :  WRMSSE {td_wrmsse:.4f}")
    print(f"  V1.5 prior bottom-up                       :  WRMSSE 3.363  (earlier run)")
    print(f"  Seasonal-naive                             :  WRMSSE 0.913  (earlier run)")
    print()
    print(f"  M5 Kaggle leaderboard winner (YJ_STARK)    :  0.520")
    print(f"  Top 10                                     :  0.520-0.554")
    print(f"  Top 100                                    :  0.554-0.605")
    print(f"  Median                                     :  ~0.65")
    return 0


if __name__ == "__main__":
    sys.exit(main())
