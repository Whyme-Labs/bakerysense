"""scripts/seed_demo_bundle.py — export favorita tenant's tree + features JSON.

Usage:
    python scripts/seed_demo_bundle.py --tenant-id tnt_xxx

After running, upload:
    wrangler r2 object put bakerysense-models/tenant:<tid>/trees/latest.json \\
        --file bakerysense-web/build-bundle/trees.json
    wrangler r2 object put bakerysense-models/tenant:<tid>/features/latest.json \\
        --file bakerysense-web/build-bundle/features.json

(Replace `bakerysense-models` with `bakerysense-models-dev` for the dev bucket.)
"""
import argparse
import subprocess
import sys
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Export favorita tenant tree + features JSON ready for R2 upload."
    )
    ap.add_argument(
        "--tenant-id",
        required=True,
        help="Target tenant id (from seed-demo response, e.g. tnt_xxx)",
    )
    ap.add_argument(
        "--bucket",
        default="bakerysense-models",
        help="R2 bucket name (default: bakerysense-models; use bakerysense-models-dev for dev)",
    )
    args = ap.parse_args()

    repo = Path(__file__).resolve().parent.parent
    bundle_dir = repo / "bakerysense-web" / "build-bundle"
    trees = bundle_dir / "trees.json"
    features = bundle_dir / "features.json"

    # Delegate to the existing builder which handles model training + export.
    print("Running build_web_bundle.py to produce trees.json + features.json...")
    r = subprocess.run(
        [sys.executable, str(repo / "scripts" / "build_web_bundle.py"), "--tenant", "favorita"],
        cwd=repo,
    )
    if r.returncode != 0:
        sys.exit(r.returncode)

    if not trees.exists() or not features.exists():
        sys.exit(
            f"Expected {trees} and {features} to exist after build; they don't.\n"
            "Ensure the training pipeline has been run first (train_baseline.py)."
        )

    print()
    print("Upload these files to R2:")
    print(
        f"  wrangler r2 object put {args.bucket}/tenant:{args.tenant_id}/trees/latest.json \\"
    )
    print(f"      --file {trees}")
    print(
        f"  wrangler r2 object put {args.bucket}/tenant:{args.tenant_id}/features/latest.json \\"
    )
    print(f"      --file {features}")


if __name__ == "__main__":
    main()
