# BakerySense — 3-Minute Demo Storyboard

Target runtime: 3:00. 9 shots. Screen captures at 1920×1080 intercut with bakery B-roll.

---

## Shot list

### Shot 1 — Cold open (0:00–0:15)

| Field | Detail |
|---|---|
| **Time** | 0:00–0:15 |
| **Camera** | Bakery B-roll, hand-held, waist-up. Owner behind counter, early morning light, trays visible behind them. |
| **On-screen action** | No screen. Owner faces camera. Rack of croissants in background. |
| **Bakery owner's line** | "Yesterday I threw out 40 croissants. The day before, I ran out by noon. I needed something that would just tell me how many to bake." |
| **Data-testid anchors** | — (no UI) |

---

### Shot 2 — Landing page → sign-in (0:15–0:30)

| Field | Detail |
|---|---|
| **Time** | 0:15–0:30 |
| **Camera** | Screen capture. Browser at `https://bakerysense.app/` (landing page), then navigates to `/signin`. |
| **On-screen action** | Cursor clicks "Sign in". Signin form appears. User types tenant slug `favorita`, email `demo@bakerysense.app`, password. Clicks submit. Redirect to dashboard (no branch selected yet). |
| **Bakery owner's line** | *(voiceover — see script.md)* |
| **Data-testid anchors** | `data-testid="signin-slug"`, `data-testid="signin-email"`, `data-testid="signin-password"`, `data-testid="signin-submit"` |

---

### Shot 3 — Dashboard: bake plan + QualityBadge (0:30–0:48)

| Field | Detail |
|---|---|
| **Time** | 0:30–0:48 |
| **Camera** | Screen capture. URL: `/t/favorita/dashboard?branch=brn_quito_centro`. |
| **On-screen action** | BakePlanTable loads with 3 SKUs (TRADITIONAL BAGUETTE, CROISSANT, PAIN AU CHOCOLAT). Each row shows bake quantity. QualityBadge beside each SKU name shows WAPE percentage. Badge for TRADITIONAL BAGUETTE shows amber "25%" or green "18%". |
| **Bakery owner's line** | "This is my bake plan for tomorrow. That amber number — that's the forecast error. Green means I've given it enough history to trust it." |
| **Data-testid anchors** | `data-testid="row-sku-TRADITIONAL BAGUETTE"`, `data-testid="row-sku-CROISSANT"`, `data-testid="row-sku-PAIN AU CHOCOLAT"` |

---

### Shot 4 — Dashboard: branch selector swap (0:48–1:00)

| Field | Detail |
|---|---|
| **Time** | 0:48–1:00 |
| **Camera** | Screen capture. Same dashboard URL. |
| **On-screen action** | Cursor clicks `data-testid="branch-selector"` dropdown. Selects "Guayaquil Urdesa". Dashboard reloads with different bake quantities. Quantities for CROISSANT drop from 42 to 31. |
| **Bakery owner's line** | "Different branch, different numbers. Quito and Guayaquil don't behave the same on Sundays." |
| **Data-testid anchors** | `data-testid="branch-selector"`, `data-testid="row-sku-CROISSANT"` |

---

### Shot 5 — SKU detail: quantile chart + drivers (1:00–1:30)

| Field | Detail |
|---|---|
| **Time** | 1:00–1:30 |
| **Camera** | Screen capture. URL: `/t/favorita/sku/TRADITIONAL%20BAGUETTE?branch=brn_quito_centro`. |
| **On-screen action** | QuantileChart fills the upper panel — a fan of 7 quantile bands (q0.1 to q0.9) with the newsvendor bake quantity marked. DriverBars below show top SHAP contributors: `lag_7`, `rolling_mean_7`, `dow`. Cursor hovers over the q0.7 band. Then clicks "Ask Gemma why →" link in the top-right. |
| **Bakery owner's line** | "The chart shows me the range of possible demand. The bars show me why the model picked that number — lag 7 means last week's sales are the strongest signal. Then I click to ask it in plain language." |
| **Data-testid anchors** | *(QuantileChart and DriverBars have no testid; anchor on the link)* — `a[href*="/chat"][href*="prefill"]` |

---

### Shot 6 — Chat: SSE stream + tool-call answer (1:30–2:10)

