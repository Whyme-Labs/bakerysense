"""WRMSSE (Weighted Root Mean Squared Scaled Error) — the official M5
Forecasting Accuracy metric. Reproduces the formulation in:

  Makridakis, Spiliotis, Assimakopoulos (2022). "M5 accuracy
  competition: Results, findings, and conclusions." Int. J. Forecasting.

Hierarchy (12 levels):
   1: total                                             1 series
   2: state (CA, TX, WI)                                3
   3: store                                             10
   4: category (FOODS, HOUSEHOLD, HOBBIES)              3
   5: department                                        7
   6: state × category                                  9
   7: state × department                                21
   8: store × category                                  30
   9: store × department                                70
  10: item                                              3,049
  11: item × state                                      9,147
  12: item × store                                      30,490

Total series across all levels: 42,840.

For each level ℓ:
  RMSSE_ℓ = sqrt( mean((Y_h - F_h)^2 / scale_ℓ) )
  scale_ℓ = mean( (Y_train_t - Y_train_{t-1})^2 )  over the training period

Weight w_ℓ for each level is the share of total sales-dollar volume
contributed by that level's series in the last 28 days of training.

The final WRMSSE is the simple AVERAGE across the 12 levels:
  WRMSSE = (1/12) * sum_{ℓ=1..12}( sum_i (w_{ℓ,i} * RMSSE_{ℓ,i}) )

This module is callable from benchmark_m5.py — see compute_wrmsse below.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _aggregate_series(
    sales_long: pd.DataFrame,
    series_keys: list[str] | None,
    day_cols: list[str],
) -> tuple[np.ndarray, list[str]]:
    """Group `sales_long` (one row per item × store × day) by the
    composite key formed from `series_keys`, summing day_cols. Returns
    (matrix [n_groups × n_days], group_ids)."""
    if series_keys is None or len(series_keys) == 0:
        agg = sales_long[day_cols].sum(axis=0).to_numpy().reshape(1, -1)
        return agg, ["TOTAL"]
    grouped = sales_long.groupby(series_keys)[day_cols].sum()
    return grouped.to_numpy(), grouped.index.astype(str).tolist()


def compute_level_summing_matrix(
    sales_train: pd.DataFrame, level_keys: list[str] | None,
) -> tuple[np.ndarray, list[str]]:
    """For one M5 level, return (S_matrix [n_groups × 30490], group_ids).
    S_matrix[g, j] = 1 iff series j (item × store) belongs to group g."""
    cols_to_keep = ["item_id", "dept_id", "cat_id", "store_id", "state_id"]
    base = sales_train[cols_to_keep].copy()
    base["leaf_idx"] = np.arange(len(base))
    if level_keys is None or len(level_keys) == 0:
        S = np.ones((1, len(base)), dtype=np.float32)
        return S, ["TOTAL"]
    grouped = base.groupby(level_keys)
    n_groups = len(grouped)
    S = np.zeros((n_groups, len(base)), dtype=np.float32)
    group_ids: list[str] = []
    for gi, (key, gdf) in enumerate(grouped):
        S[gi, gdf["leaf_idx"].to_numpy()] = 1.0
        group_ids.append(str(key))
    return S, group_ids


M5_LEVELS = [
    ("L1_total",         None),
    ("L2_state",         ["state_id"]),
    ("L3_store",         ["store_id"]),
    ("L4_category",      ["cat_id"]),
    ("L5_department",    ["dept_id"]),
    ("L6_state_cat",     ["state_id", "cat_id"]),
    ("L7_state_dept",    ["state_id", "dept_id"]),
    ("L8_store_cat",     ["store_id", "cat_id"]),
    ("L9_store_dept",    ["store_id", "dept_id"]),
    ("L10_item",         ["item_id"]),
    ("L11_item_state",   ["item_id", "state_id"]),
    ("L12_item_store",   ["item_id", "store_id"]),
]


def compute_wrmsse(
    sales_df: pd.DataFrame,
    train_matrix: np.ndarray,   # (30490, n_train_days)
    truth_matrix: np.ndarray,   # (30490, 28)
    forecast_matrix: np.ndarray, # (30490, 28)
    sell_prices: pd.DataFrame,
    calendar: pd.DataFrame,
    train_end_day: int = 1913,
) -> tuple[float, dict[str, float]]:
    """Compute WRMSSE per the M5 spec.

    Returns (overall_wrmsse, per_level_dict)."""
    n_leaves = train_matrix.shape[0]
    h = truth_matrix.shape[1]
    assert forecast_matrix.shape == truth_matrix.shape

    # ── Compute series weights ──────────────────────────────────────────
    # Weight per level-12 series = revenue contribution in the last 28
    # training days. revenue_{i,t} = units_sold_{i,t} * sell_price_{i,t}
    # Aggregate at upper levels by summing constituent revenues.
    print("  building series weights from last 28 train days …", flush=True)

    # Map d_X → wm_yr_wk so we can join sell_prices
    d_to_week = dict(zip(calendar["d"], calendar["wm_yr_wk"]))
    last28_days = [f"d_{i}" for i in range(train_end_day - 27, train_end_day + 1)]
    last28_weeks = [d_to_week[d] for d in last28_days]

    # For each (store, item, wm_yr_wk) we have a price. Build a fast
    # lookup keyed by (store_id, item_id, wm_yr_wk).
    price_idx = sell_prices.set_index(["store_id", "item_id", "wm_yr_wk"])["sell_price"]

    # Per-leaf revenue summed across the 28 days
    revenues = np.zeros(n_leaves, dtype=np.float64)
    last28_arr = train_matrix[:, -28:]  # units sold per series per day
    for di in range(28):
        wk = last28_weeks[di]
        for li in range(n_leaves):
            row = sales_df.iloc[li]
            try:
                price = price_idx.loc[(row["store_id"], row["item_id"], wk)]
            except KeyError:
                price = 0.0
            revenues[li] += float(last28_arr[li, di] * price)

    print(f"    total revenue (last 28 train days): ${revenues.sum():,.0f}")

    # ── For each level, compute WRMSSE contribution ─────────────────────
    per_level: dict[str, float] = {}
    level_contributions: list[float] = []

    for level_name, keys in M5_LEVELS:
        S, group_ids = compute_level_summing_matrix(sales_df, keys)
        n_groups = S.shape[0]

        # Aggregate train, truth, forecast to this level
        train_lvl = S @ train_matrix
        truth_lvl = S @ truth_matrix
        fc_lvl = S @ forecast_matrix
        # Aggregate revenue too — for w_i within this level
        revenue_lvl = S @ revenues

        # MSSE scale: average squared diff of consecutive train values
        # for each series at this level
        diffs = np.diff(train_lvl, axis=1)
        scale = np.mean(diffs ** 2, axis=1)  # (n_groups,)
        scale = np.where(scale == 0, 1.0, scale)  # guard divide-by-zero

        # MSE of forecast at this level
        mse = np.mean((truth_lvl - fc_lvl) ** 2, axis=1)
        rmsse = np.sqrt(mse / scale)

        # Within-level weights: revenue contribution share
        w_in_level = revenue_lvl / max(revenue_lvl.sum(), 1e-9)

        # Weighted RMSSE contribution at this level
        contribution = float(np.sum(w_in_level * rmsse))
        per_level[level_name] = contribution
        level_contributions.append(contribution)
        print(f"    {level_name:<22} n={n_groups:>6,}  WRMSSE_ℓ = {contribution:.4f}", flush=True)

    overall = float(np.mean(level_contributions))
    return overall, per_level
