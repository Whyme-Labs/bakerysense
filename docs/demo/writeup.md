# BakerySense: Offline-First AI Production Copilot for Independent Bakeries

**Kaggle Gemma 4 Good Hackathon — Submission Writeup**

**Live demo video:** [`docs/demo/demo-final.mp4`](demo-final.mp4) (~2:18, 9.7 MB) — eight-scenario walkthrough recorded against the deployed app at <https://bakerysense-web.swmengappdev.workers.dev>.

---

## 1. The Problem

Independent bakeries throw away an estimated 30–40% of perishable production daily. In France alone — where this project's training data originates — boulangers discard millions of unsold baguettes and croissants every week, food that cost flour, energy, and labor to make. The waste is not ignorance; it is uncertainty. A baker cannot know on Monday morning whether Tuesday will bring a school-holiday crowd or a rainstorm that keeps everyone home.

Existing tools do not fit this context. Point-of-sale systems record what sold; they do not predict what to make. Spreadsheet templates require a manager who understands statistical forecasting. Enterprise demand-planning software assumes a logistics team, a data warehouse, and a six-figure implementation budget. A single-location bakery with five employees and a 4am start time has none of those.

Most independent bakers rely on intuition and over-produce to avoid stockouts — the financially safer error, but still a significant source of waste and margin erosion.

---

## 2. The Solution

BakerySense reduces the baker's decision to one photo and one tap.

The dashboard shows a bake plan: how many units of each product to make, derived from a quantile forecast and a newsvendor decision under the bakery's specific cost-of-waste versus cost-of-stockout ratio. At 5pm, the baker photographs the display case. Gemma 4 counts the remaining units from the image and immediately returns markdown suggestions — which products to discount, and by how much, to clear inventory before close.

The design principle is explicit: **numeric work is deterministic; semantic work is LLM.** LightGBM produces the forecast numbers, an approximate-SHAP walker produces the feature attributions, and the newsvendor equation produces the production quantity. Gemma 4 reads those outputs and writes the explanation. It does not produce numbers. This separation means the forecast can be tested, audited, and retrained without touching the language model, and the language model can be swapped without recalibrating the forecaster.

A non-obvious consequence: the merchant-facing UI can teach. Each statistical concept (median demand, band width, WAPE, the quantile band itself) has an inline plain-language hint and an "i" tooltip on the SKU detail page; tool calls in the chat render as friendly chips and horizontal bars rather than raw JSON. The numeric core stays unchanged; the operator's understanding of it grows.

---

## 3. Gemma 4's Role

Gemma 4 E4B (an "Effective 4B" Matformer-style sub-model with the inference cost of E2B but more capacity) is the merchant-facing layer. It handles three distinct jobs.

**Multimodal ingestion.** The display-case photo goes directly to Gemma 4 as a base64-encoded image via the OpenAI-compatible `messages[].content` list (`type: "image_url"` alongside `type: "text"`). Gemma counts products by visual category, whitelists the output against known SKUs to suppress hallucinated names, and returns a structured JSON count that flows directly into the markdown decision engine.

**Tool routing.** When a baker asks a free-form question — "Why am I baking 116 baguettes tomorrow?" — Gemma 4 emits an OpenAI-compatible tool call targeting one of five registered functions: `forecast_point`, `explain_drivers`, `waste_risk`, `list_skus`, or `close_out_day`. The tool-call loop is bounded to prevent runaway chains; clean turn boundaries use `stop=["<turn|>", "<tool_response>"]`.

**Merchant-facing explanations.** Gemma renders SHAP-style driver arrays into plain-language sentences. "Last Tuesday's sales of 141 baguettes are pulling the forecast up" is more useful to a baker than a feature-importance bar chart.

Why Gemma 4 specifically? The Apache 2.0 license permits commercial deployment without royalties — essential for a product aimed at thin-margin merchants. The E4B variant fits in 16 GB of RAM in GGUF Q4_K_M quantization, matching the MacBook Pro that most independent operators already own; on-device inference means no API cost and no data leaving the premises. Gemma 4 also handles French bakery vocabulary (baguette, viennoiserie, croissant) without fine-tuning, which matters because the training data is French.

The system supports eight LLM connector presets — openrouter, groq, together, openai, anthropic-via-oai, ollama-tunnel, cloudflare-ai, and custom — so operators can run Gemma 4 locally via Ollama or in the cloud, with a one-field switch in account settings.

---

## 4. Architecture

**Cloudflare stack.** The web application runs on Cloudflare Workers via the OpenNext adapter for Next.js 16. Storage: D1 (SQLite) for transactional records, KV for hot configuration and model version pointers, R2 for the model artifacts and SHAP feature store, Queues for async chat turns and retrains. No server to provision; cold-start latency is under 50ms.

**Pure-TypeScript LightGBM inference.** The trained model is exported as **JSON** (human-auditable, no binary Python objects) and walked at inference time by a pure-TypeScript tree walker (`gbm-walker.ts`) running inside the Cloudflare Worker. No Python at request time; no container to manage. JS↔Python numeric parity is verified at 700/700 test cases within 1×10⁻⁴ absolute tolerance. The same walker produces approximate-SHAP attributions for the explain endpoint.

