"""Feature engineering for daily SKU-level demand forecasting.

Builds leak-free lag and rolling features per SKU, plus calendar and holiday
features. Weather columns from the input DataFrame are passed through.
"""

from __future__ import annotations

import pandas as pd

LAG_STEPS = (1, 7, 14, 28, 365)
ROLLING_WINDOWS = (7, 28)

TARGET = "units_sold"
GROUP = "sku"
DATE = "date"


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Return a feature-engineered copy of ``df`` safe for training a demand model.

    Assumes ``df`` is long-format with one row per (sku, date) and columns
    ``date``, ``sku``, ``units_sold``, plus any weather / exogenous columns.
    """
    df = df.sort_values([GROUP, DATE]).reset_index(drop=True).copy()

    grouped = df.groupby(GROUP, sort=False)[TARGET]

    for lag in LAG_STEPS:
        df[f"lag_{lag}"] = grouped.shift(lag)

    for window in ROLLING_WINDOWS:
        # shift(1) first so today's value is never in its own rolling window
        shifted = grouped.shift(1)
        df[f"rolling_mean_{window}"] = (
            shifted.groupby(df[GROUP], sort=False)
            .rolling(window=window, min_periods=max(2, window // 2))
            .mean()
            .reset_index(level=0, drop=True)
        )

    dt = df[DATE]
    df["dow"] = dt.dt.dayofweek
    df["day_of_month"] = dt.dt.day
    df["month"] = dt.dt.month
    df["week_of_year"] = dt.dt.isocalendar().week.astype(int)
    df["is_weekend"] = (df["dow"] >= 5).astype(int)

    # holiday ±1 day signal if is_holiday is present
    if "is_holiday" in df.columns:
        h = df.groupby(GROUP, sort=False)["is_holiday"]
        df["holiday_lead_1"] = h.shift(-1).fillna(0).astype(int)
        df["holiday_lag_1"] = h.shift(1).fillna(0).astype(int)

    df[GROUP] = df[GROUP].astype("category")
    return df


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Columns the model should train on (everything except identifiers/target)."""
    exclude = {DATE, TARGET}
    return [c for c in df.columns if c not in exclude]


def drop_warmup(df: pd.DataFrame) -> pd.DataFrame:
    """Remove rows where short-horizon lag/rolling features are undefined.

    `lag_365` may legitimately stay NaN for the first year of any tenant's
    history — LightGBM treats NaN as a valid split direction, so we don't
    require it to be populated for a row to be usable. The warmup cut is
    keyed on the longest non-yearly lag so we don't lose 12 months of
    training data on a 1.7-year corpus.
    """
    short_lags = [l for l in LAG_STEPS if l < 365]
    min_lag = max(short_lags)
    return df.dropna(subset=[f"lag_{min_lag}"]).reset_index(drop=True)
