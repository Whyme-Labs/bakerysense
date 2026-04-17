"""Evaluation metrics and baseline models."""

from __future__ import annotations

import numpy as np
import pandas as pd

from bakerysense.features import DATE, GROUP, TARGET


def seasonal_naive(df: pd.DataFrame, lag: int = 7) -> pd.Series:
    """Seasonal-naive baseline: predict = value from ``lag`` days ago, per SKU."""
    return df.groupby(GROUP, sort=False)[TARGET].shift(lag)


def wape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Weighted Absolute Percentage Error — sum(|err|) / sum(|y|)."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.abs(y_true).sum()
    if denom == 0:
        return float("nan")
    return float(np.abs(y_true - y_pred).sum() / denom)


def mase(y_true: np.ndarray, y_pred: np.ndarray, y_naive: np.ndarray) -> float:
    """Mean Absolute Scaled Error — MAE of model / MAE of naive baseline."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    y_naive = np.asarray(y_naive, dtype=float)
    mae_model = np.abs(y_true - y_pred).mean()
    mae_naive = np.abs(y_true - y_naive).mean()
    if mae_naive == 0:
        return float("nan")
    return float(mae_model / mae_naive)


def pinball_loss(y_true: np.ndarray, y_pred: np.ndarray, quantile: float) -> float:
    """Pinball (quantile) loss — the scoring rule matched to quantile regression."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    diff = y_true - y_pred
    loss = np.maximum(quantile * diff, (quantile - 1.0) * diff)
    return float(loss.mean())


def evaluate(
    holdout: pd.DataFrame,
    preds: pd.DataFrame,
    naive: np.ndarray,
    quantiles: tuple[float, ...] = (0.5, 0.8),
) -> pd.DataFrame:
    """Return overall and per-SKU metrics as a tidy DataFrame.

    ``holdout`` must contain ``date``, ``sku``, ``units_sold``. ``preds`` has
    one column per quantile (``q0.5``, ``q0.8``). ``naive`` is aligned with
    ``holdout``'s rows.
    """
    y = holdout[TARGET].to_numpy()
    naive = np.asarray(naive, dtype=float)

    rows: list[dict] = []

    def _row(scope: str, mask: np.ndarray) -> dict:
        out = {"scope": scope, "n": int(mask.sum())}
        y_s = y[mask]
        n_s = naive[mask]
        for q in quantiles:
            col = f"q{q:g}"
            p = preds.loc[mask, col].to_numpy()
            out[f"wape_{col}"] = wape(y_s, p)
            out[f"pinball_{col}"] = pinball_loss(y_s, p, q)
            if q == 0.5:
                out["mase"] = mase(y_s, p, n_s)
        out["wape_naive"] = wape(y_s, n_s)
        return out

    overall_mask = np.ones(len(holdout), dtype=bool)
    rows.append(_row("overall", overall_mask))

    skus = holdout[GROUP].to_numpy()
    for sku in pd.unique(skus):
        mask = skus == sku
        rows.append(_row(str(sku), mask))

    return pd.DataFrame(rows)
