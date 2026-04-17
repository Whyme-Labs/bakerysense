"""SHAP-based driver explanations using LightGBM's native ``pred_contrib``.

Gemma calls ``explain_drivers(sku, date)`` as a tool; that function delegates
here to turn the numeric prediction into a small set of (feature, shap) pairs
that the model can then render in natural language. The numeric work stays
here. The wording stays in the LLM.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from bakerysense.forecaster.gbm import QuantileGBM


@dataclass
class Explanation:
    sku: str
    date: str
    prediction: float
    base_value: float
    drivers: list[tuple[str, float]]  # (feature_name, signed_shap)

    def to_dict(self) -> dict:
        return {
            "sku": self.sku,
            "date": self.date,
            "prediction": round(self.prediction, 2),
            "base_value": round(self.base_value, 2),
            "drivers": [(n, round(v, 3)) for n, v in self.drivers],
        }


# Features that are identifiers / categorical descriptors — we surface them but
# do not merge them together when ranking by absolute contribution.
_IDENTIFIER_FEATURES = {"sku"}


def explain_row(
    model: QuantileGBM,
    feature_row: pd.DataFrame,
    quantile: float = 0.5,
    top_k: int = 3,
) -> Explanation:
    """Return the top-``k`` drivers of the prediction for a single SKU-day row."""
    if len(feature_row) != 1:
        raise ValueError(f"Expected single-row DataFrame, got {len(feature_row)}")

    shap, base = model.shap_values(feature_row, quantile=quantile)
    contributions = shap[0]  # (n_features,)
    feature_names = model.feature_names

    ranked = sorted(
        zip(feature_names, contributions, strict=True),
        key=lambda t: abs(t[1]),
        reverse=True,
    )
    drivers = [(name, float(val)) for name, val in ranked[:top_k]]

    sku = str(feature_row["sku"].iloc[0]) if "sku" in feature_row.columns else ""
    date = ""
    if "date" in feature_row.columns:
        date = pd.Timestamp(feature_row["date"].iloc[0]).date().isoformat()

    prediction = float(model.predict(feature_row, quantile=quantile)[0])

    return Explanation(
        sku=sku,
        date=date,
        prediction=prediction,
        base_value=base,
        drivers=drivers,
    )


def summarize_drivers_human(drivers: list[tuple[str, float]]) -> str:
    """Fallback renderer used if the LLM is unavailable — Gemma does better work.

    Produces a terse string like ``"lag_7 (+8.3) · is_weekend (+4.1) · temp_c (-2.0)"``.
    """
    parts = []
    for name, val in drivers:
        sign = "+" if val >= 0 else ""
        parts.append(f"{name} ({sign}{val:.1f})")
    return " · ".join(parts)


def make_feature_row(
    features: pd.DataFrame, sku: str, target_date: str | pd.Timestamp
) -> pd.DataFrame:
    """Locate the single (sku, date) row in the feature-engineered frame."""
    ts = pd.Timestamp(target_date)
    mask = (features["sku"] == sku) & (features["date"] == ts)
    subset = features[mask]
    if len(subset) == 0:
        raise KeyError(f"No feature row for sku={sku} date={ts.date()}")
    if len(subset) > 1:
        raise ValueError(f"Ambiguous feature row: {len(subset)} matches for sku={sku} date={ts.date()}")
    return subset.copy()


def contributions_to_units(
    drivers: list[tuple[str, float]], base_value: float
) -> list[tuple[str, float]]:
    """Return drivers sorted by magnitude, expressing contributions in unit space.

    The quantile objective in LightGBM produces SHAP values already in the
    target's native unit scale (units_sold). We just normalise the output
    shape for the LLM prompt.
    """
    kept = [(n, v) for n, v in drivers if abs(v) >= 0.01]
    return kept or [("baseline", base_value)]


def ensure_shap_available() -> None:
    """Placeholder for future drift guards or LightGBM version checks."""
    try:
        import lightgbm  # noqa: F401
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("LightGBM is required for explanations") from e
