"""Tier 15: M5 — L11 (item × state, 9,147 series) top-down.

Tier scorecard so far:
  L1   (1 series):    WRMSSE 0.800
  L4   (3 series):    WRMSSE 0.792
  L9   (70 series):   WRMSSE 0.713
  L11  (9,147):       to be measured

L11 = (item, state) — each of 3,049 items × 3 states = 9,147. Each
group has ~3 stores worth of an item underneath. Sparser per-group
than L9 (which has ~436 items underneath each), but captures item +
state interaction.

Run:
    python scripts/benchmark_m5_l11.py
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
    print("Tier 15: M5 — L11 (item × state, 9,147 series) top-down")
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

    # ── Aggregate to L11 (item × state) ─────────────────────────────────
    sales_df["_l11_key"] = sales_df["item_id"].astype(str) + "_" + sales_df["state_id"].astype(str)
    l11_keys = sales_df["_l11_key"].unique().tolist()
    print(f"\nL11 groups: {len(l11_keys)}")
    l11_to_idx = {k: np.where(sales_df["_l11_key"] == k)[0] for k in l11_keys}
    l11_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l11_to_idx.items()])
    l11_truth = np.array([truth_matrix[idx].sum(axis=0) for k, idx in l11_to_idx.items()])
    print(f"  L11 train shape: {l11_train.shape}  truth shape: {l11_truth.shape}")
    print(f"  L11 series sizes: min={min(len(idx) for idx in l11_to_idx.values())}  max={max(len(idx) for idx in l11_to_idx.values())}  mean={int(np.mean([len(idx) for idx in l11_to_idx.values()]))}")

    # ── Forecast L11 with TimesFM ───────────────────────────────────────
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L11 ({len(l11_keys):,} series) with TimesFM-2 on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=64, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    histories = []
    for ki in range(len(l11_keys)):
        h = l11_train[ki].astype(np.float32)
        if len(h) > 512:
            h = h[-512:]
        histories.append(h)

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s")
    l11_fc = np.array([np.maximum(0.0, np.asarray(p)[:PREDICTION_LENGTH]) for p in point_fc])

    # Free TimesFM
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Within-(item × state) leaf shares from last 28 train days ───────
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)
    n_leaves = len(leaf_volume)
    td_forecast = np.zeros((n_leaves, PREDICTION_LENGTH), dtype=np.float64)

    for ki, k in enumerate(l11_keys):
        idx = l11_to_idx[k]
        group_total = leaf_volume[idx].sum()
        if group_total > 0:
            within_share = leaf_volume[idx] / group_total
            td_forecast[idx] = within_share[:, None] * l11_fc[ki, None, :]

    print(f"\ntop-down sum across leaves day0: {td_forecast.sum(axis=0)[0]:.1f}")

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — Tier 15")
    print("=" * 78)
    print("\n--- Tier 15 (L11 top-down) ---")
    wrmsse, levels = compute_wrmsse(sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("Tier scorecard")
    print("═" * 78)
    print(f"  Tier 10 (L1, 1 series)            : 0.800")
    print(f"  Tier 12 (L4, 3 series)            : 0.792")
    print(f"  Tier 14 (L9, 70 series)           : 0.713")
    print(f"  Tier 15 (L11, 9,147 series)       : {wrmsse:.4f}")
    print(f"  Seasonal-naive                    : 0.913")
    print()
    print(f"  M5 leaderboard top 100            : 0.554-0.605")
    print(f"  M5 leaderboard median             : ~0.65")
    print(f"  M5 winner                         : 0.520")
    return 0


if __name__ == "__main__":
    sys.exit(main())
