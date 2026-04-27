"""Tier 16: M5 — does TimesFM actually matter at L9? Compare with seasonal-naive.

Tier 14 used TimesFM-2 at L9. WRMSSE 0.713. The architectural insight
(top-down + L9 aggregation) might be doing most of the work — let's
verify by replacing TimesFM with seasonal-naive at the same L9 level.

If seasonal-naive at L9 + leaf shares ≈ Tier 14, then the foundation
model adds little. If it's much worse, TimesFM is the real win.

Run:
    python scripts/benchmark_m5_l9_naive.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from m5_wrmsse import compute_wrmsse  # noqa: E402

PREDICTION_LENGTH = 28
TRAIN_END_DAY = 1913


def seasonal_naive_one(history: np.ndarray, horizon: int, season: int = 7) -> np.ndarray:
    out = np.empty(horizon, dtype=np.float64)
    for i in range(horizon):
        out[i] = history[-(season - i % season)] if len(history) >= season else (history[-1] if len(history) else 0.0)
    return out


def main() -> int:
    print("=" * 78)
    print("Tier 16: M5 — seasonal-naive at L9 + leaf shares (counterfactual to Tier 14)")
    print("=" * 78)

    data_dir = REPO_ROOT / "data" / "raw" / "m5"
    sales_df = pd.read_csv(data_dir / "sales_train_evaluation.csv")
    day_cols = [c for c in sales_df.columns if c.startswith("d_")]
    train_cols = day_cols[:TRAIN_END_DAY]
    test_cols = day_cols[TRAIN_END_DAY:TRAIN_END_DAY + PREDICTION_LENGTH]
    train_matrix = sales_df[train_cols].to_numpy(dtype=np.float32)
    truth_matrix = sales_df[test_cols].to_numpy(dtype=np.float32)
    calendar = pd.read_csv(data_dir / "calendar.csv")
    sell_prices = pd.read_csv(data_dir / "sell_prices.csv")

    # Aggregate to L9
    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])

    print(f"\nL9 series: {len(l9_keys)}  ·  train days: {l9_train.shape[1]}")

    # Forecast each L9 series with seasonal-naive
    print("\nforecasting L9 with seasonal-naive (lag-7) — instant", flush=True)
    l9_fc = np.array([seasonal_naive_one(l9_train[ki], PREDICTION_LENGTH, 7) for ki in range(len(l9_keys))])

    # Disaggregate to leaves via within-group shares
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)
    n_leaves = len(leaf_volume)
    td_forecast = np.zeros((n_leaves, PREDICTION_LENGTH), dtype=np.float64)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        group_total = leaf_volume[idx].sum()
        if group_total > 0:
            within_share = leaf_volume[idx] / group_total
            td_forecast[idx] = within_share[:, None] * l9_fc[ki, None, :]

    # WRMSSE
    print("\n--- Tier 16 (seasonal-naive at L9 + leaf shares) ---")
    wrmsse, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("WRMSSE comparison — does TimesFM matter at L9?")
    print("═" * 78)
    print(f"  Tier 14  (TimesFM at L9 + leaf shares)         : 0.713")
    print(f"  Tier 16  (seasonal-naive at L9 + leaf shares)  : {wrmsse:.4f}  ← this run")
    print()
    print(f"  Plain seasonal-naive at L12 (bottom-up)         : 0.913")
    print()
    print(f"  M5 leaderboard top 100 : 0.554-0.605")
    print(f"  M5 leaderboard median  : ~0.65")
    return 0


if __name__ == "__main__":
    sys.exit(main())
