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
            "threshold":     [float, ...],     # 0.0 sentinel for categorical nodes
            "decision_type": [int, ...],        # 2 = <=, 1 = <, 3 = == (categorical)
            "left_child":    [int, ...],        # non-negative = internal idx; negative = ~leaf_idx
            "right_child":   [int, ...],
            "leaf_value":    [float, ...],
            "default_left":  [int, ...],        # 1 if NaN/missing goes left, else 0
            "cat_threshold": [int[] | null, ...]  # per-node: sorted int[] for categorical (dt==3),
                                                  #           null for numeric
          }
        ]
      }

    LightGBM's tree_structure is nested dicts. We flatten each tree into parallel
    arrays indexed by internal node id, with children pointing either at another
    internal node (non-negative index) or at a leaf (~leaf_idx, LightGBM's
    negative-leaf convention).

    Categorical splits use decision_type=="==" and have a threshold like "6||11||13"
    which is a set of allowed category codes. We parse this into cat_threshold[node]
    as a sorted array of ints. The JS walker checks: cat_threshold[node].includes(x).
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
    default_left: list[int] = []
    cat_threshold: list[list[int] | None] = []

    internal_counter = [0]
    leaf_counter = [0]

    def walk(node: dict) -> int:
        if "split_index" in node:
            idx = internal_counter[0]
            internal_counter[0] += 1
            split_feature.append(int(node["split_feature"]))
            dt_str = node.get("decision_type", "<=")
            dt_code = _decision_code(dt_str)
            decision_type.append(dt_code)
            # default_left: True/False or 1/0 in the dump
            dl = node.get("default_left", False)
            default_left.append(1 if dl else 0)
            if dt_code == 3:
                # Categorical split: threshold is "a||b||c" of category indices
                raw_th = str(node["threshold"])
                cat_set = sorted(int(x) for x in raw_th.split("||") if x)
                cat_threshold.append(cat_set)
                threshold.append(0.0)  # sentinel unused for categorical
            else:
                threshold.append(float(node["threshold"]))
                cat_threshold.append(None)
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
        "default_left": default_left,
        "cat_threshold": cat_threshold,
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

    # Pre-convert categorical columns to numeric codes so JS fixture values are integers
    sample_numeric = sample.copy()
    for col in sample_numeric.columns:
        if str(sample_numeric[col].dtype) == "category":
            sample_numeric[col] = sample_numeric[col].cat.codes

    parity_cases: list[dict] = []
    for q_name in trees_payload["quantiles"]:
        model_path = booster_dir / f"booster_q{q_name}.txt"
        booster = lgb.Booster(model_file=str(model_path))
        feature_cols = booster.feature_name()
        # Predict from the original sample (LightGBM accepts category dtype or codes)
        y_pred = booster.predict(sample[feature_cols])
        for i, row_pred in enumerate(y_pred):
            # Use numeric-coded version for JS fixture
            row = sample_numeric.iloc[i]
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
