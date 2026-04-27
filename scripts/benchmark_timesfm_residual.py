"""Tier 11: TimesFM-2 backbone + GBM residual model — NEGATIVE RESULT.

This was the V2 architecture pattern documented in
docs/architecture/v2-migration.md (Sprint 2 stub):

  Forecast = TimesFM-2(history) + GBM(features → residual)

The hypothesis: TimesFM captures the time-series shape (seasonality,
trend); a GBM on residuals corrects for covariate effects (weather,
holidays, lag) that TimesFM doesn't see.

Empirical result on French Bakery: WAPE 1.39 — far worse than even
TimesFM zero-shot (0.314). Cause: the residual training set is only
560 rows (20 SKUs × 28 train days), which is too few for a 21-feature
gradient-boosted regressor — it overfits to a period-specific positive
bias and adds that bias indiscriminately to test forecasts.

The fix would be rolling-origin residual training: build 50+ windows
each producing 28 days of (TimesFM_forecast, actual, features), pool
into a 30K-row training set. That's hours more compute (50× TimesFM
forecasts × 20 SKUs).

For French Bakery specifically, Tier 11 is also redundant with V1
LightGBM (which already uses lag features that capture the same
seasonal signal as TimesFM, but more efficiently). The V2 pattern
makes more sense on M5 / Favorita where TimesFM's general shape
captures dynamics that aren't in lag features.

Reference numbers:
  V1 LightGBM (lag features):  WAPE 0.245
  V1.5 prior (family × dow):   WAPE 0.212
  TimesFM-2 zero-shot:          WAPE 0.314
  TimesFM-2 + xreg (Tier 9):    WAPE 0.302
  TimesFM-2 + GBM residual:     WAPE 1.39  (this script — needs rolling-origin)

Kept for reproducibility + as a documented failure mode.
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

from bakerysense.data import ensure_dense, filter_skus, load_bakery  # noqa: E402
from bakerysense.eval import mase, pinball_loss, seasonal_naive, wape  # noqa: E402
from bakerysense.features import (  # noqa: E402
    DATE,
    GROUP,
    TARGET,
    build_features,
    drop_warmup,
    feature_columns,
)

HOLDOUT_DAYS = 28
TRAIN_HISTORY_DAYS = 28  # rolling window context for TimesFM training-period forecasts


def get_timesfm_predictions(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
) -> tuple[dict[tuple[str, pd.Timestamp], float], dict[tuple[str, pd.Timestamp], float]]:
    """For each (sku, date) in train+test, get TimesFM's forecast for
    that day given the history up to (date-1).

    For test: standard 28-day forecast with full training history.
    For train: ROLLING — for each training date, forecast 1 day ahead
              given the last 512 training days. (Slow — ~28 forecasts
              per SKU.)

    Returns: {(sku, date): tfm_prediction} for both train and test.
    """
    import timesfm

    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"  loading TimesFM-2.0-500m on backend={backend} …", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=64,
            horizon_len=128,
            context_len=512,
            num_layers=50,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"    loaded in {time.time() - t0:.1f}s")

    # ── TEST forecasts: 28-day-ahead from training-end ──────────────────
    print("  forecasting test horizon (28 days ahead) per SKU…", flush=True)
    skus = sorted(set(train_df[GROUP].unique()) | set(test_df[GROUP].unique()))
    test_histories = []
    for sku in skus:
        h = train_df.loc[train_df[GROUP] == sku, TARGET].astype(np.float32).to_numpy()
        if len(h) > 512:
            h = h[-512:]
        test_histories.append(h)

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        point_fc, _ = tfm.forecast(test_histories, freq=[0] * len(test_histories))
    print(f"    inferred test in {time.time() - t0:.1f}s")

    test_preds: dict[tuple[str, pd.Timestamp], float] = {}
    for i, sku in enumerate(skus):
        sku_test_dates = sorted(test_df.loc[test_df[GROUP] == sku, DATE].unique())
        fc = np.maximum(0.0, np.asarray(point_fc[i])[:len(sku_test_dates)])
        for j, d in enumerate(sku_test_dates):
            test_preds[(str(sku), pd.Timestamp(d))] = float(fc[j])

    # ── TRAIN forecasts: cheap 28-day forecast at training cutoff ──────
    # Rather than full rolling-origin (which is 28×|SKU| separate
    # TimesFM calls), we exploit the test-period forecasts and use a
    # one-shot in-sample forecast over the last 28 train days. The
    # residual model only sees the LAST 28 train days, which is fine
    # because that's the most relevant to test-time generalisation.
    print("  forecasting in-sample train residuals (last 28 train days per SKU)…", flush=True)
    train_residual_window = 28
    train_histories_for_residual = []
    train_targets_for_residual: dict[str, list[tuple[pd.Timestamp, float]]] = {}

    for sku in skus:
        sku_train = train_df.loc[train_df[GROUP] == sku].sort_values(DATE)
        if len(sku_train) < train_residual_window + 28:
            continue
        # Use earliest portion as context, last 28 as target window
        context = sku_train.iloc[:-train_residual_window][TARGET].astype(np.float32).to_numpy()
        if len(context) > 512:
            context = context[-512:]
        train_histories_for_residual.append(context)
        target_block = sku_train.iloc[-train_residual_window:]
        train_targets_for_residual[str(sku)] = [
            (pd.Timestamp(r[DATE]), float(r[TARGET])) for _, r in target_block.iterrows()
        ]

    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        train_point_fc, _ = tfm.forecast(train_histories_for_residual, freq=[0] * len(train_histories_for_residual))
    print(f"    inferred train residuals in {time.time() - t0:.1f}s")

    train_preds: dict[tuple[str, pd.Timestamp], float] = {}
    for i, sku in enumerate(list(train_targets_for_residual.keys())):
        target_block = train_targets_for_residual[sku]
        fc = np.maximum(0.0, np.asarray(train_point_fc[i])[:len(target_block)])
        for j, (d, _) in enumerate(target_block):
            train_preds[(sku, d)] = float(fc[j])

    # Free TimesFM memory before downstream training (2GB+ retained)
    del tfm
    import gc; gc.collect()
    if backend == "gpu":
        try:
            import torch
            torch.mps.empty_cache()
        except Exception:
            pass

    return train_preds, test_preds


def main() -> int:
    print("=" * 78)
    print("Tier 11: TimesFM-2 backbone + LightGBM residual on French Bakery")
    print("=" * 78)

    df = load_bakery()
    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)

    feats = drop_warmup(build_features(df))
    cutoff_test = feats[DATE].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    cutoff_valid = cutoff_test - pd.Timedelta(days=HOLDOUT_DAYS)
    train = feats[feats[DATE] < cutoff_valid].copy()
    valid = feats[(feats[DATE] >= cutoff_valid) & (feats[DATE] < cutoff_test)].copy()
    test = feats[feats[DATE] >= cutoff_test].copy()

    print(f"\nTrain {len(train):,} · Valid {len(valid):,} · Test {len(test):,}")

    # Seasonal-naive baseline for MASE
    naive_full = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive_full)
    test = test.loc[valid_mask]
    naive = naive_full[valid_mask]
    y_test = test[TARGET].to_numpy()

    # ── TimesFM forecasts on train residual window + test ───────────────
    print("\n[1/3] TimesFM-2 forecasts (train residual window + test)…", flush=True)
    # Use train+valid as context for test forecast, train alone for residual
    train_for_residual = train.copy()  # earlier portion only
    test_context = pd.concat([train, valid], ignore_index=True)
    train_preds, test_preds = get_timesfm_predictions(test_context, test)
    # Map test preds onto test rows
    tfm_test = np.array([
        test_preds.get((str(s), pd.Timestamp(d)), 0.0)
        for s, d in zip(test[GROUP].astype(str), test[DATE])
    ])

    # ── Build residual training set ─────────────────────────────────────
    print("\n[2/3] training LightGBM on TimesFM residuals…", flush=True)
    # train DataFrame only — get residuals for last 28 train days per SKU
    train_recent = train.copy()
    last_dates_by_sku = train_recent.groupby(GROUP)[DATE].apply(lambda s: sorted(s.unique())[-28:])
    rows_for_residual: list[int] = []
    for sku, dates in last_dates_by_sku.items():
        mask = (train_recent[GROUP] == sku) & (train_recent[DATE].isin(dates))
        rows_for_residual.extend(train_recent[mask].index.tolist())
    train_residual = train_recent.loc[rows_for_residual].copy()

    # Compute residuals: actual - TimesFM forecast
    tfm_train = np.array([
        train_preds.get((str(s), pd.Timestamp(d)), 0.0)
        for s, d in zip(train_residual[GROUP].astype(str), train_residual[DATE])
    ])
    residuals = train_residual[TARGET].to_numpy() - tfm_train
    print(f"  residual stats: mean={residuals.mean():.2f}  std={residuals.std():.2f}  median={np.median(residuals):.2f}")

    # Train residual model. Tried LightGBM first → SIGSEGV with TimesFM
    # still in memory; switched to sklearn HistGradientBoosting which is
    # more conservative with native memory management and handles NaN
    # without the categorical-codes preprocessing dance.
    from sklearn.ensemble import HistGradientBoostingRegressor
    fcols = feature_columns(train_residual)
    X_train = train_residual[fcols].copy()
    for col in X_train.select_dtypes(include=["category"]).columns:
        X_train[col] = X_train[col].cat.codes
    X_train = X_train.astype(np.float32)
    y_train = residuals.astype(np.float32)

    booster = HistGradientBoostingRegressor(
        max_iter=200,
        learning_rate=0.05,
        max_leaf_nodes=31,
        min_samples_leaf=20,
        random_state=42,
    ).fit(X_train, y_train)
    print(f"  trained HistGradientBoosting residual model on {len(X_train)} rows × {len(fcols)} features")

    # ── Predict residuals on test, sum with TimesFM ─────────────────────
    print("\n[3/3] predicting test residuals + summing with TimesFM…", flush=True)
    X_test = test[fcols].copy()
    for col in X_test.select_dtypes(include=["category"]).columns:
        X_test[col] = X_test[col].cat.codes
    residual_test_pred = booster.predict(X_test)
    final_test = np.maximum(0.0, tfm_test + residual_test_pred)

    # ── Report ──────────────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("HEAD-TO-HEAD on French Bakery 28-day holdout — point (q0.5)")
    print("─" * 78)
    print(f"  {'forecaster':<48} {'WAPE':>8} {'MASE':>8} {'pinball-q0.5':>14}")
    print("  " + "-" * 78)

    rows = [
        ("Seasonal-naive (lag-7)",                                     naive),
        ("V1.5 PER-QUANTILE T4 (production)",                          None),  # ref
        ("TimesFM-2 zero-shot (no covariates)",                        tfm_test),
        ("TimesFM-2 + GBM residual (Tier 11, ours)",                   final_test),
    ]
    for name, p in rows:
        if p is None:
            # known reference number
            print(f"  {name:<48} {0.2121:>8.4f} {0.6231:>8.4f} {2.04:>14.4f}")
            continue
        w = wape(y_test, p)
        ms = mase(y_test, p, naive)
        pl = pinball_loss(y_test, p, 0.5)
        print(f"  {name:<48} {w:>8.4f} {ms:>8.4f} {pl:>14.4f}")

    print()
    print("V2 architecture validation: if Tier 11 beats V1.5 PER-QUANTILE T4 (0.2121),")
    print("the documented V2 design (TimesFM backbone + GBM residual) is empirically")
    print("better than V1.5. If it doesn't, V1.5 prior remains the right production target.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
