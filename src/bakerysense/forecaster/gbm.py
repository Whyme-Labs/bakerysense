"""LightGBM quantile forecaster.

Trains one LightGBM booster per requested quantile, globally across SKUs with
``sku`` as a categorical feature. Quantile regression gives us the distribution
shape that the newsvendor decision layer needs — point forecasts alone are not
enough to decide how much to bake.

Persistence is JSON metadata + LightGBM's native text model format (never pickle).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from bakerysense.features import TARGET, feature_columns

DEFAULT_PARAMS: dict = {
    "objective": "quantile",
    "metric": "quantile",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 30,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.9,
    "bagging_freq": 5,
    "verbosity": -1,
}

DEFAULT_QUANTILES: tuple[float, ...] = (0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9)


@dataclass
class QuantileGBM:
    """LightGBM quantile regressor trained for multiple quantiles."""

    quantiles: tuple[float, ...] = DEFAULT_QUANTILES
    num_boost_round: int = 800
    early_stopping_rounds: int = 50
    params: dict = field(default_factory=lambda: dict(DEFAULT_PARAMS))
    _models: dict[float, lgb.Booster] = field(default_factory=dict, init=False)
    _feature_names: list[str] = field(default_factory=list, init=False)
    _categorical_features: list[str] = field(default_factory=list, init=False)
    _sku_categories: list[str] = field(default_factory=list, init=False)

    # ------------------------------------------------------------------ train
    def fit(
        self,
        train: pd.DataFrame,
        valid: pd.DataFrame | None = None,
        feature_names: Iterable[str] | None = None,
    ) -> "QuantileGBM":
        self._feature_names = list(feature_names) if feature_names else feature_columns(train)
        self._categorical_features = [
            c for c in self._feature_names if str(train[c].dtype) == "category"
        ]
        if "sku" in train.columns and str(train["sku"].dtype) == "category":
            self._sku_categories = list(train["sku"].cat.categories)

        x_train = train[self._feature_names]
        y_train = train[TARGET]
        train_set = lgb.Dataset(
            x_train, label=y_train, categorical_feature=self._categorical_features,
        )

        valid_sets = [train_set]
        valid_names = ["train"]
        if valid is not None and len(valid) > 0:
            x_valid = valid[self._feature_names]
            y_valid = valid[TARGET]
            valid_set = lgb.Dataset(
                x_valid,
                label=y_valid,
                categorical_feature=self._categorical_features,
                reference=train_set,
            )
            valid_sets.append(valid_set)
            valid_names.append("valid")

        for q in self.quantiles:
            params = dict(self.params)
            params["alpha"] = q
            callbacks = [lgb.log_evaluation(period=0)]
            if valid is not None and len(valid) > 0:
                callbacks.append(lgb.early_stopping(self.early_stopping_rounds, verbose=False))
            self._models[q] = lgb.train(
                params=params,
                train_set=train_set,
                num_boost_round=self.num_boost_round,
                valid_sets=valid_sets,
                valid_names=valid_names,
                callbacks=callbacks,
            )
        return self

    # ---------------------------------------------------------------- predict
    def predict(self, df: pd.DataFrame, quantile: float = 0.5) -> np.ndarray:
        if quantile not in self._models:
            raise ValueError(
                f"Quantile {quantile} not trained. Available: {sorted(self._models)}"
            )
        preds = self._models[quantile].predict(df[self._feature_names])
        return np.maximum(0.0, preds)

    def predict_all(self, df: pd.DataFrame) -> pd.DataFrame:
        """Return a DataFrame with one column per trained quantile."""
        out = pd.DataFrame(index=df.index)
        for q in self.quantiles:
            out[f"q{q:g}"] = self.predict(df, q)
        return out

    def predict_row_all(self, row: pd.DataFrame) -> dict[float, float]:
        """Return a ``{quantile: prediction}`` dict for a single-row DataFrame."""
        if len(row) != 1:
            raise ValueError(f"Expected single-row DataFrame, got {len(row)} rows")
        out = {}
        for q in self.quantiles:
            out[q] = float(self.predict(row, q)[0])
        return out

    # --------------------------------------------------------------- explain
    def shap_values(
        self, df: pd.DataFrame, quantile: float = 0.5
    ) -> tuple[np.ndarray, float]:
        """Return (shap_matrix, base_value) for ``df``.

        Uses LightGBM's native ``pred_contrib`` — identical to what the SHAP
        library returns for tree ensembles, without the extra dependency.
        """
        if quantile not in self._models:
            raise ValueError(f"Quantile {quantile} not trained.")
        contrib = self._models[quantile].predict(df[self._feature_names], pred_contrib=True)
        shap = contrib[:, :-1]  # last column is the expected value / base
        base_value = float(contrib[0, -1])
        return shap, base_value

    def feature_importance(self, quantile: float = 0.5) -> pd.Series:
        model = self._models[quantile]
        importance = model.feature_importance(importance_type="gain")
        return pd.Series(importance, index=self._feature_names).sort_values(ascending=False)

    # ----------------------------------------------------------- persistence
    def save(self, directory: str | Path) -> Path:
        """Persist each booster as a LightGBM text model plus a JSON metadata file.

        No pickle. Text format is forward-compatible and human-auditable.
        """
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)
        for q, booster in self._models.items():
            booster.save_model(str(path / f"booster_q{q:g}.txt"))
        meta = {
            "quantiles": list(self.quantiles),
            "feature_names": self._feature_names,
            "categorical_features": self._categorical_features,
            "sku_categories": self._sku_categories,
            "params": self.params,
            "num_boost_round": self.num_boost_round,
            "early_stopping_rounds": self.early_stopping_rounds,
        }
        (path / "metadata.json").write_text(json.dumps(meta, indent=2))
        return path

    @classmethod
    def load(cls, directory: str | Path) -> "QuantileGBM":
        path = Path(directory)
        meta = json.loads((path / "metadata.json").read_text())
        obj = cls(
            quantiles=tuple(meta["quantiles"]),
            num_boost_round=meta["num_boost_round"],
            early_stopping_rounds=meta["early_stopping_rounds"],
            params=meta["params"],
        )
        obj._feature_names = list(meta["feature_names"])
        obj._categorical_features = list(meta["categorical_features"])
        obj._sku_categories = list(meta.get("sku_categories", []))
        for q in obj.quantiles:
            obj._models[q] = lgb.Booster(model_file=str(path / f"booster_q{q:g}.txt"))
        return obj

    @property
    def feature_names(self) -> list[str]:
        return list(self._feature_names)

    @property
    def sku_categories(self) -> list[str]:
        return list(self._sku_categories)
