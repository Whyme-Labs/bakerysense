"""Build the Worker's feature + model bundle and (optionally) upload to R2.

Usage:
    python scripts/build_web_bundle.py --tenant favorita
    python scripts/build_web_bundle.py --tenant favorita --upload

Outputs bakerysense-web/build-bundle/{trees,features}.json ready to push to
R2 at tenant:<tenant>/trees/latest.json and tenant:<tenant>/features/latest.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import pandas as pd

from bakerysense.forecaster.export_trees import export_all


def build_features_json(features_parquet: Path, out_json: Path) -> None:
    df = pd.read_parquet(features_parquet)
    last_date = df["date"].max().date().isoformat()
    payload = {"last_date": last_date, "per_branch_family_date": {}}

    # Accept either (branch_id, family) or (sku) naming; the training pipeline's
    # feature frame uses `sku`.  We synthesize a default branch_id for single-branch
    # data, and rename `sku` -> `family` for the Worker's JSON schema.
    name_col = "family" if "family" in df.columns else "sku"
    branch_col = "branch_id" if "branch_id" in df.columns else None

    feature_cols = [
        c for c in df.columns
        if c not in ("branch_id", "family", "sku", "date")
    ]

    for _, row in df.iterrows():
        b = row[branch_col] if branch_col else "brn_default"
        key = f"{b}|{row[name_col]}|{row['date'].date().isoformat()}"
        payload["per_branch_family_date"][key] = {
            c: float(row[c]) for c in feature_cols if pd.notna(row[c])
        }

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload))
    print(f"  features: {out_json} ({out_json.stat().st_size:,} bytes, "
          f"{len(payload['per_branch_family_date']):,} rows)")


def upload_to_r2(trees: Path, features: Path, tenant: str, bucket: str) -> None:
    """Invoke wrangler r2 object put for each artefact."""
    from_dir = Path("bakerysense-web")

    def put(local: Path, key: str) -> None:
        cmd = [
            "npx", "wrangler", "r2", "object", "put",
            f"{bucket}/{key}",
            f"--file={local.resolve()}",
        ]
        print("  $", " ".join(cmd))
        subprocess.run(cmd, check=True, cwd=from_dir)

    put(trees,    f"tenant:{tenant}/trees/latest.json")
    put(features, f"tenant:{tenant}/features/latest.json")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--tenant", default="favorita",
                   help="tenant identifier used as the R2 prefix")
    p.add_argument("--models-dir", type=Path, default=Path("models/gbm"),
                   help="directory containing booster_q*.txt files")
    p.add_argument("--features-parquet", type=Path,
                   default=Path("data/processed/features.parquet"),
                   help="feature snapshot emitted by the training pipeline")
    p.add_argument("--out-dir", type=Path,
                   default=Path("bakerysense-web/build-bundle"),
                   help="local output directory for the generated JSON files")
    p.add_argument("--bucket", default="bakerysense-models-dev",
                   help="R2 bucket name to upload into (when --upload)")
    p.add_argument("--upload", action="store_true",
                   help="also upload via wrangler r2 object put")
    args = p.parse_args()

    if not args.models_dir.exists():
        raise SystemExit(f"models dir not found: {args.models_dir}")
    if not args.features_parquet.exists():
        raise SystemExit(f"features parquet not found: {args.features_parquet}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    trees_out = args.out_dir / "trees.json"
    features_out = args.out_dir / "features.json"

    print(f"building web bundle for tenant {args.tenant!r}")
    print(f"  models dir:      {args.models_dir}")
    print(f"  features parquet: {args.features_parquet}")

    export_all(args.models_dir, trees_out)
    print(f"  trees: {trees_out} ({trees_out.stat().st_size:,} bytes)")
    build_features_json(args.features_parquet, features_out)

    if args.upload:
        print(f"uploading to R2 bucket {args.bucket!r}")
        upload_to_r2(trees_out, features_out, args.tenant, args.bucket)
        print("upload complete")
    else:
        print("dry-run (no --upload); artefacts written locally only")


if __name__ == "__main__":
    main()
