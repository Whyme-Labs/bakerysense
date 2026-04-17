"""Metric sanity — hand-computed small cases."""

from __future__ import annotations

import numpy as np
import pytest

from bakerysense.eval import mase, pinball_loss, wape


def test_wape_perfect_prediction():
    y = np.array([10.0, 20.0, 30.0])
    assert wape(y, y) == 0.0


def test_wape_handles_all_zero_actuals():
    y = np.zeros(3)
    p = np.array([1.0, 1.0, 1.0])
    assert np.isnan(wape(y, p))


def test_wape_handcalc():
    y = np.array([10.0, 20.0, 30.0])
    p = np.array([12.0, 18.0, 33.0])
    # |err|: 2, 2, 3 sum 7;  |y|: 60 → 7/60
    assert wape(y, p) == pytest.approx(7 / 60)


def test_mase_identity_vs_naive():
    y = np.array([10.0, 20.0, 30.0, 40.0])
    naive = np.array([9.0, 19.0, 29.0, 39.0])  # MAE 1
    pred = np.array([11.0, 21.0, 31.0, 41.0])  # MAE 1
    assert mase(y, pred, naive) == pytest.approx(1.0)


def test_mase_better_than_naive_lt_one():
    y = np.array([10.0, 20.0, 30.0, 40.0])
    naive = np.array([8.0, 22.0, 28.0, 42.0])  # MAE 2
    pred = np.array([10.0, 20.0, 30.0, 40.0])  # MAE 0
    assert mase(y, pred, naive) == 0.0


def test_pinball_at_q50_equals_half_mae():
    y = np.array([10.0, 20.0, 30.0])
    p = np.array([11.0, 19.0, 31.0])  # MAE = 1
    # pinball at q=0.5 returns 0.5 * MAE
    assert pinball_loss(y, p, 0.5) == pytest.approx(0.5)


def test_pinball_asymmetric_penalises_under_prediction_at_high_q():
    # q=0.8: under-prediction costs 0.8 per unit, over-prediction 0.2 per unit.
    y = np.array([100.0])
    under = np.array([80.0])  # 20 under → loss = 0.8 * 20 = 16
    over = np.array([120.0])  # 20 over → loss = 0.2 * 20 = 4
    assert pinball_loss(y, under, 0.8) == pytest.approx(16.0)
    assert pinball_loss(y, over, 0.8) == pytest.approx(4.0)
