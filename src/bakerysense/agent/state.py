"""Agent runtime state.

Holds the loaded forecaster and the feature-engineered dataset in memory so
individual tool calls from Gemma don't re-run the full data pipeline. This
object is created once per demo session and passed into each tool.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from bakerysense.data import load_bakery
from bakerysense.features import build_features, drop_warmup
from bakerysense.forecaster import QuantileGBM

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL_DIR = REPO_ROOT / "models" / "gbm"


@dataclass
class AgentState:
    """Loaded forecaster + feature frame, ready for synchronous tool calls."""

    model: QuantileGBM
    features: pd.DataFrame
    raw: pd.DataFrame
    cu: float = 2.0  # default: selling price - cost = 2 units of margin
    co: float = 1.0  # default: unit cost lost on waste

    # Filled post-init for fast lookup
    _last_date: pd.Timestamp = field(init=False)

    def __post_init__(self) -> None:
        self._last_date = pd.Timestamp(self.features["date"].max())

    @property
    def last_date(self) -> pd.Timestamp:
        return self._last_date

    def skus(self) -> list[str]:
        """Return only the SKUs the trained forecaster actually knows.

        If the model persists a ``sku_categories`` list (which it does from
        week-1 onward), prefer that — it's the ground truth for what we can
        forecast. Fall back to the raw dataset if the model predates that.
        """
        trained = self.model.sku_categories
        if trained:
            return sorted(trained)
        return sorted(self.raw["sku"].unique().tolist())

    @classmethod
    def from_disk(
        cls,
        model_dir: str | Path = DEFAULT_MODEL_DIR,
        cu: float = 2.0,
        co: float = 1.0,
    ) -> "AgentState":
        model = QuantileGBM.load(model_dir)
        raw = load_bakery()
        features = drop_warmup(build_features(raw))
        # restrict features to the SKUs the model was trained on, so tool
        # lookups and state.skus() can never offer an item we cannot forecast
        trained_skus = set(model.sku_categories)
        if trained_skus:
            raw = raw[raw["sku"].isin(trained_skus)].reset_index(drop=True)
            features = features[features["sku"].isin(trained_skus)].reset_index(drop=True)
        return cls(model=model, features=features, raw=raw, cu=cu, co=co)
