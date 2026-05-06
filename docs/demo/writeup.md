# BakerySense: Offline-First AI Production Copilot for Independent Bakeries

**Kaggle Gemma 4 Good Hackathon — Submission Writeup**

**Live demo video:** [`docs/demo/demo-final.mp4`](demo-final.mp4) (~2:18, 9.7 MB) — eight-scenario walkthrough recorded against the deployed app at <https://bakerysense-web.swmengappdev.workers.dev>.

---

## 1. The Problem

Independent bakeries throw away an estimated 30–40% of perishable production daily. In France alone — where this project's training data originates — boulangers discard millions of unsold baguettes and croissants every week. The waste is not ignorance; it is uncertainty. A baker cannot know on Monday morning whether Tuesday will bring a school-holiday crowd or a rainstorm that keeps everyone home.

Existing tools do not fit this context. POS systems record what sold; they do not predict what to make. Spreadsheet templates require statistical literacy. Enterprise demand-planning software assumes a logistics team, a data warehouse, and a six-figure implementation budget. A single-location bakery with five employees and a 4am start time has none of those, so most independent bakers rely on intuition and over-produce to avoid stockouts — the financially safer error, but still a significant source of waste and margin erosion.

---

## 2. The Solution

BakerySense reduces the baker's decision to one photo and one tap.

The dashboard shows a bake plan: how many units of each product to make, derived from a quantile forecast and a newsvendor decision under the bakery's specific cost-of-waste versus cost-of-stockout ratio. At 5pm, the baker photographs the display case. Gemma 4 counts the remaining units from the image and immediately returns markdown suggestions — which products to discount, and by how much, to clear inventory before close.

The design principle is explicit: **numeric work is deterministic; semantic work is LLM.** LightGBM produces the forecast numbers, an approximate-SHAP walker produces the feature attributions, and the newsvendor equation produces the production quantity. Gemma 4 reads those outputs and writes the explanation. It does not produce numbers. This separation means the forecast can be tested, audited, and retrained without touching the language model, and the language model can be swapped without recalibrating the forecaster.

A non-obvious consequence: the merchant-facing UI can teach. Each statistical concept (median demand, band width, WAPE, the quantile band itself) has an inline plain-language hint and an "i" tooltip on the SKU detail page; tool calls in the chat render as friendly chips and horizontal bars rather than raw JSON. The numeric core stays unchanged; the operator's understanding of it grows.

---

## 3. Gemma 4's Role

Gemma 4 E4B (Effective 4B Matformer sub-model — E2B inference cost, more capacity) is the merchant-facing layer with three jobs.

**Multimodal ingestion.** Display-case photo → Gemma 4 as base64 image via the OpenAI-compatible `messages[].content` list. Gemma counts products by category, whitelists output against known SKUs to suppress hallucinations, returns structured JSON to the markdown engine.

**Tool routing.** When a baker asks "Why am I baking 116 baguettes tomorrow?" Gemma emits an OpenAI-compatible tool call targeting one of five registered functions: `forecast_point`, `explain_drivers`, `waste_risk`, `list_skus`, `close_out_day`. The tool-call loop is bounded; clean turn boundaries via `stop=["<turn|>", "<tool_response>"]`.

**Merchant-facing explanations.** Gemma renders SHAP driver arrays into plain language. "Last Tuesday's sales of 141 baguettes are pulling the forecast up" beats a feature-importance bar chart.

Why Gemma 4: Apache 2.0 license permits commercial deployment without royalties (essential for thin-margin merchants); E4B fits in 16 GB RAM in GGUF Q4_K_M quantisation (matches the MacBook Pro most independents already own — no API cost, no data egress); handles French bakery vocabulary without fine-tuning. Eight LLM connector presets (openrouter / groq / together / openai / anthropic-via-oai / ollama-tunnel / cloudflare-ai / custom) let operators run locally or in cloud with one click.

---

## 4. Architecture

**Cloudflare stack.** Next.js 16 via OpenNext on Cloudflare Workers; D1 (SQLite) transactional, KV for hot config + model pointers, R2 for model artifacts + SHAP feature store, Queues for async chat + retrain. Cold-start <50ms.

**Pure-TypeScript LightGBM inference.** Trained model exported as JSON (human-auditable, no binary serialisation), walked by a pure-TS tree walker (`gbm-walker.ts`) inside the Worker. No Python at request time. JS↔Python parity 700/700 within 1×10⁻⁴ tolerance. Same walker produces approximate-SHAP attributions.

**Operator surfaces.** The admin section makes the data and the model legible. The *Data* tab summarises sales rows, SKUs, branches, date range, plus a 30-day sparkline and recent-rows preview. The *Model* tab shows the predictor type, seven quantile heads, last-trained timestamp, plain-language feature chips ("Last week, same day", "Past-week average", …), and a *Retrain now* button.

**Feedback loop.** Daily actuals captured via close-out-of-day flow, inline "report actual" controls, or CSV import write to `daily_actuals`. A background job computes rolling WAPE from `forecast_snapshots`; when it degrades past a threshold, a retrain is queued. The retrained model is published via a signed endpoint and activated by updating a KV pointer — the Worker reads the new version on the next request with no redeployment. Each week of actual sales makes the forecast more accurate for that specific bakery.

