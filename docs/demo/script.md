# BakerySense — 3-Minute Demo Script

Aligned to `storyboard.md`. Target: ~450 words at 150 words/minute over 3:00.

Two speaker types:
- `[OWNER ON CAM]` — bakery owner, sync-sound, recorded on-location.
- `[VO]` — voiceover narration, recorded in a quiet room, dubbed over screen captures.

Pauses marked as `[BEAT]`.

---

| Time | Line |
|---|---|
| **0:00–0:15** | **[OWNER ON CAM]** "Yesterday I threw out 40 croissants. The day before, I ran out by noon. I needed something that would just tell me how many to bake." |
| **0:15–0:25** | **[VO]** "This is BakerySense. It combines a LightGBM demand forecaster with Gemma 4, Google's open-source multimodal model. Log in with your bakery's tenant ID —" |
| **0:25–0:30** | **[BEAT]** *(signin form submits, dashboard loads)* |
| **0:30–0:38** | **[VO]** "— and your bake plan is waiting. Three products, three quantities. The colored badge next to each one is the forecast error over the last seven days." |
| **0:38–0:48** | **[OWNER ON CAM]** "That amber number — that's the forecast error. Green means I've given it enough history to trust it." |
| **0:48–1:00** | **[VO]** "Switch branches. Quito Centro bakes 42 croissants tomorrow. Guayaquil Urdesa bakes 31. Same model, same day — different sales patterns, different answers." |
| **1:00–1:15** | **[VO]** "Click into a product and you see the full quantile band — demand anywhere from 117 to 152, with the newsvendor quantity pinned at 135." |
| **1:15–1:30** | **[OWNER ON CAM]** "The bars show me why the model picked that number — lag 7 means last week's sales are the strongest signal. Then I click to ask it in plain language." |
| **1:30–1:40** | **[VO]** "The prefilled question goes to Gemma 4. Watch the screen." |
| **1:40–1:55** | **[BEAT]** *(SSE stream fills in the assistant reply, token by token)* |
| **1:55–2:10** | **[OWNER ON CAM]** "It calls the forecaster, reads the SHAP values, and writes me a sentence I can actually use. That's Gemma 4 doing the talking — the numbers come from the model, not the language model." |
| **2:10–2:15** | **[VO]** "At 5pm, go to the display-case page." |
| **2:15–2:17** | **[BEAT]** *(2-second B-roll cut: owner holds phone over display tray)* |
| **2:17–2:30** | **[OWNER ON CAM]** "At 5pm I take one photo. It counts what's left. Then it tells me what to mark down and by how much." |
| **2:30–2:40** | **[VO]** "Closing out the day takes one click. The actual sales go in. Once a week the forecaster retrains on your data." |
| **2:40–2:50** | **[OWNER ON CAM]** "Every day I close out, the actual sales go in. Once a week it retrains. That second row — that's after two weeks of my data. The error dropped four points." |
| **2:50–3:00** | **[OWNER ON CAM]** "By month two, the model knows my bakery better than I do. I just bake what it tells me." |

---

## Word count note

Spoken prose above (excluding stage directions and timecodes): approximately 315 words. At 150 wpm over 3:00 (450 word capacity), the remaining ~135 words are absorbed by beats, the SSE streaming pause (0:15), and natural pacing in the B-roll cuts. Do not add filler — the silence is intentional.

## Production notes

- The owner's on-cam lines are short by design. Do not add adjectives to fill time. If a line runs short, hold on the speaker's face for a beat rather than adding words.
- VO lines are tight. Record them at a natural conversational pace, not broadcast speed. If a VO line runs over its timecode by more than two seconds, cut one clause.
- The phrase "Gemma 4" appears at 1:30 (VO) and 1:55 (owner on cam). Both are essential — do not cut either.
- The word "LightGBM" at 0:15 is fine to speak; it is a named thing, not jargon. If the owner stumbles on it in ADR, substitute "the demand model."
