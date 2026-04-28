# Submission checklist — what's done, what's left

*Last updated: 2026-04-28.*

## Code + research (✅ complete)

- ✅ Production code shipped to Cloudflare Workers (worker `c91217e7`)
  - V1 LightGBM forecaster with weather + lag-365 + 13 features
  - V1.5 population prior (`(family × dow)` median)
  - Tier 4 per-quantile blend (`perq_blend_v1`) — production median + tail
  - Tier 6 TimesFM tail (`perq_blend_v2`) — wired, activates with `TIMESFM_ENDPOINT`
  - 185 tests green; typecheck + lint clean
- ✅ Forecast router: `bakerysense-web/src/lib/forecast-router.ts`
- ✅ TimesFM client: `bakerysense-web/src/lib/forecasters/timesfm.ts` (5s timeout, graceful fallback)
- ✅ TimesFM serving: `scripts/serve_timesfm.py` (FastAPI), `Dockerfile.timesfm`,
  `deploy_modal.py`. Three deploy paths documented.
- ✅ 23 tiers benchmarked across 9 datasets; full log at
  [`docs/research/tier-scorecard.md`](research/tier-scorecard.md).
- ✅ Architecture-vs-model proof (Tier 23): TimesFM ↔ Chronos-Bolt
  swap under same pipeline = WSPL 0.138 vs 0.140 (1.2% delta).

## Documentation (✅ complete)

- ✅ `README.md` — cross-dataset table, links to scorecard
- ✅ `docs/research/tier-scorecard.md` — full 23-tier log
- ✅ `docs/architecture/v2-migration.md` — Sprint 0–5 + tier mapping
- ✅ `docs/demo/writeup.md` — 1,479 / 1,500 words, with new architecture-vs-model claim
- ✅ `docs/demo/script.md` — close VO updated with cross-dataset line
- ✅ `docs/demo/storyboard.md` — flagged for re-render
- ✅ `docs/deploy.md` — deploy guide
- ✅ `docs/demo/cover-image-spec.md` — Kaggle cover image spec

## Demo artifacts (✅ complete)

- ✅ `docs/demo/demo-final.mp4` — re-rendered with new close VO. 1:52, 10 MB.
  Last 9.92s = updated K_close VO ("Validated against nine forecasting
  benchmarks — the architecture transfers across foundation models.")
- ✅ B-roll clips: `docs/demo/broll/*.mp4` (cold open, display case, close)
- ✅ Voiceover: `bakerysense-web/e2e-demo/voiceover/out/*.wav` (12 sections, Aiden voice)
- ✅ Live demo URL: https://bakerysense-web.swmengappdev.workers.dev
  - Credentials: `demo@bakerysense.app` / `Demo2026DemoDemo` / tenant `favorita`

## Production state (active)

| Component | Status |
|---|---|
| Cloudflare Worker | LIVE — version `c91217e7` |
| D1, KV, R2, Queues | provisioned, populated |
| TIMESFM_ENDPOINT | set to localtunnel `tasty-steaks-call.loca.lt` (this laptop) |
| `perq_blend_v2` activation | live while laptop + tunnel are up |
| Fallback when laptop closes | automatic to `perq_blend_v1` (verified live) |
| Test suite | 185 green |
| JS↔Python parity | 700/700 within 1×10⁻⁴ |

## What's left before submitting to Kaggle

### Required before submission (operational)

- [ ] Push all commits to GitHub (`git push origin master`) — 41 commits to push
- [ ] (Optional) Provision a permanent TimesFM backend so the live demo
      keeps `perq_blend_v2` active after the laptop closes:
      - Modal (`modal deploy scripts/deploy_modal.py`) — billing reset on next cycle
      - Cloudflare Container — push image, bind in `wrangler.jsonc`
      - Render / Replicate — alternative paid hosts
- [ ] Verify the live demo URL works for an external visitor (test with a
      different network / browser)
- [ ] (Optional) Enable Kaggle late submission for M5 Uncertainty if you want
      a real private-leaderboard rank. Browser-side rule-acceptance done; the
      submission CSV would need formatting against the M5 quantile schema
      (548,820 rows = 30,490 series × 9 quantiles × 2 phases). Not currently
      generated.

### Submission package contents (Kaggle Gemma 4 Good Hackathon)

- [ ] Submit `docs/demo/writeup.md` as the writeup PDF / markdown
- [ ] Upload `docs/demo/demo-final.mp4` as the demo video
- [ ] Upload cover image per `docs/demo/cover-image-spec.md`
- [ ] Reference repo: https://github.com/wms2537/gemma-4-hack
- [ ] License: CC-BY-4.0 per Rules §2.5

### Things to mention in the Kaggle submission form

The strongest claims that should appear in the form's free-text fields:

1. **V1.5 production forecaster** beats best classical baseline on French Bakery by 22% (WAPE 0.212 vs AutoETS 0.271)
2. **TimesFM-2 zero-shot** beats every published M4 Daily method (sMAPE 2.16)
3. **Top 5% of 1,095 teams on Kaggle Web Traffic** (SMAPE 38.83) zero-shot, no tuning
4. **M5 Uncertainty WSPL 0.138** on validation period — top-tier range (winner 0.157 private)
5. **Architecture-vs-model proof** (Tier 23): swapping TimesFM-2 → Chronos-Bolt under the same pipeline yields WSPL 0.140 vs 0.138 — the wiring transfers
6. **Production-grade deployment** on Cloudflare Workers, OpenNext, Next.js 16; Tier 6 wiring verified live with `forecaster: "perq_blend_v2"` returning TimesFM-derived q0.9 = 125 vs GBM fallback 128.1 on TRADITIONAL BAGUETTE

## Honest framing notes for the writeup / submission

- **Don't claim "we beat the M5 leaderboard."** Our 0.138 is on validation, not private. The 0.157 winner score was on private. Validation scores were systematically lower because Kaggle teams could resubmit unlimited times. Use "top-tier validation range" / "competitive with top-of-leaderboard finishers" instead.
- **The 2020 M5 isn't a 2026 yardstick.** TimesFM-2 didn't exist in 2020. The interesting comparison is vs 2024-2026 foundation-model peers (Chronos, MOIRAI, TimesFM paper), and we ran that — see Tier 22 in the scorecard. Honest read: competitive on retail-daily, weaker on small-N monthly + weekly counts.
- **Architecture is the win.** Tier 23 isolates this empirically (swap models, same pipeline, same result within 1.2%). That's the most production-defensible claim because it's *forward-compatible* with whatever 2027 foundation model comes next.
