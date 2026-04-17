"""Day-1 baseline verification.

Loads bakery data (real if present, synthetic otherwise), builds features,
trains a LightGBM quantile forecaster across seven quantiles, evaluates
against a seasonal-naive baseline, prints a per-SKU metric table, shows one
end-to-end example (forecast + newsvendor + explanation), and saves the
fitted model to ``models/gbm/`` so the Gemma demo can load it.

Success criterion: overall LightGBM q=0.5 WAPE beats seasonal-naive WAPE.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from bakerysense.data import ensure_dense, filter_skus, load_bakery  # noqa: E402
from bakerysense.decision import newsvendor_quantity, newsvendor_target_quantile  # noqa: E402
from bakerysense.eval import evaluate, seasonal_naive  # noqa: E402
from bakerysense.explain import explain_row, summarize_drivers_human  # noqa: E402
from bakerysense.features import build_features, drop_warmup, feature_columns  # noqa: E402
from bakerysense.forecaster import QuantileGBM  # noqa: E402

HOLDOUT_DAYS = 28
VALID_DAYS = 28
MODEL_DIR = REPO_ROOT / "models" / "gbm"


def main() -> int:
    print("=" * 72)
    print("BakerySense — Day-1 baseline")
    print("=" * 72)

    df = load_bakery()
    print(f"\nRaw loaded: {len(df):,} rows  ·  {df['sku'].nunique()} SKUs  ·  "
          f"{df['date'].min().date()} → {df['date'].max().date()}")

    if df["sku"].nunique() > 25:
        df = filter_skus(df, top_n=20)
        df = ensure_dense(df, fill_value=0)
        print(f"After filter+dense: {len(df):,} rows  ·  {df['sku'].nunique()} SKUs "
              f"(top-20 by volume, daily grid)")

    feats = build_features(df)
    feats = drop_warmup(feats)

    cutoff_test = feats["date"].max() - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    cutoff_valid = cutoff_test - pd.Timedelta(days=VALID_DAYS)

    train = feats[feats["date"] < cutoff_valid].copy()
    valid = feats[(feats["date"] >= cutoff_valid) & (feats["date"] < cutoff_test)].copy()
    test = feats[feats["date"] >= cutoff_test].copy()

    fcols = feature_columns(feats)
    print(f"\nFeature count: {len(fcols)}")
    print(f"Train rows: {len(train):,}  ·  Valid rows: {len(valid):,}  ·  Test rows: {len(test):,}")

    print("\nTraining LightGBM quantile grid (0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9)…")
    model = QuantileGBM()
    model.fit(train, valid=valid, feature_names=fcols)

    preds = model.predict_all(test)
    preds.index = test.index

    naive = seasonal_naive(feats, lag=7).loc[test.index].to_numpy()
    valid_mask = ~np.isnan(naive)
    if not valid_mask.all():
        test = test.loc[valid_mask]
        preds = preds.loc[valid_mask]
        naive = naive[valid_mask]

    metrics = evaluate(test, preds, naive, quantiles=model.quantiles)

    overall = metrics.iloc[0]
    print("\n" + "-" * 72)
    print("OVERALL  (lower is better)")
    print("-" * 72)
    print(f"  seasonal-7 naive WAPE : {overall['wape_naive']:.4f}")
    for q in model.quantiles:
        col = f"q{q:g}"
        print(f"  LightGBM      {col:<5} WAPE : {overall[f'wape_{col}']:.4f}  "
              f"pinball {overall[f'pinball_{col}']:.4f}")
    print(f"  LightGBM      q=0.5 MASE : {overall['mase']:.4f}  (< 1 beats naive)")

    print("\n" + "-" * 72)
    print("PER-SKU  (WAPE: naive vs LightGBM q=0.5)")
    print("-" * 72)
    per_sku = metrics.iloc[1:].copy()
    per_sku["improvement"] = per_sku["wape_naive"] - per_sku["wape_q0.5"]
    per_sku = per_sku.sort_values("improvement", ascending=False)
    print(f"  {'SKU':<22} {'n':>4} {'naive':>8} {'LGBM':>8} {'Δ':>8}")
    for _, r in per_sku.iterrows():
        print(
            f"  {r['scope']:<22} {int(r['n']):>4} "
            f"{r['wape_naive']:>8.4f} {r['wape_q0.5']:>8.4f} "
            f"{r['improvement']:>+8.4f}"
        )

    # ----- newsvendor + explanation for one SKU-day -----
    print("\n" + "-" * 72)
    print("END-TO-END EXAMPLE  (last day in holdout, Cu=2, Co=1 → target q=0.667)")
    print("-" * 72)
    cu, co = 2.0, 1.0
    target_q = newsvendor_target_quantile(cu, co)
    last_day = test["date"].max()
    last_day_mask = test["date"] == last_day
    sample = test.loc[last_day_mask, ["sku"]].copy()
    for q in model.quantiles:
        sample[f"q{q:g}"] = preds.loc[last_day_mask, f"q{q:g}"].round(0).astype(int)

    print(f"  target service quantile: {target_q:.3f}")
    print(f"  {'SKU':<22}" + "".join(f"{f'q{q:g}':>6}" for q in model.quantiles)
          + f"{'bake':>6}{'used':>7}")
    for _, r in sample.sort_values(f"q{model.quantiles[len(model.quantiles) // 2]:g}",
                                    ascending=False).iterrows():
        quantile_preds = {q: float(r[f"q{q:g}"]) for q in model.quantiles}
        qty, used_q = newsvendor_quantity(quantile_preds, cu=cu, co=co)
        qs = "".join(f"{int(r[f'q{q:g}']):>6}" for q in model.quantiles)
        print(f"  {r['sku']:<22}{qs}{int(round(qty)):>6}{used_q:>7.2f}")

    # one explanation example for the highest-variance SKU
    example_sku = per_sku.iloc[0]["scope"]
    print("\n" + "-" * 72)
    print(f"SHAP DRIVERS  (SKU = {example_sku}, date = {last_day.date()})")
    print("-" * 72)
    example_row = test[(test["sku"] == example_sku) & (test["date"] == last_day)]
    if len(example_row) == 1:
        explanation = explain_row(model, example_row, quantile=0.5, top_k=4)
        print(f"  prediction      : {explanation.prediction:.1f} units")
        print(f"  base (expected) : {explanation.base_value:.1f} units")
        print(f"  top drivers     : {summarize_drivers_human(explanation.drivers)}")

    # ----- save model -----
    print("\n" + "-" * 72)
    print(f"SAVING MODEL to {MODEL_DIR.relative_to(REPO_ROOT)}")
    print("-" * 72)
    model.save(MODEL_DIR)
    print(f"  {len(model.quantiles)} boosters saved. Metadata: {MODEL_DIR}/metadata.json")

    verdict = "PASS" if overall["mase"] < 1.0 else "FAIL"
    print(f"\nDAY-1 VERDICT: {verdict}  (MASE = {overall['mase']:.3f})")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
