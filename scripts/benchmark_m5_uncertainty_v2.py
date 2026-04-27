"""Tier 19: M5 Uncertainty with proper tail extrapolation.

Tier 18 mapped M5's required quantiles {0.005, 0.025, 0.165, 0.250, 0.500,
0.750, 0.835, 0.975, 0.995} to the nearest of TimesFM's 9 outputs
{0.1, 0.2, ..., 0.9}. The extreme tails (0.005, 0.995) ended up using
q0.1 / q0.9 — heavy overcoverage, which inflates WSPL.

Tier 19 uses piecewise-linear extrapolation in quantile space:

  q0.005 ≈ q0.1 - 1.0 × (q0.2 - q0.1)   # tail step 2× wider than inner
  q0.025 ≈ q0.1 - 0.5 × (q0.2 - q0.1)
  q0.165 ≈ q0.1 + 0.65 × (q0.2 - q0.1)
  q0.250 ≈ q0.2 + 0.50 × (q0.3 - q0.2)
  q0.500 = q0.5
  q0.750 ≈ q0.7 + 0.50 × (q0.8 - q0.7)
  q0.835 ≈ q0.8 + 0.35 × (q0.9 - q0.8)
  q0.975 ≈ q0.9 + 0.5 × (q0.9 - q0.8)
  q0.995 ≈ q0.9 + 1.0 × (q0.9 - q0.8)

This approximates a smooth quantile function and respects monotonicity.

Run:
    python scripts/benchmark_m5_uncertainty_v2.py
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

from m5_wrmsse import M5_LEVELS, compute_level_summing_matrix  # noqa: E402

PREDICTION_LENGTH = 28
TRAIN_END_DAY = 1913

M5_QUANTILES = [0.005, 0.025, 0.165, 0.250, 0.500, 0.750, 0.835, 0.975, 0.995]
TFM_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def extrapolate_quantiles(tfm_q: np.ndarray) -> np.ndarray:
    """Linear extrapolation from TimesFM's 9 quantiles to M5's 9 quantiles.

    Input  shape: (n_l9, horizon, 9) — TimesFM cols indexed by TFM_QUANTILES
    Output shape: (n_l9, horizon, 9) — M5 cols indexed by M5_QUANTILES

    Tail extrapolation uses the spread of the nearest inner quantile pair
    to project beyond q0.1 / q0.9. Values clamped at 0 (sales non-negative).
    """
    q01 = tfm_q[..., 0]
    q02 = tfm_q[..., 1]
    q03 = tfm_q[..., 2]
    q05 = tfm_q[..., 4]
    q07 = tfm_q[..., 6]
    q08 = tfm_q[..., 7]
    q09 = tfm_q[..., 8]

    spread_low = q02 - q01    # (n, h)
    spread_high = q09 - q08

    # M5 quantiles — piecewise linear
    out = np.zeros(tfm_q.shape[:-1] + (9,))
    out[..., 0] = q01 - 1.0 * spread_low   # 0.005
    out[..., 1] = q01 - 0.5 * spread_low   # 0.025
    out[..., 2] = q01 + 0.65 * spread_low  # 0.165 (interp 0.1 → 0.2)
    out[..., 3] = q02 + 0.5 * (q03 - q02)  # 0.250
    out[..., 4] = q05                       # 0.500
    out[..., 5] = q07 + 0.5 * (q08 - q07)  # 0.750
    out[..., 6] = q08 + 0.35 * (q09 - q08) # 0.835 (interp 0.8 → 0.9)
    out[..., 7] = q09 + 0.5 * spread_high  # 0.975
    out[..., 8] = q09 + 1.0 * spread_high  # 0.995

    # Enforce monotonicity (quantile function should be non-decreasing)
    for i in range(1, 9):
        out[..., i] = np.maximum(out[..., i], out[..., i - 1])

    return np.maximum(0.0, out)


def main() -> int:
    print("=" * 78)
    print("Tier 19: M5 Uncertainty WSPL with linear-extrapolated tails")
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

    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])

    # ── Forecast L9 with TimesFM ────────────────────────────────────────
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nforecasting L9 quantiles on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=16, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
            quantiles=tuple(TFM_QUANTILES),
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
        _, qfc = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s")

    # Shape (n_l9, horizon, 9 TFM quantiles)
    l9_tfm_q = np.array([np.asarray(qfc[i])[:PREDICTION_LENGTH, 1:] for i in range(len(l9_keys))])
    l9_tfm_q = np.maximum(0.0, l9_tfm_q)

    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    # ── Extrapolate to M5 quantiles ─────────────────────────────────────
    print("\nextrapolating to M5 quantiles {0.005..0.995}…", flush=True)
    l9_m5_q = extrapolate_quantiles(l9_tfm_q)  # (n_l9, horizon, 9)

    # ── Disaggregate to leaves ──────────────────────────────────────────
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)
    n_leaves = len(leaf_volume)
    leaf_shares = np.zeros(n_leaves)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares[idx] = leaf_volume[idx] / gt

    # leaf_q_forecast[mqi, leaf, day]
    leaf_q_forecast = np.zeros((9, n_leaves, PREDICTION_LENGTH), dtype=np.float64)
    for mqi in range(9):
        for ki, k in enumerate(l9_keys):
            idx = l9_to_idx[k]
            leaf_q_forecast[mqi, idx, :] = leaf_shares[idx, None] * l9_m5_q[ki, :, mqi][None, :]

    # ── WSPL across 12 levels ───────────────────────────────────────────
    print("\n" + "=" * 78)
    print("WSPL across 12 levels × 9 M5 quantiles")
    print("=" * 78)

    print("  building series weights …", flush=True)
    d_to_week = dict(zip(calendar["d"], calendar["wm_yr_wk"]))
    last28_days = [f"d_{i}" for i in range(TRAIN_END_DAY - 27, TRAIN_END_DAY + 1)]
    last28_weeks = [d_to_week[d] for d in last28_days]
    leaf_keys = sales_df[["store_id", "item_id"]].copy()
    leaf_keys["leaf_idx"] = np.arange(n_leaves)
    revenues = np.zeros(n_leaves, dtype=np.float64)
    for di in range(28):
        wk = last28_weeks[di]
        week_prices = sell_prices[sell_prices["wm_yr_wk"] == wk][["store_id", "item_id", "sell_price"]]
        merged = leaf_keys.merge(week_prices, on=["store_id", "item_id"], how="left")
        prices = merged["sell_price"].fillna(0.0).to_numpy()
        revenues += last28[:, di].astype(np.float64) * prices

    level_contributions = []
    for level_name, keys in M5_LEVELS:
        S, _ = compute_level_summing_matrix(sales_df, keys)
        n_groups = S.shape[0]
        train_lvl = S @ train_matrix
        truth_lvl = S @ truth_matrix
        revenue_lvl = S @ revenues
        q_lvl = np.einsum("gn,qnh->qgh", S, leaf_q_forecast)

        diffs = np.diff(train_lvl, axis=1)
        scale = np.mean(diffs ** 2, axis=1)
        scale = np.where(scale == 0, 1.0, scale)
        scale_sqrt = np.sqrt(scale)

        level_pl_per_group = np.zeros(n_groups)
        for mqi, q in enumerate(M5_QUANTILES):
            err = truth_lvl - q_lvl[mqi]
            pinball = np.maximum(q * err, (q - 1) * err)
            level_pl_per_group += np.mean(pinball, axis=1) / scale_sqrt
        level_pl_per_group /= len(M5_QUANTILES)

        w = revenue_lvl / max(revenue_lvl.sum(), 1e-9)
        contribution = float(np.sum(w * level_pl_per_group))
        level_contributions.append(contribution)
        print(f"    {level_name:<22} n={n_groups:>6,}  WSPL_ℓ = {contribution:.4f}")

    overall = float(np.mean(level_contributions))
    print(f"\n  → WSPL = {overall:.4f}")

    print("\n" + "═" * 78)
    print("M5 UNCERTAINTY LEADERBOARD")
    print("═" * 78)
    print(f"  Winner WSPL          : 0.157")
    print(f"  Top 10               : 0.157-0.175")
    print(f"  Top 100              : 0.190-0.220")
    print()
    print(f"  Tier 18 (clamped tails)         : 0.1705")
    print(f"  Tier 19 (extrapolated tails)    : {overall:.4f}  ← this run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
