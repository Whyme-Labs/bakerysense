"""Head-to-head on the NN5 Daily competition dataset (ATM withdrawals).

NN5 Daily is one of the most-cited daily-frequency forecasting benchmarks in
the literature — original NN5 competition 2008, then included in the Monash
Time Series Forecasting Archive (Godahewa et al. 2021). 111 ATM series,
56-day forecast horizon, strong weekly seasonality (weekday vs weekend
withdrawal patterns).

What we run:
  1. Seasonal-naive (lag-7) — competition baseline
  2. AutoARIMA, AutoETS, CrostonClassic — statsforecast classics
  3. V1.5 population prior — our (sku, dow) median, generalised to (series, dow)
  4. V1.5 PER-QUANTILE blend — prior median + ETS tail (we don't fit a GBM
     here because there are no covariates / tabular features for NN5)
  5. TimesFM-2.0-500m zero-shot

Published numbers (Monash paper + original NN5 leaderboard):
  • Naive baseline: sMAPE ~22.0
  • Top NN5 (2008): sMAPE ~19.6 (Andrawis et al.)
  • SES / Theta: sMAPE ~20-21
  • DeepAR / N-BEATS: sMAPE ~16-18

Run:
    python scripts/benchmark_nn5.py
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

# noqa: E402 — sys.path mutation needed before bakerysense imports
from bakerysense.eval import mase, pinball_loss, wape  # noqa: E402

PREDICTION_LENGTH = 56  # NN5's published horizon
USE_TIMESFM = True


def smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Symmetric MAPE — the standard NN5 / M4 daily metric.
    Uses the M4-paper formula: 200 * mean(|y - p| / (|y| + |p|))."""
    denom = np.abs(y_true) + np.abs(y_pred)
    mask = denom > 0
    return float(200.0 * np.mean(np.abs(y_true[mask] - y_pred[mask]) / denom[mask]))


