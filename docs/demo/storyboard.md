# BakerySense — Demo Storyboard

Target runtime: ~2:18. Eight E2E screen-capture shots wrapped by three B-roll bookends (cold open, mid-cut display case, close). Captures at 1440×900 — the rendered video upscales naturally.

The actual playback artifact is `docs/demo/demo-final.mp4`. The Remotion composition lives at `bakerysense-web/e2e-demo/video/src/TestVideo.tsx`. On-screen captions are sourced from `bakerysense-web/e2e-demo/captions.json`; spoken VO is in `script.md`.

---

## Shot list

### Shot 0 — Cold open (~0:00–0:10) · B-roll

| Field | Detail |
|---|---|
| Camera | `docs/demo/broll/shot1-cold-open.mp4` — handheld, owner behind counter, morning light. |
| On-screen | No app UI. Bakery owner faces camera. |
| Owner line | "Yesterday I threw out 40 croissants. I needed something that would just tell me how many to bake." |

---

### Shot 1 — Landing & sign-in (~0:13–0:26) · scenario `landing`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/`, then `/signin`. |
| On-screen action | Landing page. Click *Sign in*. Fill `favorita`, `demo@bakerysense.app`, password. Submit. Redirect to dashboard with no branch selected yet. |
| VO | Sections C of `script.md`. |
| Caption (auto) | "BakerySense — AI production copilot for retail chains." → "Submit sign-in." |
| Data-testid anchors | `signin-slug`, `signin-email`, `signin-password`, `signin-submit`, `branch-selector`. |

---

### Shot 2 — Data BakerySense loaded (~0:26–0:36) · scenario `data-preview`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/t/favorita/admin/data`. |
| On-screen action | Click *Admin* in the top nav, then *Data* in the admin sub-nav. The 4-tile summary appears (sales rows, SKUs covered, branches, date range), followed by a 30-day daily-totals sparkline and a recent-rows preview table. |
| VO | Section D of `script.md`. |
| Caption (auto) | "Admin — connectors, data, model, and audit." → "Per SKU per branch per day. Honest tabular data, no black box." |
| Data-testid anchors | `nav-admin`, `admin-nav-data`, `data-summary`, `data-preview-table`. |

---

### Shot 3 — Predictor & model page (~0:36–0:46) · scenario `model-info`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/t/favorita/admin/retraining` (sub-nav label is **Model**). |
| On-screen action | Click the *Model* tab. The `ModelInfoPanel` shows the predictor type ("LightGBM gradient-boosted trees · 7 quantile heads"), quantile-head badges, last-trained timestamp, training-data summary, and 13 plain-language feature chips. Below the panel: retrain history and the *Retrain now* button. |
| VO | Section E of `script.md`. |
| Caption (auto) | "LightGBM gradient-boosted trees — 7 quantile heads…" → "Retrain on the latest actuals; hot-swapped via a KV pointer with no downtime." |
| Data-testid anchors | `admin-nav-retraining`, `model-info-panel`, `trigger-retrain-button`. |

---

### Shot 4 — Dashboard bake plan + branch swap (~0:46–0:56) · scenario `dashboard`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/t/favorita/dashboard?branch=…`. |
| On-screen action | Click back to *Dashboard*. The custom branch picker (`branch-selector` button + listbox menu) is opened, *Quito Centro* selected. Bake plan loads. Picker is reopened, *Guayaquil Urdesa* selected — same model, different quantities. |
| VO | Section F of `script.md`. |
| Caption (auto) | "Today's bake plan…" → "Guayaquil Urdesa — different demand shape entirely." |
| Data-testid anchors | `nav-dashboard`, `branch-selector`, `branch-selector-menu`, `row-sku-…`. |

---

### Shot 5 — SKU detail (~0:56–1:02) · scenario `sku-detail`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/t/favorita/sku/TRADITIONAL%20BAGUETTE?branch=…`. |
| On-screen action | Click into *TRADITIONAL BAGUETTE*. The page reveals: collapsible *How to read this page* primer; four stat tiles (Recommended bake, Median demand, Band width, Forecast accuracy) each with a plain-language hint and an "i" tooltip; a tall gradient quantile band with "unlikely / most likely" inline labels and a dashed bake reference line; a friendly DriverBars chart with centered axis ("Pulls down ← → Pulls up") and plain-language feature labels ("Last week, same day", "Past-week average", …). |
| VO | Section G of `script.md`. |
| Caption (auto) | "Quantile band shows where demand is likely to land; drivers explain why." |
| Data-testid anchors | `row-sku-TRADITIONAL BAGUETTE` (anchor link), `ask-gemma-why` (visible button in top-right). |

