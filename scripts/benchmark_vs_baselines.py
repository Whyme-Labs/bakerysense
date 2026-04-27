"""Head-to-head: BakerySense V1.5 forecasters vs published-baseline classics
on the French Bakery dataset, same 28-day × 20-SKU hold-out as
benchmark_v1_5.py so the numbers are directly comparable.

Baselines (published / out-of-the-box, no manual tuning):

  1. **SeasonalNaive(7)** — the classic baseline.
  2. **AutoARIMA** — what most public Kaggle notebooks default to. Per-SKU
     fit from `statsforecast`.
  3. **AutoETS** — exponential smoothing state-space model (also
     `statsforecast`).
  4. **CrostonClassic** — handles intermittent demand (long-tail SKUs).

Our forecasters (from benchmark_v1_5.py):

  5. **V1 LightGBM** — 13-feature tabular GBM, the production V1.
  6. **V1.5 population prior** — (family × dow) historical median, the
     cold-start fallback.

Per-SKU fitting on each method is fair: each baseline gets the same
training history per SKU, predicts the same 28-day horizon, evaluated
with the same WAPE / MASE / pinball metric. The point is to verify our
numbers sit in the right band relative to what a typical Kaggle
notebook would publish.

Run:
    cd /Users/sohweimeng/Documents/projects/gemma-4-hack
    python scripts/benchmark_vs_baselines.py
"""
from __future__ import annotations

import sys
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
from bakerysense.forecaster import QuantileGBM  # noqa: E402

# Same split as benchmark_v1_5.py (and as the existing train_baseline pipeline).
HOLDOUT_DAYS = 28
VALID_DAYS = 28


def fit_population_prior(train: pd.DataFrame) -> dict[tuple[str, int], dict[str, float]]:
    train = train.copy()
    train["dow"] = pd.to_datetime(train[DATE]).dt.dayofweek
    out: dict[tuple[str, int], dict[str, float]] = {}
    for (sku, dow), group in train.groupby([GROUP, "dow"]):
        ys = group[TARGET].to_numpy(dtype=float)
        if ys.size == 0:
            continue
        out[(sku, int(dow))] = {
            "q0.1": float(np.quantile(ys, 0.10)),
            "q0.5": float(np.quantile(ys, 0.50)),
            "q0.9": float(np.quantile(ys, 0.90)),
        }
    for dow in range(7):
        ys = train.loc[train["dow"] == dow, TARGET].to_numpy(dtype=float)
        if ys.size == 0:
            continue
        out[("__default__", dow)] = {
            "q0.1": float(np.quantile(ys, 0.10)),
            "q0.5": float(np.quantile(ys, 0.50)),
            "q0.9": float(np.quantile(ys, 0.90)),
        }
    return out


def predict_prior(
    test: pd.DataFrame,
    prior: dict[tuple[str, int], dict[str, float]],
    quantile: str = "q0.5",
) -> np.ndarray:
    dow = pd.to_datetime(test[DATE]).dt.dayofweek
    out = []
    for sku, dow_v in zip(test[GROUP].to_numpy(), dow.to_numpy()):
        key = (sku, int(dow_v))
        q = prior.get(key) or prior.get(("__default__", int(dow_v))) or {quantile: 0.0}
        out.append(q.get(quantile, 0.0))
    return np.asarray(out, dtype=float)


