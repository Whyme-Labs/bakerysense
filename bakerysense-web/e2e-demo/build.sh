#!/usr/bin/env bash
# One-shot demo build: record live app → compose → render → publish to docs.
# Run from bakerysense-web/.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEMO="$ROOT/e2e-demo"
OUT="$DEMO/output/demo-full.mp4"
PUBLISHED="$ROOT/../docs/demo/demo-final.mp4"

cd "$ROOT"
echo "[1/4] Recording live app via Playwright..."
npx tsx e2e-demo/record.ts

echo "[2/4] Composing session.webm into Remotion public dir..."
npx tsx e2e-demo/compose.ts

echo "[3/4] Rendering Remotion composition..."
cd "$DEMO/video"
npm run render

echo "[4/4] Publishing to $PUBLISHED..."
mkdir -p "$(dirname "$PUBLISHED")"
cp "$OUT" "$PUBLISHED"

ls -lh "$OUT" "$PUBLISHED"
echo "Done."
