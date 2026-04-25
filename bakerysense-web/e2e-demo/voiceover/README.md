# Voiceover pipeline

Generates per-section TTS audio via [Qwen TTS](https://help.aliyun.com/zh/model-studio/qwen-tts) (`qwen-tts-flash` model on DashScope), then mounts each clip into the Remotion composition aligned to its scenario.

## Files

| File | Purpose |
|---|---|
| `script.json` | Per-section text, voice, speaker, and scenario anchor. Edit text here. |
| `generate.ts` | Calls DashScope, writes per-section `.mp3` to `out/`, emits `out/manifest.json`. |
| `out/<section_id>.mp3` | Generated audio (gitignored). |
| `out/manifest.json` | Audio durations, picked up by `compose.ts` to copy into the Remotion `public/voiceover/` dir. |

## Generate

```bash
cd bakerysense-web
DASHSCOPE_API_KEY=sk-... npx tsx e2e-demo/voiceover/generate.ts
```

Get a key at <https://dashscope.console.aliyun.com/>. The international endpoint is hard-coded in `generate.ts`; CN-region accounts can swap to `https://dashscope.aliyuncs.com`.

## Voices

`qwen-tts-flash` ships four bilingual voices:

| Voice | Tone | Used for |
|---|---|---|
| `Cherry` | warm, mid-pitch female | bakery owner sync-sound lines (sections A, I, K) |
| `Ethan` | calm, grounded male | technical VO (sections B–H, J) |
| `Chelsie` | bright, high-pitch female | — |
| `Serena` | mature, low-pitch female | — |

## Cost

`qwen-tts-flash` is ~¥0.40 per 1M characters. The full demo script is ≈1.3K characters → effectively free per render.

## Re-rendering with audio

After running `generate.ts`, re-run the demo build to publish a new video that includes the voiceover:

```bash
bash bakerysense-web/e2e-demo/build.sh
```

`compose.ts` copies `out/*.mp3` + `manifest.json` into `video/public/voiceover/`; `TestVideo.tsx` reads the manifest and adds an `<Audio>` per scenario via the `scenario_anchor` field.
