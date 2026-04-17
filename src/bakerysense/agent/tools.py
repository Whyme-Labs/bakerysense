"""Tools Gemma 4 calls during inference.

Each tool is a deterministic Python function that returns a JSON-serialisable
dict. Gemma's job is to pick the right tool, read the result, and explain it
to the user. Numeric reasoning stays on our side of the boundary.

The JSON schemas in ``TOOL_SCHEMAS`` are handed to Gemma via the
OpenAI-compatible ``tools=`` parameter exposed by llama-cpp-python.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd

from bakerysense.agent.state import AgentState
from bakerysense.decision import newsvendor_quantity, newsvendor_target_quantile
from bakerysense.explain import explain_row, make_feature_row


class ToolError(Exception):
    """Raised when a tool receives bad arguments — Gemma sees the message and can retry."""


# ----------------------------------------------------------- helpers
def _coerce_date(raw: str | date | datetime) -> pd.Timestamp:
    if isinstance(raw, (date, datetime)):
        return pd.Timestamp(raw)
    try:
        return pd.Timestamp(raw)
    except Exception as e:
        raise ToolError(f"Invalid date: {raw!r}. Expected ISO format YYYY-MM-DD.") from e


def _lookup_feature_row(state: AgentState, sku: str, on_date: pd.Timestamp) -> pd.DataFrame:
    if sku not in state.skus():
        raise ToolError(f"Unknown SKU {sku!r}. Available: {', '.join(state.skus())}")
    try:
        return make_feature_row(state.features, sku, on_date)
    except KeyError as e:
        raise ToolError(str(e)) from e


# ---------------------------------------------------------------- tools
@dataclass
class ForecastResult:
    sku: str
    date: str
    quantiles: dict[str, float]
    bake_quantity: int
    target_quantile: float
    selected_quantile: float
    forecaster: str

    def to_dict(self) -> dict:
        return {
            "sku": self.sku,
            "date": self.date,
            "quantiles": {k: round(v, 1) for k, v in self.quantiles.items()},
            "bake_quantity": int(self.bake_quantity),
            "target_quantile": round(self.target_quantile, 3),
            "selected_quantile": round(self.selected_quantile, 3),
            "forecaster": self.forecaster,
        }


def forecast(state: AgentState, sku: str, on_date: str) -> dict:
    """Return quantile forecasts and a newsvendor production quantity for one SKU-day."""
    ts = _coerce_date(on_date)
    row = _lookup_feature_row(state, sku, ts)
    quantile_preds = state.model.predict_row_all(row)

    qty, used_q = newsvendor_quantity(quantile_preds, cu=state.cu, co=state.co)
    target_q = newsvendor_target_quantile(state.cu, state.co)

    result = ForecastResult(
        sku=sku,
        date=ts.date().isoformat(),
        quantiles={f"q{q:g}": float(v) for q, v in quantile_preds.items()},
        bake_quantity=int(round(qty)),
        target_quantile=target_q,
        selected_quantile=used_q,
        forecaster="lightgbm_quantile",
    )
    return result.to_dict()


def explain_drivers(state: AgentState, sku: str, on_date: str, top_k: int = 3) -> dict:
    """Return the top-k SHAP drivers behind the median-quantile forecast."""
    ts = _coerce_date(on_date)
    row = _lookup_feature_row(state, sku, ts)
    explanation = explain_row(state.model, row, quantile=0.5, top_k=top_k)
    return explanation.to_dict()


def waste_risk(state: AgentState, sku: str, on_date: str, threshold_pct: float = 10.0) -> dict:
    """Return an estimate of the probability that waste exceeds ``threshold_pct``.

    Uses the trained quantile grid to score how likely realised demand falls
    below ``bake_quantity * (1 - threshold/100)``.
    """
    ts = _coerce_date(on_date)
    row = _lookup_feature_row(state, sku, ts)
    quantile_preds = state.model.predict_row_all(row)
    qty, _ = newsvendor_quantity(quantile_preds, cu=state.cu, co=state.co)
    ok_ceiling = qty * (1.0 - threshold_pct / 100.0)

    sorted_q = sorted(quantile_preds.items())
    # linear interpolation through the quantile curve to estimate P(demand <= ok_ceiling)
    prob = _invert_quantile_curve(sorted_q, ok_ceiling)
    return {
        "sku": sku,
        "date": ts.date().isoformat(),
        "bake_quantity": int(round(qty)),
        "threshold_pct": threshold_pct,
        "waste_probability": round(prob, 3),
    }


def _invert_quantile_curve(sorted_q: list[tuple[float, float]], target_value: float) -> float:
    """Given sorted (quantile, value) pairs, estimate the quantile at ``target_value``."""
    if not sorted_q:
        return 0.0
    if target_value <= sorted_q[0][1]:
        return float(sorted_q[0][0])
    if target_value >= sorted_q[-1][1]:
        return float(sorted_q[-1][0])
    for (q0, v0), (q1, v1) in zip(sorted_q, sorted_q[1:], strict=False):
        if v0 <= target_value <= v1:
            if v1 == v0:
                return float(q0)
            return float(q0 + (q1 - q0) * (target_value - v0) / (v1 - v0))
    return float(sorted_q[-1][0])


def list_skus(state: AgentState) -> dict:
    """Return the list of SKUs the forecaster knows about."""
    return {"skus": state.skus()}


def suggest_markdowns(
    state: AgentState,
    inventory: dict[str, int],
    as_of: str | None = None,
) -> dict:
    """Given remaining inventory at end of day, suggest discount percentages.

    Rough policy (calibrated later): if inventory exceeds the q=0.7 forecast
    by more than 20 %, recommend a 30 % markdown. If it exceeds q=0.5 by 10 %,
    recommend a 15 % markdown. Otherwise none.
    """
    ts = pd.Timestamp(as_of) if as_of else state.last_date
    out = []
    for sku, remaining in inventory.items():
        try:
            row = _lookup_feature_row(state, sku, ts)
        except ToolError:
            continue
        preds = state.model.predict_row_all(row)
        q50 = preds.get(0.5)
        q70 = preds.get(0.7) or preds.get(0.8)
        if q50 is None or q70 is None:
            continue
        if remaining > q70 * 1.2:
            out.append({"sku": sku, "remaining": remaining, "discount_pct": 30,
                        "reason": "inventory > q0.7 forecast + 20%"})
        elif remaining > q50 * 1.1:
            out.append({"sku": sku, "remaining": remaining, "discount_pct": 15,
                        "reason": "inventory > q0.5 forecast + 10%"})
    return {"as_of": ts.date().isoformat(), "markdowns": out}


# -------------------------------------------------------- tool schemas for Gemma
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "forecast",
            "description": (
                "Return the demand forecast and recommended bake quantity for one "
                "SKU on one date. Use this when the merchant asks how many units "
                "to produce or what the forecast is for a specific item."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Product code, e.g. 'baguette'"},
                    "on_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                },
                "required": ["sku", "on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain_drivers",
            "description": (
                "Return the top SHAP drivers behind a SKU-day forecast so you can "
                "explain to the merchant why demand is forecast higher or lower "
                "than normal. Use after forecast() when the merchant asks 'why'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string"},
                    "on_date": {"type": "string", "description": "ISO date"},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3},
                },
                "required": ["sku", "on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "waste_risk",
            "description": (
                "Estimate the probability that today's production batch leaves "
                "more than 10% of units unsold. Call this with just sku and "
                "on_date — the 10% threshold is the standard default. Only "
                "pass threshold_pct if the merchant explicitly asks about a "
                "different percentage (e.g. '15% waste risk')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string"},
                    "on_date": {"type": "string", "description": "ISO date"},
                    "threshold_pct": {
                        "type": "number",
                        "description": "Optional. Only override if merchant names a specific percentage. Defaults to 10.",
                    },
                },
                "required": ["sku", "on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_skus",
            "description": "Return the list of SKUs the forecaster currently supports.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_markdowns",
            "description": (
                "Given end-of-day remaining inventory, return markdown percentages "
                "per SKU. Use when merchant asks what to discount."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "inventory": {
                        "type": "object",
                        "description": "Mapping of SKU name to remaining unit count.",
                        "additionalProperties": {"type": "integer"},
                    },
                    "as_of": {"type": "string", "description": "ISO date, optional"},
                },
                "required": ["inventory"],
            },
        },
    },
]


TOOL_REGISTRY = {
    "forecast": forecast,
    "explain_drivers": explain_drivers,
    "waste_risk": waste_risk,
    "list_skus": list_skus,
    "suggest_markdowns": suggest_markdowns,
}


def dispatch(state: AgentState, name: str, arguments: dict) -> dict:
    """Look up ``name`` in the registry and invoke it with ``arguments``.

    Returns a JSON-serialisable dict in all cases — on error we return
    ``{"error": ...}`` rather than raising so Gemma can choose how to recover.
    """
    fn = TOOL_REGISTRY.get(name)
    if fn is None:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(state, **arguments)
    except ToolError as e:
        return {"error": str(e)}
    except TypeError as e:
        return {"error": f"Bad arguments for {name}: {e}"}
