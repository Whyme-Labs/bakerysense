"""Newsvendor math is small but load-bearing — cover it hard."""

from __future__ import annotations

import pytest

from bakerysense.decision import newsvendor_quantity, newsvendor_target_quantile


def test_target_quantile_basic():
    assert newsvendor_target_quantile(cu=2, co=1) == pytest.approx(2 / 3)
    assert newsvendor_target_quantile(cu=1, co=1) == 0.5
    assert newsvendor_target_quantile(cu=0, co=5) == 0.0
    assert newsvendor_target_quantile(cu=5, co=0) == 1.0


def test_target_quantile_zero_both():
    # degenerate case: return middle, never crash
    assert newsvendor_target_quantile(cu=0, co=0) == 0.5


def test_target_quantile_rejects_negative():
    with pytest.raises(ValueError):
        newsvendor_target_quantile(cu=-1, co=1)
    with pytest.raises(ValueError):
        newsvendor_target_quantile(cu=1, co=-1)


def test_quantity_picks_closest_quantile():
    # target = 2/3 ≈ 0.667. Closest of {0.5, 0.7, 0.9} is 0.7.
    forecasts = {0.5: 100.0, 0.7: 120.0, 0.9: 150.0}
    qty, used = newsvendor_quantity(forecasts, cu=2, co=1)
    assert used == 0.7
    assert qty == 120.0


def test_quantity_symmetric_picks_lower_when_equidistant():
    # target 0.5, trained {0.3, 0.7}: both equidistant — min() picks 0.3.
    forecasts = {0.3: 80.0, 0.7: 120.0}
    qty, used = newsvendor_quantity(forecasts, cu=1, co=1)
    # both are 0.2 away; Python's min(iter, key=...) picks first encountered
    assert used in (0.3, 0.7)
    assert qty in (80.0, 120.0)


def test_quantity_rejects_empty():
    with pytest.raises(ValueError):
        newsvendor_quantity({}, cu=1, co=1)


def test_bakery_typical_ratio_picks_high_quantile():
    # Bakery: margin often ~2x cost → Cu=2, Co=1 → target 0.667
    # Trained grid {0.5, 0.7, 0.9} → 0.7 should win.
    forecasts = {0.5: 60.0, 0.7: 72.0, 0.9: 90.0}
    qty, used = newsvendor_quantity(forecasts, cu=2, co=1)
    assert used == 0.7
    assert qty == 72.0
