"""scripts/retrain_tenant.py — retrain a single tenant and publish new weights.

Flow:
1. Operator clicks "Trigger retrain" in the web UI → Worker enqueues a
   retrain job → consumer builds a training CSV at
   r2://bakerysense-models/tenant:<tid>/training-inputs/<timestamp>.csv
2. Operator downloads that CSV locally (via `wrangler r2 object get` or rclone).
   Example::

       wrangler r2 object get bakerysense-models/tenant:tnt_favorita/training-inputs/<ts>.csv \\
           --file ./downloads/training-inputs.csv

3. Operator runs this script pointing at the CSV.
4. Script retrains LightGBM quantiles, exports trees + features JSON, and
   either prints next-step R2 commands (--no-publish) or POSTs to the
   Worker's /api/internal/publish-model endpoint (--publish).

NOTE on R2 upload (out of scope for this script):
   After the script writes trees.json and features.json to --output-dir,
   upload them to R2 manually before calling --publish:

       wrangler r2 object put bakerysense-models/tenant:<tid>/v<N>/trees/latest.json \\
           --file <output-dir>/trees.json
       wrangler r2 object put bakerysense-models/tenant:<tid>/v<N>/features/latest.json \\
           --file <output-dir>/features.json

   Or use rclone::

       rclone copy <output-dir>/trees.json r2:bakerysense-models/tenant:<tid>/v<N>/trees/latest.json

   The script prints the exact commands at the end.

Usage:
    python scripts/retrain_tenant.py \\
        --tenant tnt_favorita \\
        --training-csv ./downloads/training-inputs.csv \\
        --output-dir ./tmp/retrain/tnt_favorita \\
        --new-version 2 \\
        --publish \\
        --api-url https://bakerysense.example.com \\
        --ops-secret $OPS_ROTATE_SECRET

Dry-run (no network calls):
    python scripts/retrain_tenant.py \\
        --tenant tnt_favorita \\
        --training-csv ./input.csv \\
        --output-dir ./tmp \\
        --new-version 2 \\
        --no-publish

Dependencies (pip install):
    lightgbm pandas numpy requests
    (requests is NOT in pyproject.toml core deps; add it or install separately)
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests

# Allow running from the repo root without installing the package
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "src"))

from bakerysense.features import build_features, drop_warmup, feature_columns  # noqa: E402
from bakerysense.forecaster.export_trees import export_all  # noqa: E402
from bakerysense.forecaster.gbm import DEFAULT_PARAMS, DEFAULT_QUANTILES, QuantileGBM  # noqa: E402

# How many tail days to hold out for rolling-MAE evaluation.
EVAL_DAYS = 14
# R2 bucket name where model artefacts live.
R2_BUCKET = "bakerysense-models"


# ---------------------------------------------------------------------------
# HMAC helpers (mirror of the TypeScript implementation in publish-model route)
# ---------------------------------------------------------------------------

def canonicalize(o: Any) -> str:
    """Produce a deterministic JSON string with recursively sorted object keys."""
    if o is None or not isinstance(o, (dict, list)):
        return json.dumps(o, separators=(",", ":"))
    if isinstance(o, list):
        return "[" + ",".join(canonicalize(x) for x in o) + "]"
    keys = sorted(o.keys())
    return "{" + ",".join(json.dumps(k) + ":" + canonicalize(o[k]) for k in keys) + "}"


def sign(body: dict, secret: str) -> str:
    """Return a hex HMAC-SHA256 digest of the canonical JSON body."""
    canonical = canonicalize(body).encode()
    return hmac.new(secret.encode(), canonical, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Training CSV loader
# ---------------------------------------------------------------------------

def load_training_csv(path: Path) -> pd.DataFrame:
    """Load and normalise a training CSV produced by the Worker's retrain queue.

    Expected columns: branch_id, family, date, actual_sales, actual_bake,
    waste_units, predicted, q50.

    Renamed for feature engineering:
      actual_sales → units_sold   (TARGET in features.py)
      family       → sku          (GROUP  in features.py)
    """
    if not path.exists():
        raise SystemExit(
            f"Training CSV not found: {path}\n\n"
            "To obtain it:\n"
            "  1. Click 'Trigger retrain' in the BakerySense web UI.\n"
            "  2. Wait for the Worker queue consumer to build the CSV.\n"
            "  3. Download from R2:\n"
            "       wrangler r2 object get bakerysense-models/"
            "tenant:<tid>/training-inputs/<timestamp>.csv \\\n"
            "           --file ./downloads/training-inputs.csv\n"
        )

    df = pd.read_csv(path)
    required = {"branch_id", "family", "date", "actual_sales"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(
            f"Training CSV is missing required columns: {missing}\n"
            f"Found columns: {list(df.columns)}"
        )

    df = df.rename(columns={"actual_sales": "units_sold", "family": "sku"})
    df["date"] = pd.to_datetime(df["date"])
    print(f"  loaded {len(df):,} rows from {path}")
    print(f"  date range: {df['date'].min().date()} → {df['date'].max().date()}")
    print(f"  SKUs: {df['sku'].nunique()}  branches: {df['branch_id'].nunique()}")
    return df


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_tenant_models(
    df: pd.DataFrame,
) -> tuple[QuantileGBM, pd.DataFrame, dict[str, float]]:
    """Engineer features, train all quantile models, evaluate on last 14 days.

    Training strategy: one global per-tenant model over all branches.
    The branch_id column is dropped before feature engineering so the model
    learns cross-branch patterns; the sku column provides item-level identity.

    Returns
    -------
    model : fitted QuantileGBM
    feats : full feature DataFrame (needed for features.json snapshot)
    metrics : {"mae_q50": float, "eval_rows": int}
    """
    # Drop branch_id — train a single per-tenant model across branches.
    # If per-branch models are needed in the future, loop here.
    df_model = df[["date", "sku", "units_sold"]].copy()

    # Pass through optional weather / exogenous columns if present
    extra_cols = [
        c for c in df.columns
        if c not in ("branch_id", "date", "sku", "units_sold",
                     "actual_bake", "waste_units", "predicted", "q50")
    ]
    if extra_cols:
        df_model = pd.concat([df_model, df[extra_cols]], axis=1)

    feats = build_features(df_model)
    feats = drop_warmup(feats)

    if len(feats) == 0:
        raise SystemExit(
            "Feature engineering produced zero rows after drop_warmup. "
            "The training CSV likely covers fewer than 28 days — need more history."
        )

    # Temporal split: last EVAL_DAYS held out for evaluation only.
    cutoff = feats["date"].max() - pd.Timedelta(days=EVAL_DAYS - 1)
    train_df = feats[feats["date"] < cutoff].copy()
    eval_df = feats[feats["date"] >= cutoff].copy()

    if len(train_df) == 0:
        raise SystemExit(
            f"Not enough data: all {len(feats)} rows fall within the "
            f"{EVAL_DAYS}-day eval window. Need more historical data."
        )

    print(f"  train rows: {len(train_df):,}  eval rows: {len(eval_df):,}")

    fcols = feature_columns(feats)
    print(f"  feature count: {len(fcols)}")

    model = QuantileGBM(
        quantiles=DEFAULT_QUANTILES,
        params=dict(DEFAULT_PARAMS),
    )
    print("  fitting quantile boosters …")
    model.fit(train_df, feature_names=fcols)
    print("  training complete")

    # Rolling MAE on eval set (q=0.5 as proxy for point forecast quality)
    metrics: dict[str, float] = {"eval_rows": len(eval_df)}
    if len(eval_df) > 0:
        preds_q50 = model.predict(eval_df, quantile=0.5)
        mae = float(abs(eval_df["units_sold"].to_numpy() - preds_q50).mean())
        metrics["mae_q50"] = round(mae, 4)
        print(f"  rolling MAE (q=0.5, last {EVAL_DAYS} days): {mae:.4f}")
    else:
        print(f"  (no eval rows — skipping MAE)")

    return model, feats, metrics


# ---------------------------------------------------------------------------
# Features JSON builder  (mirrors build_web_bundle.py::build_features_json)
# ---------------------------------------------------------------------------

def build_features_json(feats: pd.DataFrame) -> dict:
    """Serialise the feature snapshot in the Worker's expected JSON schema.

    Schema::

        {
          "last_date": "YYYY-MM-DD",
          "per_branch_family_date": {
            "<branch_id>|<sku>|<date>": { "<col>": <float>, ... }
          }
        }

    Since the per-tenant model does not carry branch_id, we emit a synthetic
    branch key "brn_default".  The Worker matches on (branch, family, date);
    callers should align on this key when doing inference.
    """
    last_date = feats["date"].max().date().isoformat()
    payload: dict[str, Any] = {
        "last_date": last_date,
        "per_branch_family_date": {},
    }

    feature_cols = [
        c for c in feats.columns
        if c not in ("branch_id", "sku", "date", "units_sold")
    ]

    for _, row in feats.iterrows():
        b = row["branch_id"] if "branch_id" in feats.columns else "brn_default"
        key = f"{b}|{row['sku']}|{row['date'].date().isoformat()}"
        payload["per_branch_family_date"][key] = {
            c: float(row[c]) for c in feature_cols if pd.notna(row[c])
        }

    return payload


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

def publish(api_url: str, body: dict, secret: str) -> None:
    """POST the signed publish-model body to the Worker API."""
    sig = sign(body, secret)
    url = f"{api_url.rstrip('/')}/api/internal/publish-model"
    print(f"  POST {url}")
    r = requests.post(url, json=body, headers={"x-ops-secret": sig}, timeout=30)
    if r.status_code >= 300:
        raise SystemExit(
            f"publish failed {r.status_code}: {r.text[:500]}"
        )
    print(f"  published: {r.json()}")


# ---------------------------------------------------------------------------
# R2 next-step helpers
# ---------------------------------------------------------------------------

def r2_keys(tenant: str, new_version: int) -> tuple[str, str]:
    trees_key = f"tenant:{tenant}/v{new_version}/trees/latest.json"
    features_key = f"tenant:{tenant}/v{new_version}/features/latest.json"
    return trees_key, features_key


def print_next_steps(
    out_dir: Path,
    tenant: str,
    new_version: int,
    publish_body: dict,
    sig: str,
) -> None:
    trees_key, features_key = r2_keys(tenant, new_version)
    trees_file = out_dir / "trees.json"
    features_file = out_dir / "features.json"

    print()
    print("=" * 72)
    print("NEXT STEPS — upload artefacts to R2, then publish")
    print("=" * 72)
    print()
    print("1. Upload trees JSON:")
    print(f"   wrangler r2 object put {R2_BUCKET}/{trees_key} \\")
    print(f"       --file {trees_file.resolve()}")
    print()
    print("2. Upload features JSON:")
    print(f"   wrangler r2 object put {R2_BUCKET}/{features_key} \\")
    print(f"       --file {features_file.resolve()}")
    print()
    print("3. Publish (if not using --publish flag):")
    print(f"   curl -X POST {'{api_url}'}/api/internal/publish-model \\")
    print(f"        -H 'Content-Type: application/json' \\")
    print(f"        -H 'x-ops-secret: {sig}' \\")
    print(f"        -d '{json.dumps(publish_body)}'")
    print()
    print("Dry-run publish body:")
    print(json.dumps(publish_body, indent=2))
    print()
    print(f"Dry-run HMAC signature: {sig}")
    print("=" * 72)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="retrain_tenant.py",
        description=(
            "Retrain a single tenant's LightGBM models from a locally downloaded "
            "training CSV and optionally publish the new version via the Worker API."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Example (dry-run):\n"
            "  python scripts/retrain_tenant.py \\\n"
            "      --tenant tnt_favorita \\\n"
            "      --training-csv ./downloads/training-inputs.csv \\\n"
            "      --output-dir ./tmp/retrain/tnt_favorita \\\n"
            "      --new-version 2 \\\n"
            "      --no-publish\n\n"
            "Example (live publish):\n"
            "  python scripts/retrain_tenant.py \\\n"
            "      --tenant tnt_favorita \\\n"
            "      --training-csv ./downloads/training-inputs.csv \\\n"
            "      --new-version 2 \\\n"
            "      --publish \\\n"
            "      --api-url https://bakerysense.example.com \\\n"
            "      --ops-secret $OPS_ROTATE_SECRET\n"
        ),
    )
    ap.add_argument(
        "--tenant",
        required=True,
        metavar="TID",
        help="Tenant identifier (e.g. tnt_favorita). Used as the R2 key prefix.",
    )
    ap.add_argument(
        "--training-csv",
        required=True,
        type=Path,
        metavar="PATH",
        help=(
            "Local path to the training-inputs CSV downloaded from R2. "
            "Obtain via: wrangler r2 object get bakerysense-models/"
            "tenant:<tid>/training-inputs/<timestamp>.csv --file ./input.csv"
        ),
    )
    ap.add_argument(
        "--output-dir",
        type=Path,
        metavar="DIR",
        help=(
            "Directory for trees.json and features.json output. "
            "Defaults to ./tmp/retrain/<tenant>."
        ),
    )
    ap.add_argument(
        "--api-url",
        default="http://localhost:8787",
        metavar="URL",
        help="Base URL of the Cloudflare Worker (default: http://localhost:8787).",
    )
    ap.add_argument(
        "--ops-secret",
        default=None,
        metavar="SECRET",
        help=(
            "OPS_ROTATE_SECRET used for HMAC signing. "
            "Defaults to the OPS_ROTATE_SECRET environment variable."
        ),
    )
    ap.add_argument(
        "--new-version",
        type=int,
        metavar="N",
        help=(
            "Monotonically increasing version integer for the new model "
            "(required when --publish is set; e.g. 2 if current active is v1)."
        ),
    )
    ap.add_argument(
        "--baseline-rolling-mae",
        type=float,
        default=None,
        metavar="FLOAT",
        help=(
            "Optional regression guard: if provided, the server may reject the "
            "new model if its MAE exceeds this baseline."
        ),
    )

    publish_group = ap.add_mutually_exclusive_group()
    publish_group.add_argument(
        "--publish",
        dest="publish",
        action="store_true",
        default=True,
        help="POST the publish-model request to the Worker API (default).",
    )
    publish_group.add_argument(
        "--no-publish",
        dest="publish",
        action="store_false",
        help="Dry-run: write JSON locally and print next-step commands without POSTing.",
    )

    return ap


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = build_arg_parser()
    args = ap.parse_args()

    tenant: str = args.tenant
    out_dir: Path = args.output_dir or Path("tmp") / "retrain" / tenant
    csv_path: Path = args.training_csv

    # Validate publish prerequisites
    if args.publish:
        if args.new_version is None:
            ap.error("--new-version is required when using --publish")
        ops_secret = args.ops_secret or os.environ.get("OPS_ROTATE_SECRET", "")
        if not ops_secret:
            ap.error(
                "--ops-secret or the OPS_ROTATE_SECRET environment variable is "
                "required when using --publish"
            )
    else:
        ops_secret = args.ops_secret or os.environ.get("OPS_ROTATE_SECRET", "dry-run-secret")
        if args.new_version is None:
            ap.error("--new-version is required (needed to compute R2 keys for the next-step output)")

    new_version: int = args.new_version

    print(f"\nBakerySense — retrain tenant {tenant!r}  (version → v{new_version})")
    print("=" * 72)

    # ------------------------------------------------------------------
    # 1. Load training CSV
    # ------------------------------------------------------------------
    print("\n[1/5] Loading training CSV …")
    df = load_training_csv(csv_path)

    # ------------------------------------------------------------------
    # 2. Train
    # ------------------------------------------------------------------
    print("\n[2/5] Engineering features and training LightGBM quantile models …")
    model, feats, metrics = train_tenant_models(df)

    # ------------------------------------------------------------------
    # 3. Export trees + features JSON
    # ------------------------------------------------------------------
    print("\n[3/5] Exporting trees and features JSON …")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Save LightGBM model files so export_all() can load them
    models_tmp = out_dir / "_boosters"
    model.save(models_tmp)

    trees_out = out_dir / "trees.json"
    export_all(models_tmp, trees_out)
    print(f"  trees:    {trees_out} ({trees_out.stat().st_size:,} bytes)")

    features_payload = build_features_json(feats)
    features_out = out_dir / "features.json"
    features_out.write_text(json.dumps(features_payload))
    print(
        f"  features: {features_out} ({features_out.stat().st_size:,} bytes, "
        f"{len(features_payload['per_branch_family_date']):,} rows)"
    )

    # ------------------------------------------------------------------
    # 4. Build publish body
    # ------------------------------------------------------------------
    print("\n[4/5] Building publish body …")
    trees_r2_key, features_r2_key = r2_keys(tenant, new_version)

    publish_body: dict[str, Any] = {
        "tenant": tenant,
        "version": new_version,
        "treesR2Key": trees_r2_key,
        "featuresR2Key": features_r2_key,
        "metrics": metrics,
        "trainedAt": int(time.time()),
    }
    if args.baseline_rolling_mae is not None:
        publish_body["baselineRollingMae"] = args.baseline_rolling_mae

    sig = sign(publish_body, ops_secret)
    print(f"  HMAC-SHA256 signature: {sig}")

    # ------------------------------------------------------------------
    # 5. Publish or dry-run
    # ------------------------------------------------------------------
    if args.publish:
        print(f"\n[5/5] Publishing to {args.api_url} …")
        publish(args.api_url, publish_body, ops_secret)
    else:
        print("\n[5/5] Dry-run — skipping POST")
        print_next_steps(out_dir, tenant, new_version, publish_body, sig)

    print("\nDone.")


if __name__ == "__main__":
    main()
