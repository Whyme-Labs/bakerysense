# Voiceover pipeline

Generates per-section TTS audio with **[Qwen3-TTS-12Hz-1.7B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)** running locally, then mounts each clip into the Remotion composition aligned to its scenario.

No API key, no cloud calls after the first model download.

## Files

| File | Purpose |
|---|---|
| `script.json` | Per-section text, voice, speaker, scenario anchor, voice instruction. Edit text here. |
| `generate.py` | Loads the local model, writes per-section `.wav` to `out/`, emits `out/manifest.json`. |
| `generate.ts` | Cloud fallback that calls DashScope `qwen-tts-flash` (paid). Use if local generation isn't an option. |
| `out/<section_id>.wav` | Generated audio (gitignored). |
| `out/manifest.json` | Audio durations; picked up by `compose.ts` to copy into `video/public/voiceover/`. |

## Generate (local)

```bash
# One-time: install the qwen-tts package + model weights cache.
pip install -U qwen-tts soundfile

# Run from bakerysense-web/. First call downloads ~3.4 GB of model weights
# to ~/.cache/huggingface/hub/; subsequent calls re-use the cache.
python3 e2e-demo/voiceover/generate.py
```

The script picks the best available device automatically: **CUDA + FlashAttention 2** if present, else **Apple Silicon MPS** in `float16`, else **CPU** in `float32`. On an M-series Mac the full 12-section script renders in roughly 60–90s.

## Generate (cloud fallback)

```bash
DASHSCOPE_API_KEY=sk-... npx tsx e2e-demo/voiceover/generate.ts
```

Get a key at <https://dashscope.console.aliyun.com/>. `qwen-tts-flash` is ≈¥0.40 per 1M characters — the full demo script (~1.3K chars) is effectively free.

## Voices

`Qwen3-TTS-12Hz-1.7B-CustomVoice` ships nine speakers; the two English-tuned ones are used here:

| Voice | Tone | Used for |
|---|---|---|
| **Aiden** | Sunny American male, clear midrange | Technical VO (sections B–H, J) |
| **Ryan** | Dynamic male, strong rhythmic drive | Bakery owner sync-sound (sections A, I, K) |
| Vivian / Serena | Bright / warm Chinese female | available |
| Uncle_Fu / Dylan / Eric | Mellow, Beijing, Chengdu Chinese male | available |
| Ono_Anna | Playful Japanese female | available |
| Sohee | Warm Korean female | available |

The DashScope fallback uses different presets — `Cherry`, `Ethan`, `Chelsie`, `Serena`. Edit `script.json` accordingly if switching paths.

## Re-rendering with audio

After running the generator, re-run the demo build to publish a new video that includes the voiceover:

```bash
bash bakerysense-web/e2e-demo/build.sh
```

`compose.ts` copies `out/*.wav` + `manifest.json` into `video/public/voiceover/`. `TestVideo.tsx` reads the manifest and adds an `<Audio>` per scenario via the `scenario_anchor` field.

If the manifest is empty (no audio generated yet), the renderer falls back to a silent video — no behavioural change versus the pre-voiceover pipeline.
