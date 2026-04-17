"""Shared pytest fixtures."""

from __future__ import annotations

import pandas as pd
import pytest

from bakerysense.data import _synthesize
from bakerysense.features import build_features, drop_warmup


@pytest.fixture(scope="session")
def small_raw() -> pd.DataFrame:
    """Short synthetic dataset — fast enough for unit tests."""
    return _synthesize(start="2023-06-01", end="2023-12-31", seed=7, country="FR")


@pytest.fixture(scope="session")
def raw_bakery() -> pd.DataFrame:
    """Full 2-year synthetic dataset used by baseline tests.

    Always synthetic so tests stay deterministic even when data/raw/ contains
    a real dataset.
    """
    return _synthesize(start="2023-01-01", end="2024-12-31", seed=42, country="FR")


@pytest.fixture(scope="session")
def features(small_raw: pd.DataFrame) -> pd.DataFrame:
    return drop_warmup(build_features(small_raw))
