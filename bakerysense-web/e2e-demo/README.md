# e2e-demo — demo video + capture pipeline

Produces the UCWS demo video `docs/demo/harness-story.mp4` and the product
screenshots used in the pitch deck / submission.

Not to be confused with [`../e2e/`](../e2e/README.md), the Playwright test
suite run in CI.

## Pieces

| File | Purpose |
|------|---------|
| `video/src/HarnessStory.tsx` | The Remotion composition — a dynamic, frame-driven motion-graphic spine (cold-open → self-evolving loop → live `/harness` reveal → WAPE count-down + diff → branch divergence → approval → thesis) that weaves in real product screenshots + VoxCPM2 voiceover. |
| `video/src/Root.tsx` | Registers the `HarnessStory` composition. |
| `capture-harness.ts` | Playwright: signs into the live demo tenant and screenshots `/harness` (full + each proposal card) into `video/public/captures/`. |
| `capture-submission.ts` | Playwright: captures the dashboard bake plan, harness page, and model/lineage into `docs/submission/screenshots/`. |
| `voiceover/harness-script.json` | Scene-anchored narration text. |
| `voiceover/generate_voxcpm.py` | Generates narration with VoxCPM2 → `video/public/vo-harness/*.wav` + `manifest.json`. |

## Rebuild the video

```bash
cd bakerysense-web/e2e-demo

# 1. (optional) refresh product captures from the live app
npx tsx capture-harness.ts

# 2. (optional) regenerate voiceover (downloads VoxCPM2 weights on first run)
pip install voxcpm soundfile
python3 voiceover/generate_voxcpm.py

# 3. render
cd video
npm install            # first run only
npx remotion render src/index.ts HarnessStory ../output/harness-story.mp4 --crf=23

# 4. publish
cp ../output/harness-story.mp4 ../../../docs/demo/harness-story.mp4
```

Preview interactively with `npx remotion studio src/index.ts` from `video/`.

All animation is frame-driven (`useCurrentFrame` / `interpolate` / `spring`) —
no CSS transitions, which don't render in Remotion.
