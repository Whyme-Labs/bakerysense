"""Data loading for BakerySense.

Loads the French Bakery Kaggle dataset if present at ``data/raw/Bakery_Sales.csv``;
otherwise generates a realistic 2-year synthetic bakery dataset so the pipeline
runs end-to-end with zero external data.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import holidays
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"

COLUMNS = ["date", "sku", "units_sold", "temp_c", "precip_mm", "is_holiday"]


@dataclass(frozen=True)
class SkuProfile:
    """Parameters that shape synthetic demand for one SKU."""

    name: str
    base: float
    dow_weights: tuple[float, float, float, float, float, float, float]
    month_amp: float
    weather_temp_coef: float  # units per °C above 20
    weather_rain_coef: float  # units per mm of daily rain
    holiday_multiplier: float
    noise_cv: float  # coefficient of variation for noise


_SKUS: tuple[SkuProfile, ...] = (
    SkuProfile("croissant", 180, (0.85, 0.90, 0.95, 1.00, 1.20, 1.45, 1.30), 0.10, -0.8, -1.5, 1.7, 0.18),
    SkuProfile("baguette", 260, (0.90, 0.95, 1.00, 1.00, 1.15, 1.40, 1.35), 0.08, -0.4, -0.9, 2.2, 0.15),
    SkuProfile("pain_au_chocolat", 140, (0.80, 0.85, 0.95, 1.00, 1.25, 1.50, 1.35), 0.12, -0.6, -1.0, 1.6, 0.20),
    SkuProfile("pandan_bun", 90, (0.95, 1.00, 1.05, 1.05, 1.15, 1.30, 1.10), 0.05, 0.2, -1.8, 1.1, 0.22),
    SkuProfile("curry_puff", 110, (1.00, 1.05, 1.10, 1.10, 1.20, 1.25, 1.00), 0.05, 0.3, -1.2, 1.0, 0.22),
    SkuProfile("red_bean_bun", 70, (0.95, 1.00, 1.05, 1.05, 1.10, 1.20, 1.05), 0.06, 0.1, -1.0, 1.1, 0.24),
    SkuProfile("sourdough", 80, (0.80, 0.85, 0.95, 1.00, 1.20, 1.50, 1.40), 0.15, -0.5, -0.7, 1.8, 0.20),
    SkuProfile("cinnamon_roll", 60, (0.85, 0.90, 1.00, 1.05, 1.20, 1.45, 1.30), 0.10, -0.3, -0.9, 1.5, 0.25),
    SkuProfile("iced_latte", 120, (1.00, 1.05, 1.10, 1.10, 1.20, 1.30, 1.15), 0.25, 2.5, -2.2, 1.2, 0.22),
    SkuProfile("hot_soup", 40, (1.00, 1.00, 1.00, 1.00, 1.05, 1.05, 0.90), -0.30, -1.8, 1.0, 1.2, 0.30),
    SkuProfile("macaron", 45, (0.70, 0.80, 0.90, 1.00, 1.30, 1.70, 1.30), 0.12, 0.0, -0.5, 2.0, 0.28),
    SkuProfile("financier", 50, (0.80, 0.85, 0.95, 1.00, 1.20, 1.45, 1.25), 0.10, 0.0, -0.6, 1.5, 0.26),
)


def load_bakery(
    start: str = "2023-01-01",
    end: str = "2024-12-31",
    seed: int = 42,
    country: str = "FR",
) -> pd.DataFrame:
    """Return a long-format daily sales DataFrame with columns in ``COLUMNS``.

    Loads the French Bakery CSV if present; falls back to synthetic data.
    """
    real = _try_load_french_bakery()
    if real is not None:
        return real
    return _synthesize(start=start, end=end, seed=seed, country=country)


def _try_load_french_bakery() -> pd.DataFrame | None:
    candidates = [
        RAW_DIR / "Bakery_Sales.csv",
        RAW_DIR / "Bakery sales.csv",
        RAW_DIR / "bakery_sales.csv",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        return None

    df = pd.read_csv(path)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    date_col = next((c for c in ("date",) if c in df.columns), None)
    sku_col = next((c for c in ("article", "product", "item", "sku") if c in df.columns), None)
    qty_col = next((c for c in ("quantity", "qty", "units") if c in df.columns), None)
    if not (date_col and sku_col and qty_col):
        return None

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col])
    daily = (
        df.groupby([df[date_col].dt.date, sku_col])[qty_col]
        .sum()
        .reset_index()
        .rename(columns={date_col: "date", sku_col: "sku", qty_col: "units_sold"})
    )
    daily["date"] = pd.to_datetime(daily["date"])
    daily["temp_c"] = 15.0
    daily["precip_mm"] = 0.0
    fr_holidays = holidays.country_holidays("FR")
    daily["is_holiday"] = daily["date"].dt.date.isin(fr_holidays).astype(int)
    return daily[COLUMNS].sort_values(["sku", "date"]).reset_index(drop=True)


def _synthesize(start: str, end: str, seed: int, country: str) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start=start, end=end, freq="D")
    cal = pd.DataFrame({"date": dates})
    cal["dow"] = cal["date"].dt.dayofweek
    cal["month"] = cal["date"].dt.month
    cal["doy"] = cal["date"].dt.dayofyear

    country_holidays = holidays.country_holidays(country)
    cal["is_holiday"] = cal["date"].dt.date.isin(country_holidays).astype(int)

    annual_temp = 12.0 + 10.0 * np.sin(2 * np.pi * (cal["doy"] - 110) / 365.25)
    cal["temp_c"] = annual_temp + rng.normal(0, 2.5, len(cal))
    cal["precip_mm"] = np.maximum(0, rng.gamma(shape=0.7, scale=2.5, size=len(cal)) - 0.5)
    cal.loc[rng.random(len(cal)) > 0.75, "precip_mm"] = 0.0

    out = []
    for sku in _SKUS:
        dow_w = np.array(sku.dow_weights)[cal["dow"].to_numpy()]
        month_seasonal = 1.0 + sku.month_amp * np.sin(2 * np.pi * (cal["doy"] - 80) / 365.25)
        weather = sku.weather_temp_coef * (cal["temp_c"] - 20) + sku.weather_rain_coef * cal["precip_mm"]
        holiday = np.where(cal["is_holiday"] == 1, sku.holiday_multiplier, 1.0)

        expected = np.maximum(1.0, sku.base * dow_w * month_seasonal * holiday + weather)
        noise = rng.normal(1.0, sku.noise_cv, len(cal))
        units = np.maximum(0, expected * noise).round().astype(int)

        out.append(pd.DataFrame({
            "date": cal["date"].to_numpy(),
            "sku": sku.name,
            "units_sold": units,
            "temp_c": cal["temp_c"].to_numpy().round(2),
            "precip_mm": cal["precip_mm"].to_numpy().round(2),
            "is_holiday": cal["is_holiday"].to_numpy(),
        }))

    return pd.concat(out, ignore_index=True).sort_values(["sku", "date"]).reset_index(drop=True)


def list_skus(df: pd.DataFrame) -> list[str]:
    return sorted(df["sku"].unique().tolist())


def filter_skus(
    df: pd.DataFrame,
    top_n: int | None = 20,
    min_days: int = 60,
    min_total_units: int = 100,
    drop_tokens: tuple[str, ...] = (".", "?", "#"),
) -> pd.DataFrame:
    """Drop junk SKUs and keep only the ``top_n`` by total units.

    Real retail datasets have long tails of rare / malformed SKUs that poison
    training (sparse, noisy, often miscoded). For demo/video purposes we train
    on a legible subset of well-behaved products.
    """
    clean = df[~df["sku"].isin(drop_tokens)].copy()
    clean["sku"] = clean["sku"].str.strip()
    clean = clean[clean["sku"].str.len() > 1]

    per_sku = clean.groupby("sku").agg(
        days=("date", "nunique"),
        total=("units_sold", "sum"),
    )
    keep = per_sku[
        (per_sku["days"] >= min_days) & (per_sku["total"] >= min_total_units)
    ].sort_values("total", ascending=False)
    if top_n is not None:
        keep = keep.head(top_n)

    return (
        clean[clean["sku"].isin(keep.index)]
        .sort_values(["sku", "date"])
        .reset_index(drop=True)
    )


def ensure_dense(df: pd.DataFrame, fill_value: int = 0) -> pd.DataFrame:
    """Fill in missing (sku, date) combinations so every SKU has a daily row.

    Retail CSVs only record days with a sale — feature engineering breaks
    on gaps. We expand to the full daily grid per SKU and backfill zeros
    where the bakery was closed / didn't sell that item.
    """
    if df.empty:
        return df
    full_dates = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    skus = df["sku"].unique()
    grid = pd.MultiIndex.from_product([skus, full_dates], names=["sku", "date"]).to_frame(index=False)

    # carry per-day exogenous (temp, precip, is_holiday) — same across SKUs for one date
    exog_cols = [c for c in ("temp_c", "precip_mm", "is_holiday") if c in df.columns]
    exog = df.drop_duplicates("date")[["date", *exog_cols]] if exog_cols else None

    dense = grid.merge(df, on=["sku", "date"], how="left")
    dense["units_sold"] = dense["units_sold"].fillna(fill_value).astype(int)
    if exog is not None:
        for c in exog_cols:
            dense[c] = dense[c].fillna(dense["date"].map(exog.set_index("date")[c]))
    for c in exog_cols:
        if c == "is_holiday":
            dense[c] = dense[c].fillna(0).astype(int)
        else:
            dense[c] = dense[c].fillna(dense[c].median())
    return dense.sort_values(["sku", "date"]).reset_index(drop=True)
