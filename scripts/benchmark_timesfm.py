"""Head-to-head: TimesFM-2 zero-shot vs V1.5 forecasters on the same
28-day × 20-SKU French Bakery holdout used by benchmark_vs_baselines.py.

This is the empirical answer to "should we wire TimesFM in production?"
If TimesFM-2 zero-shot beats our V1.5 PER-QUANTILE blend on this
dataset, the Sprint 2 stub becomes a Sprint 2 ship. If it doesn't,
we know the V1.5 ensemble is good enough for now and TimesFM is a
covariate-aware-residual play, not a drop-in replacement.

Run:
    cd /Users/sohweimeng/Documents/projects/gemma-4-hack
    python scripts/benchmark_timesfm.py
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
HISTORY_DAYS = 512  # TimesFM-2 context window — leaves room for the model

# Default TimesFM quantile heads (the Pytorch checkpoint).
TFM_QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def load_timesfm(model_size: str = "500m"):
    """Load the requested TimesFM-2 checkpoint, preferring MPS on Apple
    Silicon and falling back to CPU."""
    import timesfm  # type: ignore

    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"  # timesfm passes "gpu" through to mps on macOS
    except Exception:
        pass

    repo = (
        "google/timesfm-2.0-500m-pytorch" if model_size == "500m"
        else "google/timesfm-1.0-200m-pytorch"
    )

    print(f"  loading {repo} on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend,
            per_core_batch_size=8,
            horizon_len=HOLDOUT_DAYS,
            context_len=HISTORY_DAYS,
            num_layers=50 if model_size == "500m" else 20,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=repo),
    )
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)
    return tfm


def predict_timesfm(tfm, train: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Per-SKU zero-shot forecast. Returns (q0.5, q0.9) aligned to test rows.

    Each SKU gets one independent forecast call: HISTORY_DAYS of training
    history → HOLDOUT_DAYS of forecast. We then index back into test
    rows by (sku, date)."""
    skus = sorted(test[GROUP].unique())
    test_dates_per_sku: dict[str, list[pd.Timestamp]] = {
        sku: sorted(test.loc[test[GROUP] == sku, DATE].unique())  # type: ignore[arg-type]
        for sku in skus
    }

    forecast_inputs: list[np.ndarray] = []
    forecast_skus: list[str] = []
    for sku in skus:
        h = (
            train.loc[train[GROUP] == sku, [DATE, TARGET]]
            .sort_values(DATE)[TARGET]
            .to_numpy(dtype=np.float32)
        )
        # Take the most recent HISTORY_DAYS — TimesFM truncates anyway.
        if len(h) > HISTORY_DAYS:
            h = h[-HISTORY_DAYS:]
        forecast_inputs.append(h)
        forecast_skus.append(str(sku))

    print(f"  forecasting {len(forecast_inputs)} SKUs × {HOLDOUT_DAYS} days…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        # frequency: 0 = high-freq (daily), 1 = medium (weekly), 2 = low (monthly)
        point_fc, quantile_fc = tfm.forecast(forecast_inputs, freq=[0] * len(forecast_inputs))
    elapsed = time.time() - t0
    print(f"  inferred in {elapsed:.1f}s ({elapsed / len(forecast_inputs):.2f}s/SKU)", flush=True)

    # quantile_fc: shape (n_skus, horizon, n_quantiles+1)  — first column is point forecast
    # We want q0.5 (idx 5 in the quantiles slice) and q0.9 (idx 9).
    # The TimesFM-2 Pytorch returns shape (n_skus, horizon, 10): [mean, q0.1..q0.9].
    q50_idx = 1 + TFM_QUANTILES.index(0.5)
    q90_idx = 1 + TFM_QUANTILES.index(0.9)

    out_q50 = np.empty(len(test), dtype=np.float64)
    out_q90 = np.empty(len(test), dtype=np.float64)
    sku_to_fc: dict[str, np.ndarray] = {
        sku: np.asarray(quantile_fc[i]) for i, sku in enumerate(forecast_skus)
    }

    test_idx = 0
    for sku, group in test.groupby(GROUP, sort=False):
        sku_dates = test_dates_per_sku[str(sku)]
        date_to_offset = {d: i for i, d in enumerate(sku_dates)}
        fc = sku_to_fc.get(str(sku))
        if fc is None:
            for _ in range(len(group)):
                out_q50[test_idx] = 0.0
                out_q90[test_idx] = 0.0
                test_idx += 1
            continue
        for date_v in group[DATE]:
            offset = date_to_offset.get(pd.Timestamp(date_v))
            if offset is None or offset >= fc.shape[0]:
                out_q50[test_idx] = 0.0
                out_q90[test_idx] = 0.0
            else:
                out_q50[test_idx] = float(max(0.0, fc[offset, q50_idx]))
                out_q90[test_idx] = float(max(0.0, fc[offset, q90_idx]))
            test_idx += 1
    return out_q50, out_q90


def main() -> int:
    print("=" * 78)
    print("TimesFM-2 zero-shot — head-to-head on French Bakery 28-day holdout")
    print("=" * 78)

    df = load_bakery()
    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)

    feats = drop_warmup(build_features(df))
    cutoff = feats[DATE].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    train = feats[feats[DATE] < cutoff].copy()
    test = feats[feats[DATE] >= cutoff].copy()

    print(f"\nTrain {len(train):,} rows · Test {len(test):,}")
    print(f"Test horizon: {test[DATE].nunique()} days × {test[GROUP].nunique()} SKUs")
    print(f"Test span: {test[DATE].min().date()} → {test[DATE].max().date()}\n")

    naive_full = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive_full)
    test = test.loc[valid_mask]
    naive = naive_full[valid_mask]
    y = test[TARGET].to_numpy()

    # ── TimesFM-2 ─────────────────────────────────────────────────────────
    model_size = "500m"  # change to "200m" for the 1.0 variant if 500m too heavy
    tfm = load_timesfm(model_size)
    tfm_q50, tfm_q90 = predict_timesfm(tfm, train, test)

    # ── Report ───────────────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("OVERALL — point forecast (q0.5) — lower WAPE/MASE is better")
    print("─" * 78)
    print(f"  {'forecaster':<32} {'WAPE':>8} {'MASE':>8} {'pinball-q0.5':>14}")
    print("  " + "-" * 64)

    rows = [
        ("SeasonalNaive (lag-7)",                naive),
        (f"TimesFM-2.0-{model_size} zero-shot",  tfm_q50),
    ]
    for name, p in rows:
        m = ~np.isnan(p)
        w = wape(y[m], p[m])
        ms = mase(y[m], p[m], naive[m])
        pl = pinball_loss(y[m], p[m], 0.5)
        print(f"  {name:<32} {w:>8.4f} {ms:>8.4f} {pl:>14.4f}")

    print("\n" + "─" * 78)
    print("QUANTILE BAND — pinball loss at q=0.9 (newsvendor tail)")
    print("─" * 78)
    print(f"  {'forecaster':<32} {'pinball-q0.9':>14}")
    print(f"  {'TimesFM-2.0-' + model_size + ' zero-shot':<32} {pinball_loss(y, tfm_q90, 0.9):>14.4f}")

    # Persist predictions so benchmark_vs_baselines.py can evaluate the
    # Tier 6 hybrid (TimesFM tails + prior median) without re-running the
    # 7-minute load.
    out_csv = REPO_ROOT / "data" / "raw" / "timesfm_predictions.csv"
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({
        "sku": test[GROUP].astype(str).to_numpy(),
        "date": pd.to_datetime(test[DATE]).dt.date,
        "tfm_q50": tfm_q50,
        "tfm_q90": tfm_q90,
    }).to_csv(out_csv, index=False)
    print(f"\n  saved predictions → {out_csv}")

    # Headline summary that lines up with benchmark_vs_baselines.py.
    overall_naive = wape(y, naive)
    overall_tfm = wape(y, tfm_q50)
    print("\n" + "═" * 78)
    print("SUMMARY")
    print("═" * 78)
    print(f"  baseline (seasonal-naive lag-7):    WAPE {overall_naive:.4f}  MASE 1.000")
    print(f"  TimesFM-2.0-{model_size} zero-shot:        WAPE {overall_tfm:.4f}  MASE {mase(y, tfm_q50, naive):.3f}")
    print()
    print("  Compare against benchmark_vs_baselines.py:")
    print("    AutoETS:                          WAPE 0.2710  MASE 0.796")
    print("    V1 LightGBM (with weather):       WAPE 0.2449  MASE 0.719")
    print("    V1.5 PER-QUANTILE (production):   WAPE 0.2121  MASE 0.623")
    return 0


if __name__ == "__main__":
    sys.exit(main())
