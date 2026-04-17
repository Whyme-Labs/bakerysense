"""Agent tool layer — dispatch, error shapes, data flow."""

from __future__ import annotations

import pandas as pd
import pytest

from bakerysense.agent.state import AgentState
from bakerysense.agent.tools import TOOL_REGISTRY, TOOL_SCHEMAS, dispatch
from bakerysense.forecaster import QuantileGBM


@pytest.fixture(scope="module")
def state(features, raw_bakery) -> AgentState:
    # train a tiny fast model on a subset
    train = features[features["date"] < features["date"].max() - pd.Timedelta(days=14)]
    model = QuantileGBM(
        quantiles=(0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9),
        num_boost_round=60,
    ).fit(train)
    return AgentState(model=model, features=features, raw=raw_bakery)


def test_registry_matches_schemas():
    schema_names = {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert schema_names == set(TOOL_REGISTRY.keys())


def test_forecast_shape(state):
    last = state.last_date.date().isoformat()
    result = dispatch(state, "forecast", {"sku": "baguette", "on_date": last})
    assert result["sku"] == "baguette"
    assert result["date"] == last
    assert "quantiles" in result
    assert result["bake_quantity"] > 0
    assert 0.0 < result["selected_quantile"] < 1.0


def test_forecast_unknown_sku_returns_error(state):
    last = state.last_date.date().isoformat()
    result = dispatch(state, "forecast", {"sku": "unicorn_bread", "on_date": last})
    assert "error" in result
    assert "Unknown SKU" in result["error"]


def test_forecast_bad_date_returns_error(state):
    result = dispatch(state, "forecast", {"sku": "baguette", "on_date": "not-a-date"})
    assert "error" in result


def test_explain_drivers_returns_topk(state):
    last = state.last_date.date().isoformat()
    result = dispatch(state, "explain_drivers",
                      {"sku": "baguette", "on_date": last, "top_k": 3})
    assert len(result["drivers"]) == 3
    # each driver is (name, signed_value)
    for name, val in result["drivers"]:
        assert isinstance(name, str)
        assert isinstance(val, (int, float))


def test_list_skus(state):
    result = dispatch(state, "list_skus", {})
    assert "baguette" in result["skus"]
    assert len(result["skus"]) >= 5


def test_suggest_markdowns_empty_when_inventory_low(state):
    last = state.last_date.date().isoformat()
    # 5 remaining units is far below any realistic forecast
    result = dispatch(state, "suggest_markdowns",
                      {"inventory": {"baguette": 5}, "as_of": last})
    assert result["markdowns"] == []


def test_unknown_tool_returns_error(state):
    result = dispatch(state, "nonexistent_tool", {})
    assert "error" in result
