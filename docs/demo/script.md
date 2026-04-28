# BakerySense — Demo Script

Aligned to `storyboard.md` and the actual rendered video at `docs/demo/demo-final.mp4` (~108s of screen capture wrapped by ~25s of B-roll = ~2:13 total). Captions on-screen are in `bakerysense-web/e2e-demo/captions.json`; the lines below are spoken VO that complements (not duplicates) those captions.

Single speaker model:
- `[VO]` — third-person narration in `Aiden`'s voice (Qwen3-TTS-CustomVoice). Played over both screen captures and B-roll. The B-roll is mood footage — no faces, no lip-sync expectation.

Pauses marked `[BEAT]`. Timecodes are approximate — the screen capture's tempo is fixed by the recording, so trim VO to fit, do not stretch the visuals.

---

## Section A — Cold open (B-roll, ~0:00–0:10)

| Time | Speaker | Line |
|---|---|---|
| 0:00–0:10 | **[VO]** | "Independent bakeries throw out 30 to 40 percent of what they make. The waste is uncertainty, not ignorance." |

## Section B — Brand intro (~0:10–0:13)

| Time | Speaker | Line |
|---|---|---|
| 0:10–0:13 | **[VO]** | "BakerySense — an offline-first decision copilot, powered by Gemma 4." |

## Section C — Landing & sign-in (scenario 1, ~0:13–0:26)

| Time | Speaker | Line |
|---|---|---|
| 0:13–0:18 | **[VO]** | "Sign in with the bakery's tenant slug, email, and password." |
| 0:18–0:26 | **[VO]** | "We use ES256 JWT and Argon2id — but that's plumbing. The interesting part is what comes next." |

## Section D — Data BakerySense loaded (scenario 2, ~0:26–0:36)

| Time | Speaker | Line |
|---|---|---|
| 0:26–0:33 | **[VO]** | "Here's the sales history we loaded — per SKU, per branch, per day. The forecaster trains on this." |
| 0:33–0:36 | **[VO]** | "No black box; the operator can see exactly what the model has seen." |

## Section E — Predictor & model page (scenario 3, ~0:36–0:46)

| Time | Speaker | Line |
|---|---|---|
| 0:36–0:42 | **[VO]** | "The predictor itself: LightGBM gradient-boosted trees, seven quantile heads, thirteen plain-language features." |
| 0:42–0:46 | **[VO]** | "It runs in pure TypeScript inside a Cloudflare Worker — no Python at request time. Retrain on actuals, hot-swapped via a KV pointer." |

## Section F — Dashboard bake plan (scenario 4, ~0:46–0:56)

| Time | Speaker | Line |
|---|---|---|
| 0:46–0:51 | **[VO]** | "Today's bake plan. Each row is a SKU; the quantity is newsvendor-picked from the quantile forecast." |
| 0:51–0:56 | **[VO]** | "Switch branches — same model, completely different demand shape. The numbers come from the data, not from intuition." |

## Section G — SKU detail (scenario 5, ~0:56–1:02)

| Time | Speaker | Line |
|---|---|---|
| 0:56–1:02 | **[VO]** | "Open a SKU. The quantile band shows where demand is likely to land; the driver bars show why." |

## Section H — Ask Gemma 4 (scenario 6, ~1:02–1:54)

This is the longest single section — Gemma takes time to plan tool calls and stream a grounded answer. Pace the VO; don't rush.

| Time | Speaker | Line |
|---|---|---|
| 1:02–1:08 | **[VO]** | "Click *Ask Gemma why*. The question is prefilled and sent to Gemma 4." |
| 1:08–1:15 | **[BEAT]** | *(Gemma plans tool calls — friendly trace appears: chips for forecast, bars for explain.)* |
| 1:15–1:25 | **[VO]** | "It calls the forecaster, reads the SHAP-style drivers, and grounds its answer in the numbers." |
| 1:25–1:54 | **[BEAT]** | *(Streaming answer fills in token by token — let it breathe.)* |

## Section I — Display case (B-roll + scenario 7, ~1:54–2:03)

| Time | Speaker | Line |
|---|---|---|
| 1:54–2:00 | **[VO]** | "At end of day, one photo is enough. Gemma 4 counts what is left." |
| 2:00–2:03 | **[VO]** | "Gemma 4 counts the display case and suggests markdowns." |

## Section J — Sign out (scenario 8, ~2:03–2:08)

| Time | Speaker | Line |
|---|---|---|
| 2:03–2:08 | **[VO]** | "Sign out. Refresh-token tombstones and JWKS rotation handle the rest." |

## Section K — Close (B-roll, ~2:08–2:18)

| Time | Speaker | Line |
|---|---|---|
| 2:08–2:18 | **[VO]** | "Within two months, the model learns the bakery better than the baker remembers it. Validated against nine forecasting benchmarks — the architecture transfers across foundation models." |

---

## Word count

Spoken prose above (excluding stage directions and timecodes): approximately 290 words across ~2:18 of speech-bearing time. Comfortable for ~150 wpm. Beats absorb the rest.

## Production notes

- The owner's sync-sound lines (Sections A, I, K) carry the emotional weight; the VO sections (B–H, J) carry the technical narrative. Don't reverse them.
- Section H is the longest section because Gemma is genuinely thinking. Don't fill the silence with extra VO — let the streaming animation breathe. The viewer needs to *see* the tool trace appear and the answer stream in.
- "Gemma 4" appears in Sections B, E, H, I. Keep all of them — the LLM is the headline.
- "LightGBM" in Section E is a named thing, not jargon. Don't substitute "the demand model"; the named term lands harder.
- Trim VO to fit, never stretch. The screen capture tempo is fixed by the recording.
- For TTS narration: any voice with a calm, grounded delivery (not broadcast-energetic). Suggested model: `qwen-tts` (DashScope) or equivalent — see `e2e-demo/voiceover/README.md` if present.
