"""Forecaster smoke tests: train, predict, save, load, explain."""

from __future__ import annotations

import pandas as pd

from bakerysense.forecaster import QuantileGBM


def test_fit_predict_nonnegative(features):
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    test = features[features["date"] >= features["date"].max() - pd.Timedelta(days=14)]
    model = QuantileGBM(quantiles=(0.5, 0.8), num_boost_round=40)
    model.fit(train, valid=None)

    preds = model.predict(test, quantile=0.5)
    assert len(preds) == len(test)
    assert (preds >= 0).all()

    all_preds = model.predict_all(test)
    assert set(all_preds.columns) == {"q0.5", "q0.8"}


def test_predict_row_all_shape(features):
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    test = features[features["date"] >= features["date"].max() - pd.Timedelta(days=14)]
    model = QuantileGBM(quantiles=(0.3, 0.5, 0.7), num_boost_round=30).fit(train)
    row = test.head(1)
    out = model.predict_row_all(row)
    assert set(out.keys()) == {0.3, 0.5, 0.7}
    for v in out.values():
        assert v >= 0


def test_save_load_roundtrip(features, tmp_path):
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    test = features[features["date"] >= features["date"].max() - pd.Timedelta(days=14)]

    original = QuantileGBM(quantiles=(0.5, 0.8), num_boost_round=30).fit(train)
    p0 = original.predict_all(test)

    save_dir = tmp_path / "gbm"
    original.save(save_dir)

    reloaded = QuantileGBM.load(save_dir)
    p1 = reloaded.predict_all(test)

    pd.testing.assert_frame_equal(p0.round(6), p1.round(6))
    assert reloaded.feature_names == original.feature_names
    assert reloaded.sku_categories == original.sku_categories


def test_shap_values_sum_to_prediction(features):
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    test = features[features["date"] >= features["date"].max() - pd.Timedelta(days=14)]
    model = QuantileGBM(quantiles=(0.5,), num_boost_round=30).fit(train)

    sample = test.head(5)
    shap, base = model.shap_values(sample, quantile=0.5)
    preds_direct = model.predict(sample, quantile=0.5)

    # LightGBM's pred_contrib: predictions reconstructed as base + shap.sum(axis=1)
    # Our predict() clips at 0; for these synthetic rows the raw predictions
    # are well above zero so clipping shouldn't kick in.
    reconstructed = base + shap.sum(axis=1)
    # allow a small tolerance — lightgbm rounds internally
    assert abs(reconstructed - preds_direct).max() < 1e-4