---

### Shot 6 — Ask Gemma 4 (~1:02–1:54) · scenario `chat`

| Field | Detail |
|---|---|
| Camera | Screen capture. URL: `/t/favorita/chat?branch=…&prefill=…`. |
| On-screen action | Click *Ask Gemma why →*. Prefilled question lands as a user bubble. A friendly tool trace block appears: chips for `forecast_point` (Bake / Median / Low / High) and a horizontal-bar chart for `explain_drivers`. A `turn-status` indicator shows Gemma planning. After ~30–50s, the assistant message streams in token by token. |
| VO | Section H of `script.md`. Pace the VO; let the trace appear and the answer stream in. |
| Caption (auto) | "Ask Gemma why" → "Gemma plans tool calls" → "Gemma grounds answer in tool results." |
| Data-testid anchors | `ask-gemma-why`, `message-bubble-user`, `turn-status`, `message-bubble-assistant`. |

---

### Shot 7 — Display case (~1:54–2:03) · B-roll + scenario `display-case`

| Field | Detail |
|---|---|
| Camera | `docs/demo/broll/shot7b-display-case.mp4` cuts in over the navigation. Owner holds phone over half-empty tray. |
| On-screen action | Click *Display case* in nav. The photo-upload surface is visible. The video does not actually upload a photo — the surface itself is the demo beat. |
| Owner / VO | Section I of `script.md`: owner sync-sound line + a brief VO over the upload surface. |
| Caption (auto) | "Take one photo of the shelf — Gemma vision counts units, suggests markdowns." |
| Data-testid anchors | `nav-display-case`, `photo-upload-input`. |

---

### Shot 8 — Sign out (~2:03–2:08) · scenario `signout`

| Field | Detail |
|---|---|
| Camera | Screen capture. Returns to dashboard, then signs out. |
| On-screen action | Click *Dashboard* in nav (returns to bake plan briefly), then click the user menu's *Sign out* item. Redirect to `/signin`. |
| VO | Section J of `script.md`. |
| Caption (auto) | "Session signed out." → "Refresh-token tombstones + JWKS rotation on the next line." |
| Data-testid anchors | `nav-dashboard`, `user-menu-signout`, `signin-slug` (post-redirect). |

---

### Shot 9 — Close (~2:08–2:18) · B-roll

| Field | Detail |
|---|---|
| Camera | `docs/demo/broll/shot9-close.mp4`. Owner at counter, warm light. |
| On-screen action | No app UI. |
| Owner line | "By month two, the model knows my bakery better than I do." |

---

## Production notes

- **Resolution:** screen captures are 1440×900 (Playwright viewport). The Remotion composition is also 1440×900 and renders at 30fps. The published artifact at `docs/demo/demo-final.mp4` is the canonical output (~9.7 MB at CRF 28).
- **B-roll:** three AI-generated clips at `docs/demo/broll/*.mp4` — `shot1-cold-open.mp4` (10s), `shot7b-display-case.mp4` (5s), `shot9-close.mp4` (10s). The Remotion composition embeds these directly via `<OffthreadVideo>` — there is no ffmpeg post-stitch step.
- **Captions:** auto-rendered by Remotion from `bakerysense-web/e2e-demo/captions.json`. They appear at the bottom of the frame, distinct from the spoken VO.
- **VO recording:** see `script.md` for line-by-line copy. For TTS narration use a calm, grounded voice (e.g. Qwen TTS's `Cherry` or `Ethan`); duck the captions' visual prominence is unaffected because captions are visual, not audio.
- **Screen tempo:** the `chat` scenario is the long pole because Gemma is actually planning tool calls and streaming a grounded answer. Don't speed it up — the latency is part of the proof.
- **Re-recording:** `bash bakerysense-web/e2e-demo/build.sh` re-runs the full pipeline (record → compose → render → publish to `docs/demo/demo-final.mp4`).
- **Demo seed:** seeded `favorita` tenant via `POST /api/admin/seed-demo` (HMAC-signed). Credentials: `demo@bakerysense.app / Demo2026DemoDemo`. Verify the branch selector shows all 5 branches before recording.
