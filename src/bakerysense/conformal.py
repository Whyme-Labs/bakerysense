"""Split conformal prediction for quantile forecasts.

The benchmark exposed that the GBM's q0.9 (pinball 1.153) and TimesFM's
q0.9 (1.091) are uncalibrated — they're the model's idea of where the
90th-percentile sits, not a guaranteed-coverage interval.

Conformal prediction wraps any quantile forecaster in a finite-sample
distribution-free coverage guarantee. Use a held-out CALIBRATION SET to
compute residuals from the model's q0.9, take the (1-α)-quantile of those
residuals, and shift the model's q0.9 by that amount. The result has
guaranteed marginal 1-α coverage on exchangeable test data.

Reference: Vovk et al., "Algorithmic Learning in a Random World" (2005).
For time series specifically: Chernozhukov et al., "Conformal Prediction
for Dependent Time-Series" (NeurIPS 2018).

We use SPLIT conformal (a.k.a. inductive conformal): partition train into
fit + calibration, fit on fit, calibrate on calibration. For our pipeline
the natural split is train (model fit) + valid (calibration) + test
(eval) — already the structure benchmark_vs_baselines.py uses.
"""
from __future__ import annotations

import numpy as np


def conformal_residuals(
    y_true: np.ndarray,
    q_pred: np.ndarray,
) -> np.ndarray:
    """Conformity scores for a one-sided upper-bound quantile forecast.

    For q0.9 we want: P(y > q0.9_pred + δ) ≤ 0.1. The relevant residual
    is `y - q_pred` clipped at zero, but for split conformal symmetric
    about zero (signed residuals).
    """
    return np.asarray(y_true) - np.asarray(q_pred)


def upper_bound_offset(residuals: np.ndarray, alpha: float = 0.1) -> float:
    """Offset to add to a model's q_{1-α} prediction to achieve marginal
    1-α empirical coverage on exchangeable data.

    Computes the (1 - α)-quantile of the calibration residuals
    (with the finite-sample correction n+1 → ⌈(n+1)(1-α)⌉/n).
    """
    r = np.asarray(residuals)
    n = len(r)
    if n == 0:
        return 0.0
    # Finite-sample-corrected quantile level (Vovk et al.).
    level = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
    return float(np.quantile(r, level, method="higher"))


def calibrate_q_upper(
    valid_y: np.ndarray,
    valid_q_pred: np.ndarray,
    test_q_pred: np.ndarray,
    alpha: float = 0.1,
) -> tuple[np.ndarray, float]:
    """Apply split conformal prediction to a one-sided q_{1-α} forecast.

    Args:
        valid_y: held-out actuals on the calibration set
        valid_q_pred: model's q_{1-α} forecast on the calibration set
        test_q_pred: model's q_{1-α} forecast on the test set
        alpha: miscoverage level (0.1 → 90% coverage)

    Returns:
        (calibrated_test_q, offset). Add the offset to the test forecast
        to achieve marginal 1-α empirical coverage.
    """
    r = conformal_residuals(valid_y, valid_q_pred)
    delta = upper_bound_offset(r, alpha=alpha)
    calibrated = np.asarray(test_q_pred) + delta
    return calibrated, delta


def empirical_coverage(y_true: np.ndarray, q_pred: np.ndarray) -> float:
    """Fraction of test points where actual ≤ predicted upper bound."""
    return float(np.mean(np.asarray(y_true) <= np.asarray(q_pred)))