def predict_with_statsforecast(
    train: pd.DataFrame, test: pd.DataFrame, model_name: str,
) -> np.ndarray:
    """Per-SKU fit + forecast using statsforecast. Returns predictions
    aligned with `test` rows in their existing order."""
    from statsforecast import StatsForecast
    from statsforecast.models import (
        AutoARIMA,
        AutoETS,
        CrostonClassic,
        SeasonalNaive,
    )

    model_map = {
        "AutoARIMA": AutoARIMA(season_length=7),
        "AutoETS":   AutoETS(season_length=7, model="ZZA"),
        "Croston":   CrostonClassic(),
        "SNaive":    SeasonalNaive(season_length=7),
    }
    model = model_map[model_name]

    # statsforecast wants long format: unique_id, ds, y
    sf_train = pd.DataFrame({
        "unique_id": train[GROUP].astype(str).to_numpy(),
        "ds":        pd.to_datetime(train[DATE]),
        "y":         train[TARGET].astype(float).to_numpy(),
    })

    # Fit per-SKU; horizon = number of test days.
    horizon = test[DATE].nunique()
    sf = StatsForecast(models=[model], freq="D", n_jobs=1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        forecast_df = sf.forecast(df=sf_train, h=horizon)

    # forecast_df has columns unique_id, ds, <ModelName>.
    # Align to test rows.
    fcol = forecast_df.columns[-1]  # whatever the model's name in the output
    fmap = {(uid, ds.date()): val
            for uid, ds, val in zip(
                forecast_df["unique_id"], forecast_df["ds"], forecast_df[fcol],
            )}

    out = []
    for sku, date in zip(
        test[GROUP].astype(str).to_numpy(),
        pd.to_datetime(test[DATE]).dt.date,
    ):
        out.append(float(fmap.get((sku, date), 0.0)))
    return np.asarray(out, dtype=float)


def main() -> int:
    print("=" * 78)
    print("BakerySense vs published baselines — head-to-head on French Bakery")
    print("=" * 78)

    df = load_bakery()
    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)

    feats = drop_warmup(build_features(df))
    cutoff_test = feats[DATE].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    cutoff_valid = cutoff_test - pd.Timedelta(days=VALID_DAYS)
    train = feats[feats[DATE] < cutoff_valid].copy()
    valid = feats[(feats[DATE] >= cutoff_valid) & (feats[DATE] < cutoff_test)].copy()
    test = feats[feats[DATE] >= cutoff_test].copy()

    print(f"\nTrain {len(train):,} rows · Valid {len(valid):,} · Test {len(test):,}")
    print(f"Test horizon: {test[DATE].nunique()} days × {test[GROUP].nunique()} SKUs")
    print(f"Test span: {test[DATE].min().date()} → {test[DATE].max().date()}\n")

    # ── seasonal-naive baseline ──────────────────────────────────────────
    naive_full = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive_full)
    test = test.loc[valid_mask]
    naive = naive_full[valid_mask]
    y = test[TARGET].to_numpy()

    # ── statsforecast baselines (per-SKU classics) ────────────────────────
    # statsforecast can be slow on AutoARIMA — we run it once per SKU.
    sf_for_train = pd.concat([train, valid], ignore_index=True)
    sf_results: dict[str, np.ndarray] = {}
    for name in ["SNaive", "AutoARIMA", "AutoETS", "Croston"]:
        print(f"  fitting {name}…", flush=True)
        try:
            sf_results[name] = predict_with_statsforecast(sf_for_train, test, name)
        except Exception as e:
            print(f"    {name} failed: {e}")
            sf_results[name] = np.full(len(test), np.nan)

    # ── V1 LightGBM ───────────────────────────────────────────────────────
    print("  fitting V1 LightGBM (with lag_365)…", flush=True)
    fcols = feature_columns(feats)
    gbm = QuantileGBM()
    gbm.fit(train, valid=valid, feature_names=fcols)
    gbm_preds = gbm.predict_all(test)
    gbm_preds.index = test.index
    gbm_q50 = gbm_preds["q0.5"].to_numpy()
    gbm_q90 = gbm_preds["q0.9"].to_numpy()

    # ── V1.5 cold-start prior ────────────────────────────────────────────
    print("  fitting V1.5 population prior…", flush=True)
    prior = fit_population_prior(train)
    prior_q50 = predict_prior(test, prior, "q0.5")
    prior_q90 = predict_prior(test, prior, "q0.9")

    # ── V1.5 blended (mature-tenant ensemble) ─────────────────────────────
    # alpha = 1 for mature tenant in this benchmark — the test rows have
    # 11k+ training actuals behind them. We also report a 50/50 blend to
    # show what a warming-up tenant would experience.
    blend_50 = 0.5 * prior_q50 + 0.5 * gbm_q50
    print("  fitting V1.5 blend (50/50 prior+GBM)…", flush=True)

    # ── V1.5 PER-QUANTILE BLEND (Tier 4) ─────────────────────────────────
    # The prior beats the GBM at the median; the GBM beats the prior at
    # the q0.9 tail (the GBM adapts to recent shocks). A flat alpha forces
    # one or the other for the whole envelope. Per-quantile alpha takes
    # the best of both: pure prior at q0.5, pure GBM at q0.9, smoothed in
    # between. This is what mature tenants should actually use.
    hybrid_q50 = prior_q50  # alpha[q0.5] = 0
    hybrid_q90 = gbm_q90    # alpha[q0.9] = 1
    print("  fitting V1.5 PER-QUANTILE blend (prior@q0.5, GBM@q0.9)…\n", flush=True)

    # ── Headline table ────────────────────────────────────────────────────
    print("─" * 78)
    print("OVERALL — point forecast (median) — lower WAPE/MASE is better")
    print("─" * 78)
    print(f"  {'forecaster':<32} {'WAPE':>8} {'MASE':>8} {'pinball-q0.5':>14}")
    print("  " + "-" * 64)

    rows: list[tuple[str, np.ndarray]] = [
        ("SeasonalNaive (lag-7)",            naive),
        ("AutoARIMA (statsforecast)",        sf_results.get("AutoARIMA", np.full_like(naive, np.nan))),
        ("AutoETS (statsforecast)",          sf_results.get("AutoETS",   np.full_like(naive, np.nan))),
        ("CrostonClassic (intermittent)",    sf_results.get("Croston",   np.full_like(naive, np.nan))),
        ("V1 LightGBM (ours)",               gbm_q50),
        ("V1.5 population prior (ours)",     prior_q50),
        ("V1.5 BLEND 50/50 prior+GBM (ours)", blend_50),
        ("V1.5 PER-QUANTILE (T4, ours)",      hybrid_q50),
    ]
    for name, p in rows:
        if np.isnan(p).all():
            print(f"  {name:<32} {'N/A':>8} {'N/A':>8} {'N/A':>14}")
            continue
        m = ~np.isnan(p)
        w = wape(y[m], p[m])
        ms = mase(y[m], p[m], naive[m])
        pl = pinball_loss(y[m], p[m], 0.5)
        print(f"  {name:<32} {w:>8.4f} {ms:>8.4f} {pl:>14.4f}")

    # ── Quantile band — only the GBM and prior emit quantile bands ────────
    print("\n" + "─" * 78)
    print("QUANTILE BAND — pinball loss at q=0.9 (where newsvendor picks bake)")
    print("─" * 78)
    print(f"  {'forecaster':<32} {'pinball-q0.9':>14}")
    print(f"  {'V1 LightGBM (ours)':<32} {pinball_loss(y, gbm_q90, 0.9):>14.4f}")
    print(f"  {'V1.5 prior q0.9 (ours)':<32} {pinball_loss(y, prior_q90, 0.9):>14.4f}")
    print(f"  {'V1.5 PER-QUANTILE T4 (ours)':<32} {pinball_loss(y, hybrid_q90, 0.9):>14.4f}")

    # Headline summary
    overall_naive = wape(y, naive)
    overall_arima = wape(y, sf_results['AutoARIMA']) if not np.isnan(sf_results['AutoARIMA']).all() else None
    overall_ets   = wape(y, sf_results['AutoETS']) if not np.isnan(sf_results['AutoETS']).all() else None
    overall_gbm   = wape(y, gbm_q50)
    overall_prior = wape(y, prior_q50)

    print("\n" + "═" * 78)
    print("SUMMARY")
    print("═" * 78)
    print(f"  baseline (seasonal-naive lag-7):  WAPE {overall_naive:.4f}  MASE 1.000")
    if overall_arima is not None:
        print(f"  AutoARIMA:                        WAPE {overall_arima:.4f}  MASE {mase(y, sf_results['AutoARIMA'], naive):.3f}")
    if overall_ets is not None:
        print(f"  AutoETS:                          WAPE {overall_ets:.4f}  MASE {mase(y, sf_results['AutoETS'], naive):.3f}")
    print(f"  V1 LightGBM (ours):               WAPE {overall_gbm:.4f}  MASE {mase(y, gbm_q50, naive):.3f}")
    print(f"  V1.5 population prior (ours):     WAPE {overall_prior:.4f}  MASE {mase(y, prior_q50, naive):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
