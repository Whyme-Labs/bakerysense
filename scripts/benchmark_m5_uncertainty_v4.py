"""Tier 21: M5 Uncertainty — 3-level hybrid (L9 + L10 + L11).

Tier 20 used L9 for L1-L9 and L10 for L10-L12. WSPL 0.1427.

Tier 21 adds L11 (item × state, 9,147 series) for L11-L12. Each level
uses the most-direct forecast available:

  L1-L9:   L9 forecast (70 series), within-L9 leaf shares
  L10:     L10 forecast (3,049 series), self
  L11-L12: L11 forecast (9,147 series), within-L11 leaf shares

Total: 70 + 3,049 + 9,147 = 12,266 TimesFM forecasts. ~10 min compute.

Run:
    python scripts/benchmark_m5_uncertainty_v4.py
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


def forecast_with_timesfm(train_arrays, horizon, batch_size=64):
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
            backend=backend, per_core_batch_size=batch_size, horizon_len=128, context_len=512,
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
    print("Tier 21: M5 Uncertainty — 3-level hybrid (L9 + L10 + L11)")
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

    # ── Aggregations ────────────────────────────────────────────────────
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

    # ── Forecast each level ─────────────────────────────────────────────
    print(f"\nforecasting L9 ({len(l9_keys)})…", flush=True)
    t0 = time.time()
    l9_q = forecast_with_timesfm(list(l9_train), PREDICTION_LENGTH, batch_size=16)
    print(f"  done in {time.time() - t0:.1f}s")

    print(f"forecasting L10 ({len(l10_keys)})…", flush=True)
    t0 = time.time()
    l10_q = forecast_with_timesfm(list(l10_train), PREDICTION_LENGTH, batch_size=64)
    print(f"  done in {time.time() - t0:.1f}s")

    print(f"forecasting L11 ({len(l11_keys)})…", flush=True)
    t0 = time.time()
    l11_q = forecast_with_timesfm(list(l11_train), PREDICTION_LENGTH, batch_size=64)
    print(f"  done in {time.time() - t0:.1f}s")

    # ── Extrapolate to M5 quantiles ─────────────────────────────────────
    l9_m5 = extrapolate_quantiles(l9_q)
    l10_m5 = extrapolate_quantiles(l10_q)
    l11_m5 = extrapolate_quantiles(l11_q)

    # ── Build leaf forecasts from each source ───────────────────────────
    last28 = train_matrix[:, -28:]
    leaf_volume = last28.sum(axis=1)

    # within-L9 shares
    leaf_shares_l9 = np.zeros(n_leaves)
    for ki, k in enumerate(l9_keys):
        idx = l9_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l9[idx] = leaf_volume[idx] / gt

    # within-L10 (item) shares — used only when no within-L11 path
    leaf_shares_l10 = np.zeros(n_leaves)
    for ki, k in enumerate(l10_keys):
        idx = l10_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l10[idx] = leaf_volume[idx] / gt

    # within-L11 (item × state) shares
    leaf_shares_l11 = np.zeros(n_leaves)
    for ki, k in enumerate(l11_keys):
        idx = l11_to_idx[k]; gt = leaf_volume[idx].sum()
        if gt > 0:
            leaf_shares_l11[idx] = leaf_volume[idx] / gt

    # Three leaf-level forecast tensors
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

    # ── WSPL with per-level routing ─────────────────────────────────────
    print("\n" + "=" * 78)
    print("WSPL — Tier 21 routing: L9 for L1-L9, L10 for L10, L11 for L11-L12")
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

    # Routing: L9-based for L1..L9, L10-based for L10, L11-based for L11..L12
    l9_levels = {"L1_total", "L2_state", "L3_store", "L4_category", "L5_department",
                 "L6_state_cat", "L7_state_dept", "L8_store_cat", "L9_store_dept"}
    l10_levels = {"L10_item"}
    # L11_item_state, L12_item_store → use L11 path

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
    print("History")
    print("═" * 78)
    print(f"  Tier 18 (L9 only, clamped):                 0.1705")
    print(f"  Tier 19 (L9 only, extrapolated):            0.1638")
    print(f"  Tier 20 (L9 upper + L10 lower):             0.1427")
    print(f"  Tier 21 (L9 + L10 + L11 routing):           {overall:.4f}  ← this run")
    print()
    print(f"  M5 winner WSPL                              : 0.157")
    return 0


if __name__ == "__main__":
    sys.exit(main())
