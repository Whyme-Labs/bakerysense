"""V1.5 benchmark — measure WAPE / MASE / pinball loss for three forecasters
on the French Bakery hold-out set:

  1. **Seasonal-naive (lag-7)** — the conventional baseline a baker beats.
  2. **V1 LightGBM** — the existing per-tenant trained model.
  3. **Cold-start population prior** — the new V1.5 router fallback used
     for tenants with <30 days of actuals. Computed inline from the
     training portion using the SAME (family × dow) anchoring that
     `src/lib/corpus-prior.ts` ships in production.

Why benchmark the population prior on the SAME holdout the GBM saw:
the prior is what a brand-new tenant would receive on day 1. Comparing
its accuracy to the GBM's tells us how big a gap a freshly-onboarded
tenant lives with until they accumulate enough actuals to warm up the
model. A small gap means cold-start is honest; a huge gap means we
need to invest in the FM backbone faster.

Run:
    cd /Users/sohweimeng/Documents/projects/gemma-4-hack
    python3 scripts/benchmark_v1_5.py
"""
from __future__ import annotations

import sys
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

HOLDOUT_DAYS = 28
VALID_DAYS = 28


def fit_population_prior(train: pd.DataFrame) -> dict[tuple[str, int], dict[str, float]]:
    """Compute per-(family, dow) quantiles from the training portion. This is
    the same lookup the production V1.5 router uses for cold-start tenants;
    here we materialise it from data instead of from the embedded constants
    so the benchmark is reproducible against any new dataset."""
    train = train.copy()
    train["dow"] = pd.to_datetime(train[DATE]).dt.dayofweek  # 0=Mon..6=Sun
    out: dict[tuple[str, int], dict[str, float]] = {}
    for (sku, dow), group in train.groupby([GROUP, "dow"]):
        ys = group[TARGET].to_numpy(dtype=float)
        if ys.size == 0:
            continue
        out[(sku, int(dow))] = {
            "q0.1": float(np.quantile(ys, 0.10)),
            "q0.3": float(np.quantile(ys, 0.30)),
            "q0.5": float(np.quantile(ys, 0.50)),
            "q0.7": float(np.quantile(ys, 0.70)),
            "q0.9": float(np.quantile(ys, 0.90)),
        }
    # Default fallback — average across all (sku, dow) pairs by dow only.
    for dow in range(7):
        ys = train.loc[train["dow"] == dow, TARGET].to_numpy(dtype=float)
        if ys.size == 0:
            continue
        out[("__default__", dow)] = {
            "q0.1": float(np.quantile(ys, 0.10)),
            "q0.3": float(np.quantile(ys, 0.30)),
            "q0.5": float(np.quantile(ys, 0.50)),
            "q0.7": float(np.quantile(ys, 0.70)),
            "q0.9": float(np.quantile(ys, 0.90)),
        }
    return out


def predict_prior(
    test: pd.DataFrame,
    prior: dict[tuple[str, int], dict[str, float]],
) -> pd.DataFrame:
    """Predict each test row from the (sku, dow) prior. Falls back to the
    default key if the SKU is unseen in training."""
    dow = pd.to_datetime(test[DATE]).dt.dayofweek
    rows = []
    for sku, dow_v in zip(test[GROUP].to_numpy(), dow.to_numpy()):
        key = (sku, int(dow_v))
        q = prior.get(key) or prior.get(("__default__", int(dow_v))) or {}
        rows.append({k: q.get(k, 0.0) for k in ["q0.1", "q0.3", "q0.5", "q0.7", "q0.9"]})
    return pd.DataFrame(rows, index=test.index)


def overall_metrics(y: np.ndarray, p: np.ndarray, naive: np.ndarray, q: float) -> dict[str, float]:
    return {
        "wape": wape(y, p),
        "pinball": pinball_loss(y, p, q),
        "mase": mase(y, p, naive),
    }


def per_sku_wape(test: pd.DataFrame, p: pd.Series) -> dict[str, float]:
    out: dict[str, float] = {}
    for sku in pd.unique(test[GROUP]):
        m = test[GROUP].to_numpy() == sku
        out[str(sku)] = wape(test[TARGET].to_numpy()[m], p.to_numpy()[m])
    return out


