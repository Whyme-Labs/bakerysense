"""Tier 22: GIFT-Eval — comparison vs 2024 foundation-model papers.

GIFT-Eval (Salesforce 2024) is the closest thing to a modern foundation-
model time-series benchmark. The Chronos, MOIRAI, and TimesFM papers
all report on subsets of these datasets.

This script runs TimesFM-2.0-500m zero-shot on three retail-adjacent
GIFT-Eval datasets:

  • M4 Monthly       — 48,000 series, broad domain (retail, financial, demographic)
  • Tourism Monthly  — 366 series, seasonal demand patterns (retail-adjacent)
  • Hospital         — 767 series, weekly counts (similar dynamics to bakery sales)

Published reference numbers (sMAPE = symmetric MAPE, MASE = mean abs
scaled error). Sources: original M-papers, Chronos paper (Amazon 2024),
MOIRAI paper (Salesforce 2024), TimesFM paper (Google 2024).

Run:
    python scripts/benchmark_gift_eval.py
"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from bakerysense.eval import mase, wape  # noqa: E402


def smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """M4-paper sMAPE in percent."""
    denom = np.abs(y_true) + np.abs(y_pred)
    mask = denom > 0
    if mask.sum() == 0:
        return 0.0
    return float(200.0 * np.mean(np.abs(y_true[mask] - y_pred[mask]) / denom[mask]))


def seasonal_naive(history: np.ndarray, horizon: int, season: int) -> np.ndarray:
    if len(history) < season:
        return np.full(horizon, history[-1] if len(history) else 0.0)
    out = np.empty(horizon, dtype=np.float64)
    for i in range(horizon):
        out[i] = history[-(season - i % season)]
    return out


def run_dataset(
    dataset_name: str,
    season: int,
    tfm,
    sample_size: int | None = None,
) -> dict[str, float]:
    """Load gluonts dataset, run TimesFM, compute metrics."""
    from gluonts.dataset.repository import get_dataset
    print(f"\n--- {dataset_name} ---", flush=True)
    print(f"  loading…", flush=True)
    ds = get_dataset(dataset_name, regenerate=False)
    pl = ds.metadata.prediction_length

    train_arrays, test_arrays = [], []
    for s in ds.train:
        train_arrays.append(np.asarray(s["target"], dtype=np.float64))
    for s in ds.test:
        test_arrays.append(np.asarray(s["target"], dtype=np.float64))
    n = len(train_arrays)
    print(f"  series: {n:,}  ·  prediction_length: {pl}")

    # Optional subsample for very large datasets
    if sample_size is not None and n > sample_size:
        rng = np.random.default_rng(42)
        idx = rng.choice(n, size=sample_size, replace=False)
        idx.sort()
        train_arrays = [train_arrays[i] for i in idx]
        test_arrays = [test_arrays[i] for i in idx]
        n = len(train_arrays)
        print(f"  subsampled to {n:,} (seed=42)")

    truth = np.array([t[-pl:] for t in test_arrays])  # (n, pl)

    # Seasonal-naive baseline
    naive = np.array([seasonal_naive(train_arrays[i], pl, season) for i in range(n)])

    # TimesFM-2 zero-shot
    print(f"  forecasting with TimesFM-2.0-500m…", flush=True)
    histories = [h[-512:].astype(np.float32) if len(h) > 512 else h.astype(np.float32) for h in train_arrays]
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        # M4 monthly is freq_id = 1 (medium). Hospital is monthly, also 1.
        # Tourism monthly = 1. (timesfm freq: 0=high (daily+), 1=medium, 2=low)
        freq_arr = [1] * len(histories)
        point_fc, _ = tfm.forecast(histories, freq=freq_arr)
    print(f"    inferred in {time.time() - t0:.1f}s")
    tfm_pred = np.array([np.maximum(0.0, np.asarray(p)[:pl]) for p in point_fc])

    smape_naive = smape(truth.flatten(), naive.flatten())
    smape_tfm = smape(truth.flatten(), tfm_pred.flatten())
    mase_naive = mase(truth.flatten(), naive.flatten(), naive.flatten())
    mase_tfm = mase(truth.flatten(), tfm_pred.flatten(), naive.flatten())
    return {
        "n_series": n,
        "horizon": pl,
        "smape_naive": smape_naive,
        "smape_tfm": smape_tfm,
        "mase_naive": mase_naive,
        "mase_tfm": mase_tfm,
    }


def main() -> int:
    print("=" * 78)
    print("Tier 22: GIFT-Eval — TimesFM-2 zero-shot vs 2024 foundation models")
    print("=" * 78)

    import timesfm
    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
    except Exception:
        pass

    print(f"\nloading TimesFM-2.0-500m on backend={backend}…", flush=True)
    t0 = time.time()
    tfm = timesfm.TimesFm(
        hparams=timesfm.TimesFmHparams(
            backend=backend, per_core_batch_size=64, horizon_len=128, context_len=512,
            num_layers=50, use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id="google/timesfm-2.0-500m-pytorch"),
    )
    print(f"  loaded in {time.time() - t0:.1f}s")

    # Datasets with seasonal periods. M4 monthly has 48K series — subsample
    # to 5K for tractable runtime; Tourism + Hospital are small enough to run
    # in full.
    datasets = [
        ("m4_monthly", 12, 5000),
        ("tourism_monthly", 12, None),
        ("hospital", 12, None),
    ]

    results = {}
    for ds_name, season, sample in datasets:
        try:
            results[ds_name] = run_dataset(ds_name, season, tfm, sample_size=sample)
        except Exception as e:
            print(f"  {ds_name} failed: {e}")
            results[ds_name] = None

    # ── Headline comparison ─────────────────────────────────────────────
    print("\n" + "=" * 78)
    print("RESULTS — TimesFM-2 zero-shot on GIFT-Eval-class datasets")
    print("=" * 78)
    print(f"  {'dataset':<22} {'series':>8} {'h':>4} {'sMAPE_naive':>12} {'sMAPE_TFM':>12} {'MASE_TFM':>10}")
    print("  " + "-" * 76)
    for entry in datasets:
        ds_name = entry[0]
        r = results.get(ds_name)
        if r is None:
            continue
        print(f"  {ds_name:<22} {r['n_series']:>8} {r['horizon']:>4} {r['smape_naive']:>12.3f} {r['smape_tfm']:>12.3f} {r['mase_tfm']:>10.3f}")

    print("\n" + "═" * 78)
    print("PUBLISHED 2024 FOUNDATION-MODEL NUMBERS (from Chronos / MOIRAI / TimesFM papers)")
    print("═" * 78)
    print()
    print("M4 Monthly (sMAPE, lower better):")
    print("  Naive2 baseline                : 14.42")
    print("  ETS (M4 paper)                 : 13.53")
    print("  N-BEATS (Oreshkin 2019)        : 12.04")
    print("  ES-RNN (M4 winner, Smyl 2018)  : 12.13")
    print("  TimesFM-1 zero-shot (paper)    : 13.20  (200m)")
    print("  Chronos-Large (Ansari 2024)    : 12.71")
    print("  MOIRAI-Large (Liu 2024)        : 13.50")
    print()
    print("Tourism Monthly (sMAPE):")
    print("  Naive2                         : 21.4")
    print("  ETS                            : 18.7")
    print("  Chronos-Large                  : 18.0  (approx, paper Table)")
    print("  MOIRAI                         : 18.5  (approx)")
    print()
    print("Hospital (MASE, lower better):")
    print("  Seasonal-naive                 : 1.00")
    print("  ETS                            : 0.79")
    print("  Chronos / MOIRAI / TimesFM     : ~0.75  (approx, mostly tied)")
    print()
    print("(Numbers above are approximate from various 2024 paper tables.")
    print("Use them as indicative ranges, not exact ranks.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
