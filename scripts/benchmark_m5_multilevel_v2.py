"""Tier 12: M5 two-level top-down reconciliation (L1 + L4).

Tier 10 used a single-level top-down: forecast L1 TOTAL with TimesFM,
disaggregate to 30,490 leaves via historical revenue shares. WRMSSE 0.80.

Tier 12 adds a category-level forecast (L4 = 3 categories: FOODS,
HOUSEHOLD, HOBBIES). Each category has its own time-series shape and
holiday sensitivity. Forecasting each separately + disaggregating
within-category should be tighter than L1 alone.

Pipeline:
  1. Forecast L4 (3 cat-level series) with TimesFM-2
  2. For each category, compute item-level shares from last-28-day
     revenue WITHIN that category
  3. Leaf forecast = cat_forecast × within_cat_share
  4. Compute WRMSSE on the resulting (30,490 × 28) matrix

This still uses one TimesFM model load + 3 forecasts (very fast).

Run:
    python scripts/benchmark_m5_multilevel_v2.py
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
    print("Tier 12: M5 two-level top-down (L1 + L4 — category)")
    print("=" * 78)

    data_dir = REPO_ROOT / "data" / "raw" / "m5"
    print("\nloading M5 …", flush=True)
    sales_df = pd.read_csv(data_dir / "sales_train_evaluation.csv")
    day_cols = [c for c in sales_df.columns if c.startswith("d_")]
    train_cols = day_cols[:TRAIN_END_DAY]
    test_cols = day_cols[TRAIN_END_DAY:TRAIN_END_DAY + PREDICTION_LENGTH]
    train_matrix = sales_df[train_cols].to_numpy(dtype=np.float32)
    truth_matrix = sales_df[test_cols].to_numpy(dtype=np.float32)
    calendar = pd.read_csv(data_dir / "calendar.csv")
    sell_prices = pd.read_csv(data_dir / "sell_prices.csv")
    print(f"  series {train_matrix.shape[0]:,} · train {train_matrix.shape[1]} · test {truth_matrix.shape[1]}")

    # ── Aggregate to L4 (3 categories) ──────────────────────────────────
    cats = sales_df["cat_id"].unique().tolist()
    print(f"\nL4 categories: {cats}")
    cat_to_idx = {c: np.where(sales_df["cat_id"] == c)[0] for c in cats}
    l4_train = np.array([train_matrix[idx].sum(axis=0) for c, idx in cat_to_idx.items()])
    l4_truth = np.array([truth_matrix[idx].sum(axis=0) for c, idx in cat_to_idx.items()])
    print(f"  L4 train shape: {l4_train.shape}  truth shape: {l4_truth.shape}")
    for ci, c in enumerate(cats):
        print(f"    {c}: train_mean={l4_train[ci].mean():.0f}  test_mean={l4_truth[ci].mean():.0f}")

    # ── Forecast L4 with TimesFM ────────────────────────────────────────
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L4 (3 cat series) with TimesFM-2 on backend={backend}…", flush=True)
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

    histories = []
    for ci in range(len(cats)):
        h = l4_train[ci].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        histories.append(h)

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s")
    l4_fc = np.array([np.maximum(0.0, np.asarray(p)[:PREDICTION_LENGTH]) for p in point_fc])
    for ci, c in enumerate(cats):
        print(f"    {c}: forecast_mean={l4_fc[ci].mean():.0f}  truth_mean={l4_truth[ci].mean():.0f}")

    # Free memory
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Within-category leaf shares from last 28 train days ─────────────
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)  # (30490,)

    # share_i = volume_i / sum(volume in same category)
    shares = np.zeros_like(leaf_volume)
    for c, idx in cat_to_idx.items():
        cat_total = leaf_volume[idx].sum()
        if cat_total > 0:
            shares[idx] = leaf_volume[idx] / cat_total
    print(f"\nwithin-category share sanity: by-cat sums = {[shares[idx].sum() for c, idx in cat_to_idx.items()]}")

    # ── Disaggregate L4 forecasts → leaves ──────────────────────────────
    n_leaves = len(leaf_volume)
    td_forecast = np.zeros((n_leaves, PREDICTION_LENGTH), dtype=np.float64)
    for ci, c in enumerate(cats):
        idx = cat_to_idx[c]
        # leaf forecast = within_cat_share × cat_forecast
        td_forecast[idx] = shares[idx, None] * l4_fc[ci, None, :]
    print(f"\ntwo-level top-down sum across leaves day0: {td_forecast.sum(axis=0)[0]:.1f} vs L1 (sum of L4 fc): {l4_fc[:, 0].sum():.1f}")

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — Tier 12 two-level top-down (L1 + L4) vs prior tiers")
    print("=" * 78)

    print("\n--- TimesFM-2 TWO-LEVEL TOP-DOWN (L4 + within-cat shares) ---")
    wrmsse, levels = compute_wrmsse(
        sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY,
    )
    print(f"  → WRMSSE = {wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("Reference WRMSSE numbers")
    print("═" * 78)
    print(f"  TimesFM bottom-up                          : 1.864")
    print(f"  Tier 10  L1 top-down                       : 0.800")
    print(f"  Tier 12  L1+L4 two-level top-down          : {wrmsse:.4f}")
    print(f"  Seasonal-naive                             : 0.913")
    print()
    print(f"  M5 leaderboard top 100                     : 0.554-0.605")
    print(f"  M5 leaderboard median                      : ~0.65")
    print(f"  M5 winner                                  : 0.520")
    return 0


if __name__ == "__main__":
    sys.exit(main())