def load_nn5() -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Load NN5 Daily without missing values via gluonts.
    Returns (train_series, test_series). Each series is a 1-D array."""
    from gluonts.dataset.repository import get_dataset
    ds = get_dataset("nn5_daily_without_missing", regenerate=False)
    train_arrays: list[np.ndarray] = []
    test_arrays: list[np.ndarray] = []
    for s in ds.train:
        train_arrays.append(np.asarray(s["target"], dtype=np.float64))
    for s in ds.test:
        test_arrays.append(np.asarray(s["target"], dtype=np.float64))
    return train_arrays, test_arrays


def seasonal_naive_forecast(history: np.ndarray, horizon: int, season: int = 7) -> np.ndarray:
    out = np.empty(horizon)
    for i in range(horizon):
        out[i] = history[-(season - i % season)]
    return out


def per_dow_prior(history: np.ndarray, start_dow: int) -> tuple[np.ndarray, np.ndarray]:
    """V1.5-style population prior. For NN5 the ‘series’ is the analog of an
    SKU. We compute (dow → median) on the training history. Returns (q0.5, q0.9)
    for each future dow given start_dow of the first forecast day."""
    dows = np.array([(start_dow - len(history) + i) % 7 for i in range(len(history))])
    # actually need to compute dow from 0..len-1 of history relative to forecast start
    # easier: each historical day's dow = (start_dow - 1 - (len(history) - 1 - i)) % 7
    n = len(history)
    dow_per_day = np.array([(start_dow - (n - i)) % 7 for i in range(n)])
    medians = np.zeros(7)
    p90s = np.zeros(7)
    for d in range(7):
        mask = dow_per_day == d
        if mask.sum() == 0:
            medians[d] = np.median(history)
            p90s[d] = np.quantile(history, 0.9)
        else:
            medians[d] = np.median(history[mask])
            p90s[d] = np.quantile(history[mask], 0.9)
    return medians, p90s


def predict_prior(history: np.ndarray, horizon: int, start_dow: int) -> tuple[np.ndarray, np.ndarray]:
    medians, p90s = per_dow_prior(history, start_dow)
    out_q50 = np.empty(horizon)
    out_q90 = np.empty(horizon)
    for i in range(horizon):
        d = (start_dow + i) % 7
        out_q50[i] = medians[d]
        out_q90[i] = p90s[d]
    return out_q50, out_q90


def predict_statsforecast(
    train_arrays: list[np.ndarray],
    horizon: int,
    model_name: str,
    starts: list[pd.Timestamp],
) -> np.ndarray:
    """Per-series fit + forecast using statsforecast. Returns a (n_series, horizon)
    array of point forecasts."""
    from statsforecast import StatsForecast
    from statsforecast.models import AutoARIMA, AutoETS, CrostonClassic, SeasonalNaive

    model_map = {
        "AutoARIMA": AutoARIMA(season_length=7),
        "AutoETS":   AutoETS(season_length=7, model="ZZA"),
        "Croston":   CrostonClassic(),
        "SNaive":    SeasonalNaive(season_length=7),
    }
    model = model_map[model_name]

    rows = []
    for i, h in enumerate(train_arrays):
        dates = pd.date_range(starts[i], periods=len(h), freq="D")
        rows.append(pd.DataFrame({
            "unique_id": str(i),
            "ds": dates,
            "y": h,
        }))
    sf_train = pd.concat(rows, ignore_index=True)

    sf = StatsForecast(models=[model], freq="D", n_jobs=1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        forecast_df = sf.forecast(df=sf_train, h=horizon)

    fcol = forecast_df.columns[-1]
    out = np.zeros((len(train_arrays), horizon))
    for i in range(len(train_arrays)):
        rows = forecast_df[forecast_df["unique_id"] == str(i)]
        if len(rows) == horizon:
            out[i] = rows[fcol].to_numpy()
    return out


def predict_timesfm(
    train_arrays: list[np.ndarray],
    horizon: int,
    model_size: str = "500m",
) -> tuple[np.ndarray, np.ndarray]:
    """Zero-shot TimesFM-2 quantile forecast. Returns (q0.5, q0.9) arrays
    of shape (n_series, horizon)."""
    import timesfm  # type: ignore

    backend = "cpu"
    try:
        import torch
        if torch.backends.mps.is_available():
            backend = "gpu"
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
            horizon_len=128,  # >= horizon; we slice down
            context_len=512,
            num_layers=50 if model_size == "500m" else 20,
            use_positional_embedding=False,
        ),
        checkpoint=timesfm.TimesFmCheckpoint(huggingface_repo_id=repo),
    )
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    histories = []
    for h in train_arrays:
        h32 = h.astype(np.float32)
        if len(h32) > 512:
            h32 = h32[-512:]
        histories.append(h32)

    print(f"  forecasting {len(histories)} series × {horizon} days…", flush=True)
    t0 = time.time()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, quantile_fc = tfm.forecast(histories, freq=[0] * len(histories))
    print(f"  inferred in {time.time() - t0:.1f}s", flush=True)

    n = len(histories)
    out_q50 = np.zeros((n, horizon))
    out_q90 = np.zeros((n, horizon))
    for i in range(n):
        m = np.asarray(quantile_fc[i])
        out_q50[i] = np.maximum(0.0, m[:horizon, 1 + 4])  # q0.5
        out_q90[i] = np.maximum(0.0, m[:horizon, 1 + 8])  # q0.9
    return out_q50, out_q90


def main() -> int:
    print("=" * 78)
    print("BakerySense forecasters vs published baselines — NN5 Daily")
    print("=" * 78)

    train, test = load_nn5()
    n = len(train)
    print(f"\nNN5 series: {n} · prediction horizon: {PREDICTION_LENGTH} days")

    # train arrays already exclude the last 56 days (gluonts test = train + last 56)
    # actually in gluonts: train[i] is len = total - prediction_length, test[i] is full length
    # so test[i][-PREDICTION_LENGTH:] is the holdout truth
    truth = np.array([t[-PREDICTION_LENGTH:] for t in test])  # shape (n, 56)

    # Each series starts 1996-03-18 (Wednesday)
    series_start = pd.Timestamp("1996-03-18")
    starts = [series_start] * n
    train_lens = [len(t) for t in train]
    # Forecast first day's dow:
    first_forecast_dows = [
        (series_start.dayofweek + train_lens[i]) % 7 for i in range(n)
    ]

    # ── Seasonal-naive baseline ──────────────────────────────────────────
    naive = np.array([
        seasonal_naive_forecast(train[i], PREDICTION_LENGTH, 7) for i in range(n)
    ])

    # ── statsforecast per-series fits ────────────────────────────────────
    sf_results: dict[str, np.ndarray] = {}
    for name in ["AutoARIMA", "AutoETS", "Croston", "SNaive"]:
        print(f"  fitting {name}…", flush=True)
        try:
            sf_results[name] = predict_statsforecast(train, PREDICTION_LENGTH, name, starts)
        except Exception as e:
            print(f"    {name} failed: {e}")
            sf_results[name] = np.full((n, PREDICTION_LENGTH), np.nan)

    # ── V1.5 population prior (per-series, dow-keyed) ─────────────────────
    print("  fitting V1.5 population prior (per-series × dow)…", flush=True)
    prior_q50 = np.array([
        predict_prior(train[i], PREDICTION_LENGTH, first_forecast_dows[i])[0]
        for i in range(n)
    ])
    prior_q90 = np.array([
        predict_prior(train[i], PREDICTION_LENGTH, first_forecast_dows[i])[1]
        for i in range(n)
    ])

    # ── Tier 4 per-quantile: prior median + ETS tail (no GBM since no covariates) ──
    # ETS gives a calibrated mean forecast we can use as a tail proxy.
    ets_q50 = sf_results.get("AutoETS")
    if ets_q50 is None or np.isnan(ets_q50).all():
        ets_q50 = naive

    # Approximate q0.9 from ETS by widening: 1.28σ assumed via residual std.
    # Closed-form: use pred + 1.28 * std(residuals on train history).
    ets_q90 = np.zeros_like(ets_q50)
    for i in range(n):
        # crude residual std from naive forecast on training data
        h = train[i]
        if len(h) > 14:
            resid = h[7:] - h[:-7]
            sigma = np.std(resid)
            ets_q90[i] = ets_q50[i] + 1.28 * sigma
        else:
            ets_q90[i] = ets_q50[i] * 1.2

    # Tier 4 for NN5: prior at q0.5, ETS-widened at q0.9 (since no GBM)
    tier4_q50 = prior_q50
    tier4_q90 = ets_q90

    # ── TimesFM-2 zero-shot ──────────────────────────────────────────────
    tfm_q50: np.ndarray | None = None
    tfm_q90: np.ndarray | None = None
    if USE_TIMESFM:
        try:
            tfm_q50, tfm_q90 = predict_timesfm(train, PREDICTION_LENGTH, "500m")
        except Exception as e:
            print(f"  TimesFM failed: {e}")

    # ── Tier 6: prior median + TimesFM tail ──────────────────────────────
    if tfm_q90 is not None:
        tier6_q50 = prior_q50
        tier6_q90 = tfm_q90

    # ── Report ──────────────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("OVERALL — point forecast metrics (sMAPE = NN5 official metric)")
    print("─" * 78)
    print(f"  {'forecaster':<36} {'sMAPE':>8} {'WAPE':>8} {'MASE':>8}")
    print("  " + "-" * 60)

    forecasters = [
        ("SeasonalNaive (lag-7)",                  naive),
        ("AutoARIMA (statsforecast)",              sf_results.get("AutoARIMA")),
        ("AutoETS (statsforecast)",                sf_results.get("AutoETS")),
        ("CrostonClassic (intermittent)",          sf_results.get("Croston")),
        ("V1.5 population prior (ours)",           prior_q50),
        ("V1.5 PER-QUANTILE T4 (prior+ETS, ours)", tier4_q50),
    ]
    if tfm_q50 is not None:
        forecasters.append(("TimesFM-2.0-500m zero-shot", tfm_q50))
        forecasters.append(("V1.5 PRIOR+TimesFM TAIL T6 (ours)", tier6_q50))

    for name, p in forecasters:
        if p is None or np.isnan(p).all():
            print(f"  {name:<36} {'N/A':>8} {'N/A':>8} {'N/A':>8}")
            continue
        smape_v = smape(truth.flatten(), p.flatten())
        wape_v = wape(truth.flatten(), p.flatten())
        mase_v = mase(truth.flatten(), p.flatten(), naive.flatten())
        print(f"  {name:<36} {smape_v:>8.3f} {wape_v:>8.4f} {mase_v:>8.3f}")

    # ── Quantile band ───────────────────────────────────────────────────
    print("\n" + "─" * 78)
    print("QUANTILE BAND — pinball loss at q=0.9")
    print("─" * 78)
    print(f"  {'forecaster':<36} {'pinball-q0.9':>14}")
    print(f"  {'V1.5 prior q0.9':<36} {pinball_loss(truth.flatten(), prior_q90.flatten(), 0.9):>14.4f}")
    print(f"  {'V1.5 Tier 4 (prior+ETS-widened)':<36} {pinball_loss(truth.flatten(), tier4_q90.flatten(), 0.9):>14.4f}")
    if tfm_q90 is not None:
        print(f"  {'TimesFM-2 q0.9':<36} {pinball_loss(truth.flatten(), tfm_q90.flatten(), 0.9):>14.4f}")
        print(f"  {'V1.5 Tier 6 (prior+TimesFM)':<36} {pinball_loss(truth.flatten(), tier6_q90.flatten(), 0.9):>14.4f}")

    # ── Summary vs published ─────────────────────────────────────────────
    print("\n" + "═" * 78)
    print("PUBLISHED REFERENCE NUMBERS (NN5 Daily, Monash Archive + NN5 paper)")
    print("═" * 78)
    print("  Naive baseline:           sMAPE ~22.0")
    print("  SES / Theta (classical):  sMAPE ~20-21")
    print("  ARIMA / ETS (auto):       sMAPE ~21-22")
    print("  Top NN5 (Andrawis 2008):  sMAPE ~19.6")
    print("  N-BEATS (deep):           sMAPE ~17-18")
    print("  DeepAR (deep):            sMAPE ~16-17")
    print("  TimesFM-2 (paper):        sMAPE ~13-15 (zero-shot)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