| Field | Detail |
|---|---|
| **Time** | 1:30–2:10 |
| **Camera** | Screen capture. URL: `/t/favorita/chat?branch=brn_quito_centro&prefill=...`. |
| **On-screen action** | Prefilled question appears in the input: "Ask Gemma why TRADITIONAL BAGUETTE is forecast 135 for tomorrow." User clicks send. SSE stream begins — assistant message appears token by token. A tool-call indicator flashes briefly ("→ forecast"). Answer arrives: "Bake 135. The dominant driver is last Tuesday's sale of 141 units — lag_7 is pulling the forecast up. Rolling 7-day average agrees at 138." |
| **Bakery owner's line** | "It calls the forecaster, reads the SHAP values, and writes me a sentence I can actually use. That's Gemma 4 doing the talking — the numbers come from the model, not the language model." |
| **Data-testid anchors** | `data-testid="prompt-input"`, `data-testid="prompt-submit"`, `data-testid="message-bubble-assistant"` |

---

### Shot 7 — Display case: photo → counts → markdown suggestions (2:10–2:30)

| Field | Detail |
|---|---|
| **Time** | 2:10–2:30 |
| **Camera** | Screen capture. URL: `/t/favorita/display-case?branch=brn_quito_centro`. Cut in bakery B-roll (2 seconds): owner holds phone over display case, half-empty tray of croissants. Back to screen. |
| **On-screen action** | PhotoUpload component visible. Owner uploads the display-case photo. Spinner. CountsTable renders: CROISSANT 22, PAIN AU CHOCOLAT 14, TRADITIONAL BAGUETTE 7. MarkdownList appears below: CROISSANT −30%, PAIN AU CHOCOLAT −30%. |
| **Bakery owner's line** | "At 5pm I take one photo. It counts what's left. Then it tells me what to mark down and by how much." |
| **Data-testid anchors** | `data-testid="photo-upload-input"`, `data-testid="photo-upload-submit"`, `data-testid="counts-table"`, `data-testid="markdown-list"` |

---

### Shot 8 — Close out day + retrain history (2:30–2:50)

| Field | Detail |
|---|---|
| **Time** | 2:30–2:50 |
| **Camera** | Screen capture. Dashboard URL. CloseOutDayTrigger button visible. Then cut to admin retrain history panel. |
| **On-screen action** | Owner clicks "Close out day" button. Confirmation dialog. Confirms. Toast: "Actuals recorded." Cut to admin panel showing retrain log — two rows, each with a date and WAPE improvement: "2026-04-12 → WAPE 0.29", "2026-04-19 → WAPE 0.25". |
| **Bakery owner's line** | "Every day I close out, the actual sales go in. Once a week it retrains. That second row — that's after two weeks of my data. The error dropped four points." |
| **Data-testid anchors** | *(CloseOutDayDialog)* — `data-testid="close-out-confirm"` if present; admin retrain table rows |

---

### Shot 9 — Close (2:50–3:00)

| Field | Detail |
|---|---|
| **Time** | 2:50–3:00 |
| **Camera** | Bakery B-roll. Owner at counter, morning light. Warm, not performed. |
| **On-screen action** | No screen. Owner looks at camera. |
| **Bakery owner's line** | "By month two, the model knows my bakery better than I do. I just bake what it tells me." |
| **Data-testid anchors** | — (no UI) |

---

## Recording notes

- **Screen capture:** 1920×1080 px, 30fps. QuickTime (macOS) or OBS. Use the seeded `favorita` tenant (`POST /api/admin/seed-demo`) before recording.
- **B-roll:** 1080p, hand-held is fine — authentic matters more than polished. Target shots: counter with trays, phone over display case, owner reviewing phone screen.
- **Cuts:** at natural beats between shots. No hard flash transitions; a simple cut or a half-second crossfade is fine.
- **Music:** optional, low-attention instrumental underneath the screen-capture sections only. Suggested: CC0 from [freemusicarchive.org](https://freemusicarchive.org) (search "acoustic morning" or "lo-fi bakery"). Fade out under Shot 9.
- **Voiceover vs. sync-sound:** bakery owner's lines in Shots 1, 9, and the B-roll cut in Shot 7 are sync-sound (record on-location). Owner lines during screen captures (Shots 3–8) are sync-sound recorded separately and dubbed over the screen; see `script.md` for exact wording and timecodes.
- **Browser prep:** sign in, select branch, open DevTools Network tab → filter "WS / SSE" to verify streaming is live before recording the chat shot. Close DevTools before rolling.
- **Demo seed credentials:** `demo@bakerysense.app / Demo2026DemoDemo`, tenant slug `favorita`. Verify the branch selector shows all 5 branches before recording.
