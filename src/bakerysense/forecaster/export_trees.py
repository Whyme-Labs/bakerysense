"""Export LightGBM boosters as JSON trees for the in-Worker JS walker."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import lightgbm as lgb


def export_booster(booster: lgb.Booster) -> dict[str, Any]:
    """Produce a JSON-serializable tree representation.

    Schema:
      {
        "feature_names": [str, ...],
        "num_trees": int,
        "trees": [
          {
            "split_feature": [int, ...],
            "threshold":     [float, ...],
            "decision_type": [int, ...],   # 2 = <=, 1 = <, 3 = ==
            "left_child":    [int, ...],   # non-negative = internal idx; negative = ~leaf_idx
            "right_child":   [int, ...],
            "leaf_value":    [float, ...]
          }
        ]
      }

    LightGBM's tree_structure is nested dicts. We flatten each tree into parallel
    arrays indexed by internal node id, with children pointing either at another
    internal node (non-negative index) or at a leaf (~leaf_idx, LightGBM's
    negative-leaf convention).
    """
    dump = booster.dump_model()
    feature_names = list(dump["feature_names"])
    trees = []
    for tinfo in dump["tree_info"]:
        node = tinfo["tree_structure"]
        flat = _flatten_tree(node)
        trees.append(flat)
    return {
        "feature_names": feature_names,
        "num_trees": len(trees),
        "trees": trees,
    }


def _flatten_tree(root: dict[str, Any]) -> dict[str, list]:
    """Flatten a single LightGBM tree's nested dict into parallel arrays."""
    split_feature: list[int] = []
    threshold: list[float] = []
    decision_type: list[int] = []
    left: list[int] = []
    right: list[int] = []
    leaf_value: list[float] = []

    internal_counter = [0]
    leaf_counter = [0]

    def walk(node: dict) -> int:
        if "split_index" in node:
            idx = internal_counter[0]
            internal_counter[0] += 1
            split_feature.append(int(node["split_feature"]))
            threshold.append(float(node["threshold"]))
            decision_type.append(_decision_code(node.get("decision_type", "<=")))
            left.append(0)
            right.append(0)
            lch = walk(node["left_child"])
            rch = walk(node["right_child"])
            left[idx] = lch
            right[idx] = rch
            return idx
        else:
            leaf_idx = leaf_counter[0]
            leaf_counter[0] += 1
            leaf_value.append(float(node["leaf_value"]))
            return ~leaf_idx

    walk(root)

    return {
        "split_feature": split_feature,
        "threshold": threshold,
        "decision_type": decision_type,
        "left_child": left,
        "right_child": right,
        "leaf_value": leaf_value,
    }


def _decision_code(dt: str) -> int:
    return {"<=": 2, "<": 1, "==": 3}.get(dt, 2)


def export_all(models_dir: Path, out_path: Path) -> dict[str, Any]:
    """Load all booster_q*.txt under models_dir, export to a single JSON file."""
    trees_per_quantile: dict[str, Any] = {}
    for p in sorted(models_dir.glob("booster_q*.txt")):
        # filename: booster_q0.1.txt, booster_q0.5.txt, etc.
        stem = p.stem.replace("booster_q", "")
        booster = lgb.Booster(model_file=str(p))
        trees_per_quantile[stem] = export_booster(booster)
    payload = {"generated": "bakerysense.export_trees", "quantiles": trees_per_quantile}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload))
    return payload


def write_parity_fixture(
    booster_dir: Path,
    features_parquet: Path,
    out_json: Path,
    sample_n: int = 100,
    seed: int = 42,
) -> None:
    """Emit a parity fixture used by the JS walker's unit tests.

    Produces a single JSON with:
      {
        "trees":  <same shape as export_all(...)["quantiles"] wrapped in {quantiles: ...}>,
        "cases":  [{ "quantile": str, "features": {col: float}, "expected": float }, ...]
      }
    """
    import numpy as np
    import pandas as pd

    np.random.seed(seed)

    trees_payload = export_all(booster_dir, out_json.with_suffix(".trees.json"))
    features = pd.read_parquet(features_parquet)
    sample = features.sample(n=min(sample_n, len(features)), random_state=seed)

    parity_cases: list[dict] = []
    for q_name in trees_payload["quantiles"]:
        model_path = booster_dir / f"booster_q{q_name}.txt"
        booster = lgb.Booster(model_file=str(model_path))
        feature_cols = booster.feature_name()
        X = sample[feature_cols].values
        y_pred = booster.predict(X)
        for i, row_pred in enumerate(y_pred):
            row = sample.iloc[i]
            parity_cases.append({
                "quantile": q_name,
                "features": {f: float(row[f]) for f in feature_cols},
                "expected": float(row_pred),
            })

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({
        "trees": trees_payload,
        "cases": parity_cases,
    }))
