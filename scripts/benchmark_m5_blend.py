"""Tier 13: M5 — 50/50 blend of Tier 10 (L1 top-down) and Tier 12 (L4 top-down).

Both Tier 10 (0.800) and Tier 12 (0.792) are "top-down" reconciliations
at different levels of aggregation. They capture different signals:
  • Tier 10's L1 TimesFM forecast is best at the TOTAL level (RMSSE 0.598)
  • Tier 12's L4 TimesFM forecasts are best at category level (RMSSE 0.619)

A 50/50 average of their leaf forecasts is the cheapest way to combine
the two — just matrix average, no extra TimesFM calls. If signals are
uncorrelated, blending should reduce variance.

Run:
    python scripts/benchmark_m5_blend.py
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
    print("Tier 13: M5 — 50/50 blend of L1 + L4 top-down")
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

    # ── Forecast L1 + L4 (4 series total) with TimesFM ──────────────────
    cats = sales_df["cat_id"].unique().tolist()
    cat_to_idx = {c: np.where(sales_df["cat_id"] == c)[0] for c in cats}

    total_train = train_matrix.sum(axis=0)
    l4_train = np.array([train_matrix[idx].sum(axis=0) for c, idx in cat_to_idx.items()])

    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L1 + L4 with TimesFM-2 (4 series total)…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=8, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    histories = []
    histories.append(total_train.astype(np.float32)[-512:])
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

    total_fc = np.maximum(0.0, np.asarray(point_fc[0])[:PREDICTION_LENGTH])
    l4_fc = np.array([np.maximum(0.0, np.asarray(point_fc[ci + 1])[:PREDICTION_LENGTH]) for ci in range(len(cats))])
    print(f"  L1 forecast mean: {total_fc.mean():.0f}")
    for ci, c in enumerate(cats):
        print(f"  L4 {c} forecast mean: {l4_fc[ci].mean():.0f}")

    # Free TimesFM
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Build Tier 10 (L1 top-down) leaf forecasts ──────────────────────
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)
    leaf_shares_total = leaf_volume / max(leaf_volume.sum(), 1e-9)
    t10_forecast = leaf_shares_total[:, None] * total_fc[None, :]

    # ── Build Tier 12 (L4 top-down) leaf forecasts ──────────────────────
    n_leaves = len(leaf_volume)
    t12_forecast = np.zeros((n_leaves, PREDICTION_LENGTH), dtype=np.float64)
    for ci, c in enumerate(cats):
        idx = cat_to_idx[c]
        cat_total = leaf_volume[idx].sum()
        if cat_total > 0:
            within_share = leaf_volume[idx] / cat_total
            t12_forecast[idx] = within_share[:, None] * l4_fc[ci, None, :]

    # ── 50/50 blend ─────────────────────────────────────────────────────
    blend = 0.5 * t10_forecast + 0.5 * t12_forecast

    # ── WRMSSE comparison ───────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE comparison")
    print("=" * 78)

    print("\n--- Tier 10 (L1 top-down) ---")
    t10_w, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, t10_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {t10_w:.4f}")

    print("\n--- Tier 12 (L4 top-down) ---")
    t12_w, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, t12_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {t12_w:.4f}")

    print("\n--- Tier 13 (50/50 BLEND) ---")
    bl_w, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, blend, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {bl_w:.4f}")

    print("\n" + "═" * 78)
    print("Summary")
    print("═" * 78)
    print(f"  Bottom-up TimesFM:        WRMSSE 1.864")
    print(f"  Tier 10 (L1 top-down):    WRMSSE {t10_w:.4f}")
    print(f"  Tier 12 (L4 top-down):    WRMSSE {t12_w:.4f}")
    print(f"  Tier 13 (50/50 blend):    WRMSSE {bl_w:.4f}")
    print(f"  Seasonal-naive:           WRMSSE 0.913")
    print()
    print(f"  M5 leaderboard top 100:   0.554-0.605")
    print(f"  M5 leaderboard median:    ~0.65")
    print(f"  M5 winner:                0.520")
    return 0


if __name__ == "__main__":
    sys.exit(main())