**Operator surfaces.** The admin section makes the data and the model legible. The *Data* tab summarises sales rows, SKUs, branches, and date range, plus a 30-day daily-totals sparkline and a recent-rows preview table. The *Model* tab shows the predictor type, seven quantile heads, last-trained timestamp, training-data summary, and thirteen plain-language feature chips ("Last week, same day", "Past-week average", …) before the retrain history and the *Retrain now* button. The merchant can see exactly what the model has seen and what it is.

**Feedback loop.** Daily actuals captured via close-out-of-day flow, inline "report actual" controls, or CSV import write to `daily_actuals`. A background job computes rolling WAPE from `forecast_snapshots`. When WAPE degrades past a threshold, a retrain is queued. The retrained model is published via a signed endpoint and activated by updating a KV pointer — the Worker reads the new version on the next request with no redeployment. This is the compounding moat: each week of actual sales makes the forecast more accurate for that specific bakery.

**SSE streaming + context compaction.** Long chat sessions are summarised before the context window fills. SSE streams keep the UI responsive while Gemma plans tool calls.

**Security.** JWT ES256 with JWKS rotation, Argon2id password hashing, refresh-token tombstones, and CSRF double-submit cookies.

---

## 5. Results

**Forecast accuracy** (French Bakery Kaggle dataset, `matthieugimbert/french-bakery-daily-sales`):

| Metric | Seasonal-naive (lag-7) | LightGBM q=0.5 | Improvement |
|---|---|---|---|
| WAPE | 0.341 | 0.249 | −27 percentage points |
| MASE | 1.000 | 0.731 | beats naive on 19 / 20 SKUs |

A MASE below 1.0 means the model outperforms the lag-7 naive baseline. The one losing SKU has fewer than 30 training observations, where any learned model will struggle.

**JS↔Python parity:** 700/700 test cases within 1×10⁻⁴ absolute tolerance, across all 7 quantiles and all SKUs in the holdout.

**End-to-end latency:** 5–15 seconds for a full chat turn (tool call + LLM generation), depending on the LLM connector and whether Gemma 4 is running locally or via OpenRouter.

**Test matrix:** 172 tests total — 49 Python (forecaster, newsvendor, SHAP, eval), 106 Cloudflare Workers (API routes, auth, agent loop, feedback loop), 10 unit (JS walker, context compactor), 7 Playwright E2E (2 marked fixme pending fixture recording). Demo video re-recorded against the live deploy: 8/8 scenarios passing.

The feedback loop is the long-term value driver. A bakery that enters actuals daily will see WAPE improve measurably within two to four weeks as the model learns local patterns — school holidays, neighborhood events, competitor closures — that the public dataset cannot capture.

---

## 6. Tracks and Deployment

**Main + Impact tracks:** BakerySense addresses food waste (SDG 12.3) and small-merchant economic resilience. The offline-first design works in regions with unreliable connectivity.

**Unsloth track:** the production model uses Gemma 4 E4B without fine-tuning. A QLoRA fine-tune on bakery-domain vocabulary is documented as a stretch goal.

**Ollama track:** the `ollama-tunnel` preset is one of eight first-class connectors. Operators with a local Mac can point at `http://localhost:11434` and run Gemma 4 entirely on-device.

**llama.cpp track:** the Python demo layer uses llama-cpp-python as its primary inference runtime, with `BAKERYSENSE_MODEL_REPO` and `BAKERYSENSE_MODEL_FILE` environment variables pointing to the GGUF artifact.

**License:** CC-BY-4.0 per Rules §2.5.

**Live demo:** seeded tenant `favorita` at <https://bakerysense-web.swmengappdev.workers.dev> (branch selection required after login). Credentials: `demo@bakerysense.app / Demo2026DemoDemo`. Walkthrough video: [`docs/demo/demo-final.mp4`](demo-final.mp4).

---

## 7. What's Next

Four concrete next steps, none of which are in scope for this submission:

1. **TimesFM cold-start sidecar.** New SKUs with fewer than 30 observations get zero-shot forecasts from TimesFM 2.0 until the GBM has enough data. Router stub already in the codebase.
2. **Tenant QLoRA.** Fine-tune Gemma 4 E4B per-tenant on that bakery's chat logs and corrections. Achievable after ~6 months of actuals.
3. **POS integrations.** Pull actuals automatically from Square, Lightspeed, and SumUp instead of close-out flow.
4. **Cloudflare Container retrain.** Move the Python retrain pipeline into a Cloudflare Container so the loop (actuals → retrain → publish → hot swap) runs without local tooling. The signed publish endpoint and KV pointer are already in place.

---

## Credits

Built for the Gemma 4 Good Hackathon (Kaggle, deadline 2026-05-18).

Repository: <https://github.com/wms2537/gemma-4-hack>

---

<!-- word count target: ≤1500 -->
