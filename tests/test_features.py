"""Feature engineering is where leakage bugs love to live — guard hard."""

from __future__ import annotations

import pandas as pd

from bakerysense.features import LAG_STEPS, ROLLING_WINDOWS, build_features, drop_warmup


def test_lag_features_are_strictly_from_the_past(small_raw):
    df = build_features(small_raw)
    for sku, group in df.groupby("sku", sort=False, observed=True):
        group = group.sort_values("date")
        for lag in LAG_STEPS:
            # each lag_k[t] should equal units_sold[t - k] for rows with both defined
            col = f"lag_{lag}"
            expected = group["units_sold"].shift(lag)
            # compare where both defined
            mask = ~expected.isna()
            pd.testing.assert_series_equal(
                group.loc[mask, col].reset_index(drop=True),
                expected.loc[mask].reset_index(drop=True),
                check_names=False,
            )


def test_rolling_mean_excludes_current_day(small_raw):
    df = build_features(small_raw)
    # Synthetic check: for a row well past warmup, rolling_mean_7 should
    # equal the mean of the previous 7 days' units_sold, not including today.
    for window in ROLLING_WINDOWS:
        col = f"rolling_mean_{window}"
        for sku, group in df.groupby("sku", sort=False, observed=True):
            group = group.sort_values("date").reset_index(drop=True)
            if len(group) < window + 5:
                continue
            idx = window + 2  # safely past warmup
            observed = group.loc[idx, col]
            expected = group.loc[idx - window : idx - 1, "units_sold"].mean()
            assert abs(observed - expected) < 1e-6, (
                f"{sku} {col}: observed={observed} expected={expected}"
            )
            break  # one SKU is enough for this invariant


def test_drop_warmup_removes_early_rows(small_raw):
    df = build_features(small_raw)
    clean = drop_warmup(df)
    max_lag = max(LAG_STEPS)
    # every surviving row must have the largest lag defined
    assert clean[f"lag_{max_lag}"].isna().sum() == 0
    # nothing beyond the original date range
    assert clean["date"].min() >= df["date"].min() + pd.Timedelta(days=max_lag)


def test_categorical_sku_preserved(small_raw):
    df = build_features(small_raw)
    assert str(df["sku"].dtype) == "category"
    assert set(df["sku"].cat.categories).issuperset({"baguette", "croissant"})


def test_calendar_features_present(small_raw):
    df = build_features(small_raw)
    for col in ("dow", "day_of_month", "month", "week_of_year", "is_weekend"):
        assert col in df.columns
    assert df["is_weekend"].isin({0, 1}).all()
    assert df["dow"].between(0, 6).all()
