"""Tier 23: Chronos head-to-head with TimesFM on M5 Uncertainty.

Same Tier 21 architecture (L9 + L10 + L11 quantile forecasts,
leaf-share disaggregation, M5 Uncertainty WSPL) but using
amazon/chronos-bolt-base instead of TimesFM-2.

If Chronos+Tier21 ≈ TimesFM+Tier21, the architecture is doing the heavy
lifting. If only TimesFM gets to 0.138, the foundation model matters too.

Run:
    python scripts/benchmark_m5_chronos.py
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
# Chronos-Bolt outputs these by default
CHRONOS_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def extrapolate_quantiles(chronos_q: np.ndarray) -> np.ndarray:
    """Same piecewise-linear extrapolation as Tier 19/20/21."""
    q01, q02, q03, q05, q07, q08, q09 = (
        chronos_q[..., 0], chronos_q[..., 1], chronos_q[..., 2], chronos_q[..., 4],
        chronos_q[..., 6], chronos_q[..., 7], chronos_q[..., 8],
    )
    spread_low = q02 - q01
    spread_high = q09 - q08
    out = np.zeros(chronos_q.shape[:-1] + (9,))
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


def forecast_with_chronos(train_arrays, horizon, pipeline, batch_size=32):
    """Per-batch quantile forecasting with Chronos-Bolt. Returns (n, h, 9)."""
    import torch

    out_list = []
    histories = [h[-2048:].astype(np.float32) if len(h) > 2048 else h.astype(np.float32) for h in train_arrays]

    for i in range(0, len(histories), batch_size):
        batch = histories[i:i + batch_size]
        # Stack into a single (batch, length) tensor — pad to max length
        max_len = max(len(h) for h in batch)
        padded = [np.concatenate([np.zeros(max_len - len(h), dtype=np.float32), h]) for h in batch]
        inputs = torch.tensor(np.stack(padded, axis=0), dtype=torch.float32)
        # predict_quantiles returns (quantiles, mean) where quantiles shape is
        # (batch_size, prediction_length, num_quantiles)
        quantiles, mean = pipeline.predict_quantiles(
            inputs,
            prediction_length=horizon,
            quantile_levels=CHRONOS_QUANTILES,
        )
        out_list.append(quantiles.cpu().numpy())
    return np.maximum(0.0, np.concatenate(out_list, axis=0))


def main() -> int:
    print("=" * 78)
    print("Tier 23: Chronos head-to-head — same Tier 21 architecture")
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

    sales_df["_l9_key"] = sales_df["store_id"].astype(str) + "_" + sales_df["dept_id"].astype(str)
    l9_keys = sales_df["_l9_key"].unique().tolist()
    l9_to_idx = {k: np.where(sales_df["_l9_key"] == k)[0] for k in l9_keys}
    l9_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l9_to_idx.items()])

    l10_keys = sales_df["item_id"].unique().tolist()
    l10_to_idx = {k: np.where(sales_df["item_id"] == k)[0] for k in l10_keys}
    l10_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l10_to_idx.items()])

    sales_df["_l11_key"] = sales_df["item_id"].astype(str) + "_" + sales_df["state_id"].astype(str)
    l11_keys = sales_df["_l11_key"].unique().tolist()
    l11_to_idx = {k: np.where(sales_df["_l11_key"] == k)[0] for k in l11_keys}
    l11_train = np.array([train_matrix[idx].sum(axis=0) for k, idx in l11_to_idx.items()])

    print(f"\nL9: {len(l9_keys)}  ·  L10: {len(l10_keys)}  ·  L11: {len(l11_keys)}")

    # Load Chronos-Bolt
    from chronos import BaseChronosPipeline
    import torch
    device = "cpu"
    if torch.backends.mps.is_available():
        device = "mps"

    print(f"\nloading Chronos-Bolt-Base on device={device}…", flush=True)
    t0 = time.time()
    pipeline = BaseChronosPipeline.from_pretrained(
        "amazon/chronos-bolt-base",
        device_map=device,
        torch_dtype=torch.float32,
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    # Forecast each level
    print(f"\nforecasting L9 ({len(l9_keys)})…", flush=True)
    t0 = time.time()
    l9_q = forecast_with_chronos(list(l9_train), PREDICTION_LENGTH, pipeline)
    print(f"  done in {time.time() - t0:.1f}s")

    print(f"forecasting L10 ({len(l10_keys)})…", flush=True)
    t0 = time.time()
    l10_q = forecast_with_chronos(list(l10_train), PREDICTION_LENGTH, pipeline)
    print(f"  done in {time.time() - t0:.1f}s")

    print(f"forecasting L11 ({len(l11_keys)})…", flush=True)
    t0 = time.time()
    l11_q = forecast_with_chronos(list(l11_train), PREDICTION_LENGTH, pipeline)
    print(f"  done in {time.time() - t0:.1f}s")

    del pipeline
    import gc; gc.collect()

    # Extrapolate to M5 quantiles
    l9_m5 = extrapolate_quantiles(l9_q)
    l10_m5 = extrapolate_quantiles(l10_q)
    l11_m5 = extrapolate_quantiles(l11_q)

    # Build leaf forecasts
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)

    leaf_shares_l9 = np.zeros(n_leaves)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l9[idx] = leaf_volume[idx] / gt

    leaf_shares_l10 = np.zeros(n_leaves)
    for ki, k in enumerate(l10_keys):
        idx = l10_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l10[idx] = leaf_volume[idx] / gt

    leaf_shares_l11 = np.zeros(n_leaves)
    for ki, k in enumerate(l11_keys):
        idx = l11_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l11[idx] = leaf_volume[idx] / gt

    leaf_q_from_l9 = np.zeros((9, n_leaves, PREDICTION_LENGTH))
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]
        for mqi in range(9):
            leaf_q_from_l9[mqi, idx] = leaf_shares_l9[idx, None] * l9_m5[ki, :, mqi][None, :]

    leaf_q_from_l10 = np.zeros((9, n_leaves, PREDICTION_LENGTH))
    for ki, k in enumerate(l10_keys):
        idx = l10_to_idx[k]
        for mqi in range(9):
            leaf_q_from_l10[mqi, idx] = leaf_shares_l10[idx, None] * l10_m5[ki, :, mqi][None, :]

    leaf_q_from_l11 = np.zeros((9, n_leaves, PREDICTION_LENGTH))
    for ki, k in enumerate(l11_keys):
        idx = l11_to_idx[k]
        for mqi in range(9):
            leaf_q_from_l11[mqi, idx] = leaf_shares_l11[idx, None] * l11_m5[ki, :, mqi][None, :]

    # WSPL with per-level routing (Tier 21 schedule)
    print("\n" + "=" * 78)
    print("WSPL — Chronos with Tier 21 architecture")
    print("=" * 78)

    print("  building series weights…", flush=True)
    d_to_week = dict(zip(calendar["d"], calendar["wm_yr_wk"]))
    last28_days = [f"d_{i}" for i in range(TRAIN_END_DAY - 27, TRAIN_END_DAY + 1)]
    last28_weeks = [d_to_week[d] for d in last28_days]
    leaf_keys_df = sales_df[["store_id", "item_id"]].copy()
    revenues = np.zeros(n_leaves, dtype=np.float64)
    for di in range(28):
        wk = last28_weeks[di]
        wp = sell_prices[sell_prices["wm_yr_wk"] == wk][["store_id", "item_id", "sell_price"]]
        merged = leaf_keys_df.merge(wp, on=["store_id", "item_id"], how="left")
        prices = merged["sell_price"].fillna(0.0).to_numpy()
        revenues += last28[:, di].astype(np.float64) * prices

    l9_levels = {"L1_total", "L2_state", "L3_store", "L4_category", "L5_department",
                 "L6_state_cat", "L7_state_dept", "L8_store_cat", "L9_store_dept"}
    l10_levels = {"L10_item"}

    level_contributions = []
    for level_name, keys in M5_LEVELS:
        S, _ = compute_level_summing_matrix(sales_df, keys)
        n_groups = S.shape[0]
        train_lvl = S @ train_matrix
        truth_lvl = S @ truth_matrix
        revenue_lvl = S @ revenues

        if level_name in l9_levels:
            leaf_q = leaf_q_from_l9; src = "L9"
        elif level_name in l10_levels:
            leaf_q = leaf_q_from_l10; src = "L10"
        else:
            leaf_q = leaf_q_from_l11; src = "L11"

        q_lvl = np.einsum("gn,qnh->qgh", S, leaf_q)
        diffs = np.diff(train_lvl, axis=1)
        scale = np.mean(diffs ** 2, axis=1)
        scale = np.where(scale == 0, 1.0, scale)
        scale_sqrt = np.sqrt(scale)

        level_pl = np.zeros(n_groups)
        for mqi, q in enumerate(M5_QUANTILES):
            err = truth_lvl - q_lvl[mqi]
            level_pl += np.mean(np.maximum(q * err, (q - 1) * err), axis=1) / scale_sqrt
        level_pl /= len(M5_QUANTILES)

        w = revenue_lvl / max(revenue_lvl.sum(), 1e-9)
        contribution = float(np.sum(w * level_pl))
        level_contributions.append(contribution)
        print(f"    {level_name:<22} n={n_groups:>6,}  WSPL_ℓ = {contribution:.4f}  [{src}]")

    overall = float(np.mean(level_contributions))
    print(f"\n  → WSPL = {overall:.4f}")

    print("\n" + "═" * 78)
    print("Architecture vs model: head-to-head on M5 Uncertainty validation")
    print("═" * 78)
    print(f"  Tier 21 with TimesFM-2.0-500m  : 0.1379")
    print(f"  Tier 23 with Chronos-Bolt-Base : {overall:.4f}  ← this run")
    print()
    print(f"  M5 winner WSPL                 : 0.157")
    print()
    print("If close: architecture is the win.")
    print("If big gap: the foundation model matters too.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
