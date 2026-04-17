# BakerySense — Architecture

## Design principle

**Numeric work is deterministic. Semantic work is LLM.** The two communicate through a narrow tool-call surface.

Gemma 4 handles: multimodal ingestion (photos, voice, manager notes), natural-language querying, routing between forecasters, and rendering structured results as explanations. Gemma does **not** produce forecast numbers, compute SHAP, or solve newsvendor — those live in classical ML / OR code where they can be tested and trusted.

## Module map

```
src/bakerysense/
├── data.py                     Load real French Bakery CSV or synthesise 2y bakery data
├── features.py                 Lag/rolling/calendar/holiday feature engineering
├── explain.py                  SHAP drivers via LightGBM native pred_contrib
├── eval.py                     WAPE, MASE, pinball loss, seasonal-naive baseline
├── forecaster/
│   ├── gbm.py                  LightGBM quantile (0.1…0.9) + save/load
│   └── __init__.py
├── decision/
│   ├── newsvendor.py           service-level → production quantity
│   └── markdown.py             (stub, week 2)
└── agent/
    ├── state.py                AgentState: loaded forecaster + features in memory
    ├── tools.py                Typed tools + JSON schemas + dispatch registry
    ├── prompts.py              System prompt + date banner
    ├── server.py               llama-cpp-python wrapper, env-configurable
    ├── session.py              Chat loop with tool-calling (bounded rounds)
    └── vision.py               (stub, week 2 — photo → unit counts)

scripts/
├── train_baseline.py           Train, evaluate, SHAP example, save models/gbm/
└── demo_agent.py               --tools-only | scripted | --interactive

tests/                          31 tests: features, newsvendor, eval, forecaster, tools
```

## Layers

### Predictive layer (`forecaster/`)

Non-LLM. Per-SKU daily quantile forecasts.

- **`gbm.py`** — LightGBM trained once per quantile in ``DEFAULT_QUANTILES = (0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9)`` with ``objective='quantile'``. Global model across SKUs; ``sku`` is a categorical feature. Persistence uses LightGBM's native text model format plus a JSON metadata file — human-auditable, forward-compatible, no binary serialisation of Python objects.
- **`foundation.py`** *(stub, wired in week 2)* — TimesFM 2.0 zero-shot fallback for cold-start SKUs.
- **`router.py`** *(stub)* — picks per SKU: GBM if mature, TimesFM if cold-start.

### Decision layer (`decision/`)

Non-LLM. Converts forecasts into actions under business constraints.

- **`newsvendor.py`** — given a quantile forecast map and ``(Cu, Co)``, returns ``(production_quantity, used_quantile)``. The target service level is ``Cu / (Cu + Co)``; we pick the closest trained quantile. Typical bakery parameters (Cu=2, Co=1) give target 0.667, which the 7-quantile grid resolves to q=0.7.
- **`markdown.py`** *(stub)* — given end-of-day inventory, recommends discount percentages. Currently implemented directly in `agent/tools.py::suggest_markdowns` as a simple rule; will move here when calibrated.

### Explanation layer (`explain.py`)

- ``explain_row(model, feature_row, quantile, top_k)`` returns the top-k (feature_name, signed_shap) pairs for a single SKU-day prediction.
- Uses LightGBM's native ``booster.predict(X, pred_contrib=True)`` — same values the SHAP library returns for tree ensembles, with zero extra dependencies.
- Shape invariant (tested): ``base_value + shap.sum(axis=1) ≈ prediction``.

### Agent layer (`agent/`)

Gemma 4 only. Owns the merchant-facing interface.

- **`state.py`** — ``AgentState``: holds the loaded ``QuantileGBM`` + feature-engineered dataset in memory. Constructed once per demo session; tools receive it by reference so they never reload.
- **`tools.py`** — typed tool implementations (``forecast``, ``explain_drivers``, ``waste_risk``, ``list_skus``, ``suggest_markdowns``) plus OpenAI-compatible JSON schemas (`TOOL_SCHEMAS`) and a central ``dispatch(state, name, args)`` with error-as-return-value semantics so Gemma can retry gracefully.
- **`prompts.py`** — system prompt (tool-use discipline, on-device claim, ISO dates) + a `today_banner` helper that injects current date + last data date.
- **`server.py`** — thin wrapper around ``llama_cpp.Llama.from_pretrained``. Env-configurable via ``BAKERYSENSE_MODEL_REPO`` / ``BAKERYSENSE_MODEL_FILE`` / ``BAKERYSENSE_N_CTX`` / ``BAKERYSENSE_N_GPU_LAYERS``. Lazy-loads so tests can import without the model.
- **`session.py`** — ``ChatSession.ask(user_message)`` runs the tool-calling loop: Gemma emits a message or tool call; tool calls dispatch to `tools.py`; loop bounded by `max_tool_rounds`.
- **`vision.py`** — multimodal path. ``count_units_from_photo(server, image_path, known_skus)`` base64-encodes the image, sends a strict-JSON prompt alongside it using OpenAI-compatible ``messages[].content`` list format (``type: "image_url"`` + ``type: "text"``), parses the response (code-fence-tolerant), and whitelists against ``known_skus`` so hallucinated product names are dropped before the counts reach the decision layer. ``ChatSession.ask_with_photo(text, image_path)`` wraps this: the vision pass runs first, then the counts are injected into the user message so the normal tool-calling loop handles the rest.

