"""Tier 20: M5 Uncertainty with hybrid L9/L10 quantile forecasts.

Tier 19 used L9 (70 series) for ALL 12 levels. WSPL 0.1638. The L1-L9
levels were excellent (0.11-0.14) but L10-L12 were weak (0.26-0.33).

Tier 20 adds direct forecasts at L10 (3,049 item-level series). For
the L10-L12 levels, use L10 quantile forecasts + within-item store
shares. For L1-L9, keep the L9-based approach. Each level uses the
forecast that was DIRECTLY targeted at it.

Run:
    python scripts/benchmark_m5_uncertainty_v3.py
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
    """Same piecewise-linear extrapolation as Tier 19."""
    q01, q02, q03, q05, q07, q08, q09 = (
        tfm_q[..., 0], tfm_q[..., 1], tfm_q[..., 2], tfm_q[..., 4],
        tfm_q[..., 6], tfm_q[..., 7], tfm_q[..., 8],
    )
    spread_low = q02 - q01
    spread_high = q09 - q08
    out = np.zeros(tfm_q.shape[:-1] + (9,))
    out[..., 0] = q01 - 1.0 * spread_low
    out[..., 1] = q01 - 0.5 * spread_low
    out[..., 2] = q01 + 0.65 * spread_low
    out[..., 3] = q02 + 0.5 * (q03 - q02)
    out[..., 4] = q05
    out[..., 5] = q07 + 0.5 * (q08 - q07)
    out[..., 6] = q08 + 0.35 * (q09 - q08)
    out[..., 7] = q09 + 0.5 * spread_high
    out[..., 8] = q09 + 1.0 * spread_high
    for i in range(1, 9):
        out[..., i] = np.maximum(out[..., i], out[..., i - 1])
    return np.maximum(0.0, out)


def forecast_with_timesfm(train_arrays: list[np.ndarray], horizon: int):
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=64, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
            quantiles=tuple(TFM_QUANTILES),
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    histories = [h[-512:].astype(np.float32) if len(h) > 512 else h.astype(np.float32) for h in train_arrays]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, qfc = tfm.forecast(histories, freq=[0] * len(histories))
    out = np.array([np.asarray(qfc[i])[:horizon, 1:] for i in range(len(histories))])
    out = np.maximum(0.0, out)

    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass
    return out


def main() -> int:
    print("=" * 78)
    print("Tier 20: M5 Uncertainty — hybrid L9 + L10 quantile forecasts")
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

    n_leaves = train_matrix.shape[0]

    # ── L9 aggregation + forecast ───────────────────────────────────────
    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])

    # ── L10 aggregation (3,049 items) ──────────────────────────────────
    l10_keys = sales_df["item_id"].unique().tolist()
    l10_to_idx = {k: np.where(sales_df["item_id"] == k)[0] for k in l10_keys}
    l10_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l10_to_idx.items()])
    print(f"\nL9 series: {len(l9_keys)}  ·  L10 series: {len(l10_keys)}")

    # ── Forecast both levels ────────────────────────────────────────────
    print(f"\nforecasting L9 ({len(l9_keys)} series)…", flush=True)
    t0 = time.time()
    l9_tfm_q = forecast_with_timesfm(list(l9_train), PREDICTION_LENGTH)
    print(f"  done in {time.time() - t0:.1f}s")

    print(f"forecasting L10 ({len(l10_keys)} series)…", flush=True)
    t0 = time.time()
    l10_tfm_q = forecast_with_timesfm(list(l10_train), PREDICTION_LENGTH)
    print(f"  done in {time.time() - t0:.1f}s")

    # ── Extrapolate to M5 quantiles ─────────────────────────────────────
    l9_m5_q = extrapolate_quantiles(l9_tfm_q)
    l10_m5_q = extrapolate_quantiles(l10_tfm_q)

    # ── Build leaf forecasts: L10-disagg for L12 (per-store within item) ──
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)

    # within-item store shares (used for L12 = L10 × store-share)
    leaf_shares_within_item = np.zeros(n_leaves)
    for ki, k in enumerate(l10_keys):
        idx = l10_to_idx[k]
        gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_within_item[idx] = leaf_volume[idx] / gt

    # within-L9 leaf shares (used for L1..L9)
    leaf_shares_within_l9 = np.zeros(n_leaves)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_within_l9[idx] = leaf_volume[idx] / gt

    # Build the leaf-level quantile forecast from each source
    leaf_q_from_l9 = np.zeros((9, n_leaves, PREDICTION_LENGTH))
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        for mqi in range(9):
            leaf_q_from_l9[mqi, idx, :] = leaf_shares_within_l9[idx, None] * l9_m5_q[ki, :, mqi][None, :]

    leaf_q_from_l10 = np.zeros((9, n_leaves, PREDICTION_LENGTH))
    for ki, k in enumerate(l10_keys):
        idx = l10_to_idx[k]
        for mqi in range(9):
            leaf_q_from_l10[mqi, idx, :] = leaf_shares_within_item[idx, None] * l10_m5_q[ki, :, mqi][None, :]

    # ── WSPL — per-level we choose which leaf-forecast to AGGREGATE from ──
    print("\n" + "=" * 78)
    print("WSPL (Tier 20: L9 for upper levels, L10 for lower levels)")
    print("=" * 78)

    # Series weights
    print("  building series weights…", flush=True)
    d_to_week = dict(zip(calendar["d"], calendar["wm_yr_wk"]))
    last28_days = [f"d_{i}" for i in range(TRAIN_END_DAY - 27, TRAIN_END_DAY + 1)]
    last28_weeks = [d_to_week[d] for d in last28_days]
    leaf_keys = sales_df[["store_id", "item_id"]].copy()
    revenues = np.zeros(n_leaves, dtype=np.float64)
    for di in range(28):
        wk = last28_weeks[di]
        week_prices = sell_prices[sell_prices["wm_yr_wk"] == wk][["store_id", "item_id", "sell_price"]]
        merged = leaf_keys.merge(week_prices, on=["store_id", "item_id"], how="left")
        prices = merged["sell_price"].fillna(0.0).to_numpy()
        revenues += last28[:, di].astype(np.float64) * prices

    # Decide split level: L1-L9 use L9-based leaves; L10-L12 use L10-based leaves
    # L9-based level mask
    l9_levels = {"L1_total", "L2_state", "L3_store", "L4_category", "L5_department",
                 "L6_state_cat", "L7_state_dept", "L8_store_cat", "L9_store_dept"}

    level_contributions = []
    for level_name, keys in M5_LEVELS:
        S, _ = compute_level_summing_matrix(sales_df, keys)
        n_groups = S.shape[0]
        train_lvl = S @ train_matrix
        truth_lvl = S @ truth_matrix
        revenue_lvl = S @ revenues

        # choose source leaf forecasts
        leaf_q = leaf_q_from_l9 if level_name in l9_levels else leaf_q_from_l10
        q_lvl = np.einsum("gn,qnh->qgh", S, leaf_q)

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
        src = "L9" if level_name in l9_levels else "L10"
        print(f"    {level_name:<22} n={n_groups:>6,}  WSPL_ℓ = {contribution:.4f}  [{src}-disagg]")

    overall = float(np.mean(level_contributions))
    print(f"\n  → WSPL = {overall:.4f}")

    print("\n" + "═" * 78)
    print("Reference + history")
    print("═" * 78)
    print(f"  Tier 18 (clamped, L9 only)        : 0.1705")
    print(f"  Tier 19 (extrapolated, L9 only)   : 0.1638")
    print(f"  Tier 20 (L9 upper + L10 lower)    : {overall:.4f}  ← this run")
    print()
    print(f"  M5 winner WSPL                    : 0.157")
    print(f"  Top 5                             : ~0.157-0.165")
    print(f"  Top 10                            : 0.157-0.175")
    return 0


if __name__ == "__main__":
    sys.exit(main())