**Security and streaming.** JWT ES256 with JWKS rotation, Argon2id password hashing, refresh-token tombstones, CSRF double-submit cookies. Long chat sessions are summarised before the context window fills; SSE streams keep the UI responsive while Gemma plans tool calls.

---

## 5. Results

**Forecast accuracy** (French Bakery Kaggle dataset, `matthieugimbert/french-bakery-daily-sales`, 28-day × 20-SKU holdout, identical per-SKU fit and horizon for every method — `scripts/benchmark_vs_baselines.py`):

| Forecaster | WAPE | MASE | pinball-q0.5 | pinball-q0.9 |
|---|---|---|---|---|
| Seasonal-naive (lag-7)            | 0.341 | 1.000 | 3.27 | – |
| AutoARIMA (`statsforecast`)         | 0.548 | 1.610 | 5.26 | – |
| AutoETS (`statsforecast`)           | 0.271 | 0.796 | 2.60 | – |
| CrostonClassic (intermittent)     | 0.764 | 2.244 | 7.34 | – |
| V1 LightGBM (with weather + lag-365) | 0.245 | 0.719 | 2.35 | **1.15** |
| V1.5 population prior (cold-start) | 0.212 | 0.623 | 2.04 | – |
| **V1.5 PER-QUANTILE blend (production)** | **0.212** | **0.623** | **2.04** | **1.15** |

The V1.5 forecaster posts WAPE **22% below the best published baseline** (AutoETS). The mechanism is per-quantile alpha — the `(family × dow)` prior wins the median (ignores recent-shock noise), LightGBM wins the q0.9 tail (calibrated for newsvendor). Per-quantile blending keeps both, scaled by `maturity = clip(actuals_count / 90, 0, 1)` so cold tenants still see pure prior.

LightGBM beats the lag-7 naive baseline on 19 / 20 SKUs; the loser has fewer than 30 training observations.

**Cross-dataset generalization (6 published benchmarks):**

| Dataset | V1.5 prior | TimesFM-2 zero-shot | Best published / our rank |
|---|---|---|---|
| French Bakery (retail + weather) | **0.212 WAPE** | 0.314 | AutoETS 0.271 (V1.5 wins by 22%) |
| NN5 Daily | 0.208 | 0.197 | AutoETS 0.192 |
| M4 Daily (4,227 series) | 31.4 sMAPE | **2.16 sMAPE** | M4 winner 3.05 (we beat) |
| Kaggle Web Traffic (1,095 teams) | 53.5 SMAPE | **38.8 SMAPE** | top 50 / top 5% |
| M5 Accuracy (5,558 teams, WRMSSE) | 3.36 | **0.71 (T14)** | winner 0.520 / median 0.65 |
| **M5 Uncertainty** (909 teams, WSPL) | – | **0.138 (T21)** | top-tier range on validation period (winner 0.157 private; zero-shot, hybrid L9+L10+L11) |

V1.5's `(family × dow)` prior fits dense weekly-seasonal retail; fails on heterogeneous data. **TimesFM-2.0-500m zero-shot + per-level routing fills the gap**: WRMSSE 0.71 on M5 Accuracy, WSPL 0.138 on M5 Uncertainty validation. The transferable claim is **the architectural pattern (per-quantile + per-level routing) generalizes across foundation models** — proven by swapping in Amazon's Chronos-Bolt-Base under the same pipeline: WSPL 0.140 (within 1.2%). The wiring transfers; the model choice is fungible at the 1% level.

Production architecture is Tier 6 per-quantile blend — V1.5 prior at median, TimesFM at q0.9 (5.3–31% better calibration depending on dataset). Setting `TIMESFM_ENDPOINT` flips `perq_blend_v1` → `perq_blend_v2` with no redeploy.

**JS↔Python parity:** 700/700. **Tests:** 185 green. **Latency:** 5–15s/turn. Daily actuals improve WAPE within 2–4 weeks.

---

## 6. Tracks and Deployment

**Main + Impact:** food waste (SDG 12.3) and small-merchant economic resilience; offline-first design works in regions with unreliable connectivity. **Unsloth:** Gemma 4 E4B without fine-tuning; QLoRA on bakery vocabulary is a documented stretch goal. **Ollama:** `ollama-tunnel` connector points at `http://localhost:11434` for fully on-device inference. **llama.cpp:** the Python demo layer uses llama-cpp-python with `BAKERYSENSE_MODEL_REPO` / `_FILE` env vars pointing to the GGUF artifact.

**License:** CC-BY-4.0 per Rules §2.5. **Live demo:** seeded tenant `favorita` at <https://bakerysense-web.swmengappdev.workers.dev>. Credentials: `demo@bakerysense.app / Demo2026DemoDemo`. Walkthrough: [`docs/demo/demo-final.mp4`](demo-final.mp4).

---

## 7. What's Next

Out of scope for this submission, but on the roadmap: **TimesFM-2 cold-start sidecar** (router stub already shipped, just needs a Cloudflare Container backend); **tenant QLoRA** fine-tunes per-bakery on that operator's chat corrections; **POS integrations** to pull actuals from Square / Lightspeed / SumUp; **Cloudflare Container retrain** so the actuals → retrain → publish → hot-swap loop runs without local tooling.

---

## Credits

Built for the Gemma 4 Good Hackathon (Kaggle, deadline 2026-05-18).

Repository: <https://github.com/Whyme-Labs/gemma-4-hack>

---

<!-- word count target: ≤1500 -->
