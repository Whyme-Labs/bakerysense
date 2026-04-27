"""TimesFM-2 + covariates head-to-head on French Bakery.

The plain zero-shot TimesFM-2 result on French Bakery was sMAPE-equivalent
WAPE 0.314 — worse than the V1.5 prior at 0.212 because it had no access
to weather, holidays, or family identity. The official `forecast_with_covariates`
API lets us pass dynamic numerical (weather), dynamic categorical (dow,
is_holiday), and static categorical (sku) covariates without any fine-tuning.

Two xreg modes:
  • "xreg + timesfm" — TimesFM forecasts the time series, linear model
    fits residuals against covariates (default; safer)
  • "timesfm + xreg" — linear model fits on targets, TimesFM forecasts
    the residuals (more aggressive)

Run:
    python scripts/benchmark_timesfm_covariates.py
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
)

HOLDOUT_DAYS = 28


def main() -> int:
    print("=" * 78)
    print("TimesFM-2 with covariates — French Bakery 28-day holdout")
    print("=" * 78)

    df = load_bakery()
    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)

    feats = drop_warmup(build_features(df))
    cutoff_test = feats[DATE].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    train = feats[feats[DATE] < cutoff_test].copy()
    test = feats[feats[DATE] >= cutoff_test].copy()

    print(f"\nTrain {len(train):,} rows · Test {len(test):,}")

    naive_full = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive_full)
    test = test.loc[valid_mask]
    naive = naive_full[valid_mask]
    y = test[TARGET].to_numpy()

    # Build inputs in the shape forecast_with_covariates expects.
    # `inputs` is a list of context arrays (one per series).
    # Covariates are dicts of {covariate_name: list_of_lists}, where each
    # outer list is per-series. Dynamic covariates span context + horizon.
    print("\n  building per-SKU contexts + covariates…", flush=True)
    skus = sorted(test[GROUP].unique())
    contexts: list[np.ndarray] = []
    dyn_num: dict[str, list[list[float]]] = {
        "temp_c": [], "precip_mm": [], "humidity": [], "wind_kmh": [],
    }
    dyn_cat: dict[str, list[list[int]]] = {
        "dow": [], "is_holiday": [], "is_weekend": [], "is_storm": [],
    }
    static_cat: dict[str, list[str]] = {"sku": []}

    for sku in skus:
        train_s = train[train[GROUP] == sku].sort_values(DATE)
        test_s = test[test[GROUP] == sku].sort_values(DATE)
        full_s = pd.concat([train_s, test_s], ignore_index=True)
        contexts.append(train_s[TARGET].to_numpy(dtype=np.float32))
        for col in dyn_num:
            if col in full_s.columns:
                dyn_num[col].append(full_s[col].astype(float).tolist())
            else:
                dyn_num[col].append([0.0] * len(full_s))
        for col in dyn_cat:
            if col in full_s.columns:
                dyn_cat[col].append(full_s[col].astype(int).tolist())
            else:
                dyn_cat[col].append([0] * len(full_s))
        static_cat["sku"].append(str(sku))

    # Load TimesFM
    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"  loading TimesFM-2.0-500m on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=8,
            horizon_len=128,
            context_len=512,
            num_layers=50,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    print(f"  forecasting {len(contexts)} SKUs × {HOLDOUT_DAYS} days with covariates…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        outputs, xreg = tfm.forecast_with_covariates(
            inputs=contexts,
            dynamic_numerical_covariates=dyn_num,
            dynamic_categorical_covariates=dyn_cat,
            static_categorical_covariates=static_cat,
            freq=[0] * len(contexts),
            xreg_mode="xreg + timesfm",
            normalize_xreg_target_per_input=True,
            ridge=0.0,
            force_on_cpu=False,
        )
    print(f"  inferred in {time.time() - t0:.1f}s", flush=True)

    # outputs is list of np arrays of shape (horizon,) — point forecasts
    # combined with covariate residual model.
    print(f"\n  output shape per series: {np.asarray(outputs[0]).shape}")

    # Map TimesFM-with-covariates predictions back to test rows
    sku_to_pred: dict[str, np.ndarray] = {}
    for i, sku in enumerate(skus):
        arr = np.asarray(outputs[i])[:HOLDOUT_DAYS]
        sku_to_pred[str(sku)] = np.maximum(0.0, arr)

    test_skus_arr = test[GROUP].astype(str).to_numpy()
    test_dates_arr = pd.to_datetime(test[DATE]).dt.date.to_numpy()

    tfm_xreg_q50 = np.empty(len(test))
    for i, (sku, _date) in enumerate(zip(test_skus_arr, test_dates_arr)):
        pred = sku_to_pred.get(sku)
        if pred is None:
            tfm_xreg_q50[i] = 0.0
            continue
        # The output is a horizon-length array per series; index by position
        # in test (test rows are sorted by sku, then date).
        sku_test_dates = pd.to_datetime(test.loc[test[GROUP] == sku, DATE]).dt.date.tolist()
        try:
            pos = sku_test_dates.index(test_dates_arr[i])
            tfm_xreg_q50[i] = float(pred[pos]) if pos < len(pred) else 0.0
        except ValueError:
            tfm_xreg_q50[i] = 0.0

    # ── Report ──────────────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("HEAD-TO-HEAD on French Bakery 28-day holdout — point (q0.5)")
    print("─" * 78)
    print(f"  {'forecaster':<40} {'WAPE':>8} {'MASE':>8} {'pinball-q0.5':>14}")
    print("  " + "-" * 70)

    for name, p in [
        ("Seasonal-naive (lag-7)",                   naive),
        ("V1.5 PER-QUANTILE T4 (production WAPE)",   None),  # placeholder
        ("TimesFM-2 zero-shot (no covariates)",      None),  # placeholder
        ("TimesFM-2 + COVARIATES (Tier 9, ours)",    tfm_xreg_q50),
    ]:
        if p is None:
            # known reference numbers for comparison
            if "T4" in name:
                print(f"  {name:<40} {0.2121:>8.4f} {0.6231:>8.4f} {2.04:>14.4f}")
            elif "zero-shot" in name:
                print(f"  {name:<40} {0.3137:>8.4f} {0.9214:>8.4f} {3.01:>14.4f}")
            continue
        w = wape(y, p)
        ms = mase(y, p, naive)
        pl = pinball_loss(y, p, 0.5)
        print(f"  {name:<40} {w:>8.4f} {ms:>8.4f} {pl:>14.4f}")

    print("\nThis is a TimesFM-2 with weather / dow / holiday / sku covariates.")
    print("If the result beats Tier 4 WAPE 0.212, we have a stronger production candidate.")
    print("If it doesn't, the forecast_with_covariates API isn't competitive with V1.5")
    print("for this dataset — fine-tuning would be the next step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