def main() -> int:
    print("=" * 78)
    print("BakerySense V1.5 benchmark — naive vs V1 GBM vs cold-start prior")
    print("=" * 78)

    df = load_bakery()
    print(f"\nLoaded {len(df):,} rows · {df['sku'].nunique()} SKUs · "
          f"{df['date'].min().date()} → {df['date'].max().date()}")

    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)

    feats = drop_warmup(build_features(df))
    cutoff_test = feats[DATE].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    cutoff_valid = cutoff_test - pd.Timedelta(days=VALID_DAYS)

    train = feats[feats[DATE] < cutoff_valid].copy()
    valid = feats[(feats[DATE] >= cutoff_valid) & (feats[DATE] < cutoff_test)].copy()
    test = feats[feats[DATE] >= cutoff_test].copy()
    fcols = feature_columns(feats)
    print(f"\nTrain {len(train):,} · Valid {len(valid):,} · Test {len(test):,}\n")

    # ── Forecaster 1: seasonal-naive lag-7 (baseline) ────────────────────
    naive = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive)
    test = test.loc[valid_mask]
    naive = naive[valid_mask]

    # ── Forecaster 2: V1 LightGBM ────────────────────────────────────────
    print("Training LightGBM quantile grid…")
    gbm = QuantileGBM()
    gbm.fit(train, valid=valid, feature_names=fcols)
    gbm_preds = gbm.predict_all(test)
    gbm_preds.index = test.index

    # ── Forecaster 3: cold-start population prior ────────────────────────
    print("Fitting population prior from training portion…")
    prior = fit_population_prior(train)
    prior_preds = predict_prior(test, prior)

    y = test[TARGET].to_numpy()

    # ── Overall comparison ───────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("OVERALL — point forecast (q=0.5) — lower WAPE/MASE is better")
    print("─" * 78)
    print(f"  {'forecaster':<32} {'WAPE':>8} {'MASE':>8} {'pinball':>10}")
    rows = [
        ("seasonal-naive (lag-7)", overall_metrics(y, naive, naive, 0.5)),
        ("V1 LightGBM (warm tenant)", overall_metrics(y, gbm_preds["q0.5"].to_numpy(), naive, 0.5)),
        ("V1.5 population prior (cold-start)", overall_metrics(y, prior_preds["q0.5"].to_numpy(), naive, 0.5)),
    ]
    for name, m in rows:
        print(f"  {name:<32} {m['wape']:>8.4f} {m['mase']:>8.4f} {m['pinball']:>10.4f}")

    # ── Quantile band quality (pinball loss across the envelope) ─────────
    print("\n" + "─" * 78)
    print("QUANTILE BAND — pinball loss (lower is better)")
    print("─" * 78)
    qs = [0.1, 0.3, 0.5, 0.7, 0.9]
    print(f"  {'quantile':<10} {'GBM':>8} {'Prior':>8}")
    for q in qs:
        col = f"q{q:g}"
        if col in gbm_preds.columns and col in prior_preds.columns:
            g = pinball_loss(y, gbm_preds[col].to_numpy(), q)
            p = pinball_loss(y, prior_preds[col].to_numpy(), q)
            print(f"  {col:<10} {g:>8.4f} {p:>8.4f}")

    # ── Per-SKU WAPE comparison ──────────────────────────────────────────
    print("\n" + "─" * 78)
    print("PER-SKU WAPE — naive vs GBM vs prior (sorted by GBM lift over naive)")
    print("─" * 78)
    sku_naive = {}
    for sku in pd.unique(test[GROUP]):
        m = test[GROUP].to_numpy() == sku
        sku_naive[str(sku)] = wape(y[m], naive[m])
    sku_gbm = per_sku_wape(test, gbm_preds["q0.5"])
    sku_prior = per_sku_wape(test, prior_preds["q0.5"])

    table = pd.DataFrame({
        "naive": sku_naive,
        "gbm": sku_gbm,
        "prior": sku_prior,
    }).sort_values("gbm")
    table["gbm_lift"] = table["naive"] - table["gbm"]
    table["prior_vs_gbm"] = table["prior"] - table["gbm"]

    print(f"  {'SKU':<26} {'naive':>8} {'GBM':>8} {'prior':>8} {'GBM-lift':>10} {'prior-gap':>10}")
    for sku, r in table.iterrows():
        print(f"  {sku:<26} {r['naive']:>8.4f} {r['gbm']:>8.4f} {r['prior']:>8.4f} "
              f"{r['gbm_lift']:>+10.4f} {r['prior_vs_gbm']:>+10.4f}")

    # ── Headline ─────────────────────────────────────────────────────────
    overall_naive = overall_metrics(y, naive, naive, 0.5)
    overall_gbm = overall_metrics(y, gbm_preds["q0.5"].to_numpy(), naive, 0.5)
    overall_prior = overall_metrics(y, prior_preds["q0.5"].to_numpy(), naive, 0.5)

    print("\n" + "═" * 78)
    print("HEADLINE")
    print("═" * 78)
    print(f"  V1 GBM beats seasonal-naive by    "
          f"{(overall_naive['wape'] - overall_gbm['wape']) * 100:+.2f} pp WAPE  "
          f"(MASE = {overall_gbm['mase']:.3f})")
    print(f"  V1.5 prior beats seasonal-naive by "
          f"{(overall_naive['wape'] - overall_prior['wape']) * 100:+.2f} pp WAPE  "
          f"(MASE = {overall_prior['mase']:.3f})")
    print(f"  Cold-start gap (GBM advantage):   "
          f"{(overall_prior['wape'] - overall_gbm['wape']) * 100:+.2f} pp WAPE")
    print()
    print("  Read: a brand-new tenant on day 1 sees the V1.5-prior accuracy.")
    print("  As they accumulate actuals (cold → warm → mature), they cross over")
    print("  to the GBM and close that gap.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
