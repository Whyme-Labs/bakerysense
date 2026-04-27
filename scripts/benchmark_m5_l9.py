"""Tier 14: M5 — L9 (store × dept, 70 series) top-down reconciliation.

Tier 10 (L1, 1 series → leaves):   WRMSSE 0.800
Tier 12 (L4, 3 series → leaves):   WRMSSE 0.792
Tier 14 (L9, 70 series → leaves):  to be measured

Hypothesis: L9 forecasts capture both store-level variation (10 stores)
and department-level patterns (7 departments) simultaneously. With 70
parallel series, TimesFM can specialise per-store-dept while staying
denser than individual leaves.

Within-(store × dept) leaf shares disaggregate the 70 forecasts down
to 30,490 items. Each store × dept group has ~436 items on average
(30,490 / 70).

Run:
    python scripts/benchmark_m5_l9.py
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
    print("Tier 14: M5 — L9 (store × dept) top-down reconciliation")
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
    print(f"series {train_matrix.shape[0]:,} · train {train_matrix.shape[1]} · test {truth_matrix.shape[1]}")

    # ── Aggregate to L9 (store × dept) ──────────────────────────────────
    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    print(f"\nL9 groups: {len(l9_keys)} (store × dept)")
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])
    l9_truth = np.array([truth_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])
    print(f"  L9 train shape: {l9_train.shape}  truth shape: {l9_truth.shape}")
    print(f"  L9 series sizes: min={min(len(idx) for idx in l9_to_idx.values())}  max={max(len(idx) for idx in l9_to_idx.values())}  mean={int(np.mean([len(idx) for idx in l9_to_idx.values()]))}")

    # ── Forecast L9 with TimesFM ────────────────────────────────────────
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L9 (70 series) with TimesFM-2 on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=16, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    histories = []
    for ki in range(len(l9_keys)):
        h = l9_train[ki].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        histories.append(h)

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s")
    l9_fc = np.array([np.maximum(0.0, np.asarray(p)[:PREDICTION_LENGTH]) for p in point_fc])

    # Free TimesFM
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Within-(store × dept) leaf shares ───────────────────────────────
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

    print(f"\ntop-down sum across leaves day0: {td_forecast.sum(axis=0)[0]:.1f} vs L9 fc sum: {l9_fc[:, 0].sum():.1f}")

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — Tier 14")
    print("=" * 78)
    print("\n--- Tier 14 (L9 top-down) ---")
    wrmsse, levels = compute_wrmsse(sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("Reference WRMSSE numbers")
    print("═" * 78)
    print(f"  Tier 10 (L1 → leaves)            : 0.800")
    print(f"  Tier 12 (L4 → leaves)            : 0.792")
    print(f"  Tier 14 (L9 → leaves, this run)  : {wrmsse:.4f}")
    print(f"  Seasonal-naive                   : 0.913")
    print()
    print(f"  M5 leaderboard top 100           : 0.554-0.605")
    print(f"  M5 leaderboard median            : ~0.65")
    print(f"  M5 winner                        : 0.520")
    return 0


if __name__ == "__main__":
    sys.exit(main())