### Evaluation layer (`eval.py`)

- **Seasonal-naive baseline** (lag-7) as the floor.
- **MASE** for across-SKU comparability; <1 means the model beats naive.
- **WAPE** for business-friendly reporting.
- **Pinball loss** at each trained quantile — the scoring rule matched to quantile regression.
- `evaluate()` returns a tidy per-SKU table ready for printing or joining into a report.

## Current results

Day-1 baseline on 2 years × 12 SKUs of synthetic bakery data (2023-2024, 28-day holdout):

| Metric | Seasonal-naive | LightGBM q=0.5 |
|---|---|---|
| WAPE | 0.235 | **0.183** |
| MASE | 1.000 | **0.780** |

LightGBM beats naive on 11 of 12 SKUs. The newsvendor layer correctly selects q=0.7 (closest to target 0.667) from the 7-quantile grid. A real bakery example at the last holdout day:

```
SHAP drivers (curry_puff, 2024-12-31)
  prediction      : 106.6 units
  base (expected) : 113.9 units
  top drivers     : rolling_mean_28 (+10.9) · lag_28 (-8.4) ·
                    dow (-6.1) · rolling_mean_7 (-4.3)
```

## Runtime topology

```
┌────────────────────────────────────┐
│  Gemma 4 E4B (llama.cpp GGUF Q4)   │  multimodal in, tool calls out
└────────────────────────────────────┘
             │ OpenAI-compatible tool calls
             ▼
┌────────────────────────────────────┐
│  agent.session.ChatSession         │  bounded tool-call loop
│  agent.tools.dispatch              │  name → function
└────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  forecaster.QuantileGBM            │  LightGBM × 7 quantiles
│  decision.newsvendor               │  target-quantile selection
│  explain.explain_row               │  pred_contrib SHAP
└────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────┐
│  models/gbm/  (7 × booster .txt    │  saved by train_baseline.py
│              + metadata.json)      │
│  features DataFrame in RAM         │
└────────────────────────────────────┘
```

Everything runs on one machine. No network calls at inference time after the initial model download.

## Special-track alignment

- **Main / Impact Tracks** — offline-first, small-merchant resilience, food-waste reduction.
- **Ollama Track** — package the runtime as an Ollama modelfile for reproducibility.
- **Unsloth Track ($10 000 confirmed)** — QLoRA fine-tune of Gemma 4 E4B on bakery-specific vocabulary (SKU names, French / Malay / Chinese bakery terms, shift-manager note style).
- **llama.cpp Track** — primary runtime; leverages native tool calling and multimodal input.

## Status by module

| Module | Day 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| `data` | ✅ synthetic + real loader | ✨ client data wired | — | polish |
| `features` | ✅ lag, rolling, calendar, holidays, weather | ✨ client-specific flags | — | polish |
| `forecaster.gbm` | ✅ 7 quantiles, save/load | ✨ tuning | ✨ client data | polish |
| `forecaster.foundation` | — | ✅ TimesFM | ✨ routing | polish |
| `decision.newsvendor` | ✅ target-quantile selection | ✨ per-SKU Cu/Co | — | polish |
| `decision.markdown` | inline | ✅ dedicated module | ✨ calibrated | polish |
| `explain` | ✅ pred_contrib SHAP | ✨ multi-quantile | — | polish |
| `agent.state` | ✅ | ✨ cache | — | polish |
| `agent.tools` | ✅ 5 tools + schemas + dispatch | ✨ vision, more tools | ✨ | polish |
| `agent.server` | ✅ llama-cpp-python wrapper | — | ✨ Ollama wrapper | polish |
| `agent.session` | ✅ tool-calling loop | ✨ streaming | ✨ | polish |
| `agent.vision` | ✅ photo → counts (Gemma multimodal) | ✨ real fixture | ✨ | polish |
| Tests | ✅ 31 tests / 6s | ✨ agent session | ✨ vision | ✨ |
| Demo script | ✅ 3 modes | ✨ polish | ✨ | ✅ |
| Video + writeup | — | — | — | ✅ |
