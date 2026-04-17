"""Newsvendor production decision.

Given overage cost ``Co`` (unit cost of unsold, perishable inventory) and
underage cost ``Cu`` (lost margin when we stock out), the optimal service
level is ``Cu / (Cu + Co)``. We pick the production quantity from the quantile
forecast that most closely matches this service level.

Typical bakery parameters: Cu = selling_price - unit_cost, Co = unit_cost
(since unsold goods are scrapped at end-of-day). For most bakeries the target
quantile lands between 0.65 and 0.85 — i.e. slightly over-produce rather than
stock out.
"""

from __future__ import annotations

from collections.abc import Mapping


def newsvendor_target_quantile(cu: float, co: float) -> float:
    """Return the optimal service-level quantile for given unit costs."""
    if cu < 0 or co < 0:
        raise ValueError("cu and co must be non-negative")
    total = cu + co
    if total == 0:
        return 0.5
    return cu / total


def newsvendor_quantity(
    quantile_forecasts: Mapping[float, float],
    cu: float,
    co: float,
) -> tuple[float, float]:
    """Return (production_quantity, quantile_used) for one SKU-day.

    ``quantile_forecasts`` maps quantile (e.g. 0.5, 0.8) to the predicted
    unit demand at that quantile. We select the quantile closest to
    ``Cu / (Cu + Co)`` and return its forecast value.
    """
    if not quantile_forecasts:
        raise ValueError("quantile_forecasts must not be empty")
    target_q = newsvendor_target_quantile(cu, co)
    chosen_q = min(quantile_forecasts, key=lambda q: abs(q - target_q))
    return float(quantile_forecasts[chosen_q]), chosen_q
