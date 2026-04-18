"""Smoke test for export_trees module (runs if a trained model is present)."""

from pathlib import Path

import pytest

from bakerysense.forecaster.export_trees import export_all


def test_export_smoke(tmp_path):
    src = Path("models/gbm")
    if not src.exists() or not any(src.glob("booster_q*.txt")):
        pytest.skip("no trained LightGBM model at models/gbm")
    out = tmp_path / "trees.json"
    payload = export_all(src, out)
    assert "quantiles" in payload
    assert len(payload["quantiles"]) >= 1
    for q_name, data in payload["quantiles"].items():
        assert "trees" in data
        assert "feature_names" in data
        assert data["num_trees"] == len(data["trees"])
        # sanity on first tree
        t = data["trees"][0]
        assert len(t["split_feature"]) == len(t["threshold"])
        assert len(t["leaf_value"]) >= 1
