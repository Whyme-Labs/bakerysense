"""Tier 17: M5 — TimesFM at L9 + day-of-week-aware leaf shares.

Tier 14 used static (last-28-day) within-group shares, applied to all
28 forecast days. But leaves may have different dow patterns within a
group. E.g., one item sells more on Sundays, another on weekdays.
Static shares don't capture that.

This tier uses per-dow shares: share_i_d = volume_i_dow_d /
total_volume_in_group_dow_d. Multiply leaf forecast by the right dow
share for each day in the forecast horizon.

Run:
    python scripts/benchmark_m5_l9_dow.py
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
    print("Tier 17: M5 — TimesFM L9 + day-of-week-aware leaf shares")
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

    # Aggregate to L9
    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])

    # M5 day 1 = 2011-01-29 (Saturday). Compute dow for every train day.
    series_start = pd.Timestamp("2011-01-29")
    train_n = train_matrix.shape[1]
    train_dow = np.array([(series_start + pd.Timedelta(days=i)).dayofweek for i in range(train_n)])

    # Forecast L9 with TimesFM
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
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Per-dow leaf shares from last 84 train days (12 weeks) ──────────
    # Use 84 days so each dow has 12 observations to average over.
    last84 = train_matrix[:, -84:]
    last84_dow = train_dow[-84:]

    n_leaves = train_matrix.shape[0]
    # leaf_dow_volume[i, d] = total units sold by leaf i on dow d (over 12 weeks)
    leaf_dow_volume = np.zeros((n_leaves, 7), dtype=np.float64)
    for d in range(7):
        leaf_dow_volume[:, d] = last84[:, last84_dow == d].sum(axis=1)

    # Within-group dow share: share_i_d = leaf_dow_vol_i_d / sum(leaf_dow_vol in group, dow d)
    leaf_dow_share = np.zeros_like(leaf_dow_volume)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        group_dow_total = leaf_dow_volume[idx].sum(axis=0)  # (7,)
        for d in range(7):
            if group_dow_total[d] > 0:
                leaf_dow_share[idx, d] = leaf_dow_volume[idx, d] / group_dow_total[d]

    print(f"\nleaf dow-share stats: mean={leaf_dow_share.mean():.6f}  max={leaf_dow_share.max():.4f}")
    print(f"  dow share sums (per group, per dow) sanity: {[float(s) for s in leaf_dow_share[l9_to_idx[l9_keys[0]]].sum(axis=0)]}")

    # ── Forecast horizon dow ────────────────────────────────────────────
    forecast_start = series_start + pd.Timedelta(days=TRAIN_END_DAY)
    horizon_dows = np.array([(forecast_start + pd.Timedelta(days=i)).dayofweek for i in range(PREDICTION_LENGTH)])
    print(f"  forecast start: {forecast_start.date()} ({['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][horizon_dows[0]]})")

    # ── Disaggregate using per-dow shares ──────────────────────────────
    td_forecast = np.zeros((n_leaves, PREDICTION_LENGTH), dtype=np.float64)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        for j in range(PREDICTION_LENGTH):
            d = horizon_dows[j]
            td_forecast[idx, j] = leaf_dow_share[idx, d] * l9_fc[ki, j]

    print(f"\ntop-down sum across leaves day0: {td_forecast.sum(axis=0)[0]:.1f}  vs L9 fc day0: {l9_fc[:, 0].sum():.1f}")

    # ── WRMSSE ──────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WRMSSE — Tier 17 vs Tier 14")
    print("=" * 78)
    print("\n--- Tier 17 (TimesFM L9 + dow-aware leaf shares) ---")
    wrmsse, _ = compute_wrmsse(sales_df, train_matrix, truth_matrix, td_forecast, sell_prices, calendar, TRAIN_END_DAY)
    print(f"  → WRMSSE = {wrmsse:.4f}")

    print("\n" + "═" * 78)
    print("Tier scorecard — does dow-aware disaggregation help?")
    print("═" * 78)
    print(f"  Tier 14 (TimesFM L9, static shares):      0.7125")
    print(f"  Tier 17 (TimesFM L9, dow-aware shares):   {wrmsse:.4f}  ← this run")
    print()
    print(f"  M5 leaderboard top 100  : 0.554-0.605")
    print(f"  M5 leaderboard median   : ~0.65")
    return 0


if __name__ == "__main__":
    sys.exit(main())
