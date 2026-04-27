# BakerySense

[![License: CC-BY-4.0](https://img.shields.io/badge/License-CC--BY--4.0-lightgrey.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-172%20passing-brightgreen)](./tests)
[![Gemma 4](https://img.shields.io/badge/Gemma%204-E4B%20Q4__K__M-orange)](https://ollama.com/library/gemma4)

Offline-first production decision copilot for bakeries. Submission for the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon) (deadline **2026-05-18**).

## Live demo

- **App:** <https://bakerysense-web.swmengappdev.workers.dev>
- **Video:** [`docs/demo/demo-final.mp4`](docs/demo/demo-final.mp4) (~97s, storyboard in [`docs/demo/storyboard.md`](docs/demo/storyboard.md))
- **Writeup:** [`docs/demo/writeup.md`](docs/demo/writeup.md) (≤1500 words)

Demo credentials:
- `demo@bakerysense.app` / `Demo2026DemoDemo` — `tenant_admin`, all 5 branches
- `manager@bakerysense.app` / `Manager2026Manager` — `branch_manager`, 2 branches

The live app runs Gemma 4 (`google/gemma-4-26b-a4b-it` via OpenRouter) end-to-end: sign in, pick a branch on the dashboard, ask "how many TRADITIONAL BAGUETTE should I bake tomorrow?" in chat. Gemma calls `forecast` + `explain_drivers` and returns a plain-language answer grounded in the JS LightGBM walker. See [`docs/deploy.md`](docs/deploy.md) for the deployment checklist.

## What it does

Tells a bakery manager what to bake tomorrow, what to reorder, and what to mark down — and explains why in plain language.

- Photograph the display case → Gemma 4 vision counts remaining units.
- Nightly forecast per SKU with a seven-point quantile distribution.
- Newsvendor math converts forecasts into production quantities given the bakery's own waste-vs-stockout cost ratio.
- Gemma 4 answers questions, narrates the daily plan, and reads SHAP drivers into one-sentence reasons.
- Runs entirely on a 16 GB Mac or tablet — no cloud, no per-call cost, the bakery's sales data never leaves the premises.

## Architecture

Numeric work is deterministic. LLM work is semantic. The two talk through a small tool-call surface.

```
forecaster/         LightGBM quantile (0.1 → 0.9) + TimesFM sidecar (planned)
decision/           newsvendor production qty + markdown policy
agent/              Gemma 4 — multimodal ingest, tool routing, explanation
explain.py          SHAP drivers via LightGBM native pred_contrib
eval.py             MASE / WAPE / pinball vs seasonal-naive baseline
```

See [docs/architecture.md](docs/architecture.md) for module-level detail.

## Quickstart

```bash
# 1. Environment + core deps (Python 3.11)
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"

# 2. Fetch the public French Bakery dataset from Kaggle (2 MB)
#    Requires a ~/.kaggle/kaggle.json API token. If you don't have Kaggle
#    credentials, the pipeline transparently falls back to a synthetic
#    2-year bakery dataset — same shape, runs end-to-end.
kaggle datasets download -d matthieugimbert/french-bakery-daily-sales \
    -p data/raw --unzip

# 3. Train the forecaster
python scripts/train_baseline.py
#    → prints MASE/WAPE/pinball, per-SKU table, one SHAP example,
#      and saves models/gbm/ for the agent to load

# 4. Verify the tool surface without loading an LLM
python scripts/demo_agent.py --tools-only

# 4. Load Gemma 4 E4B and run a merchant conversation
uv pip install -e ".[agent]"

# Option A (recommended): via Ollama (needs Ollama >= 0.20)
ollama pull gemma4:e4b-it-q4_K_M
BAKERYSENSE_BACKEND=ollama python scripts/demo_agent.py

# Option B: via llama-cpp-python directly from a local GGUF
#   If HF_HUB_ENABLE_HF_TRANSFER stalls, download the GGUF through a browser
#   then point at it:
BAKERYSENSE_MODEL_PATH=~/Downloads/gemma-4-E4B-it-Q4_K_M.gguf \
python scripts/demo_agent.py

# Vision: pass a display-case photo
python scripts/demo_agent.py --image ./shelf.jpg \
  --question "What should I mark down from what's in this photo?"

# Interactive REPL
python scripts/demo_agent.py --interactive
```

The Ollama path is fastest on macOS because Ollama manages the model and vision projector together. The llama-cpp-python path gives more control over quantisation / chat templates.

### Model configuration

Override via environment variables (see `src/bakerysense/agent/server.py`):

| Variable | Default | Notes |
|---|---|---|
| `BAKERYSENSE_MODEL_PATH` | *(unset)* | Absolute path to a local `.gguf` file. Overrides repo/filename. |
| `BAKERYSENSE_MODEL_REPO` | `ggml-org/gemma-4-E4B-it-GGUF` | HF repo id |
| `BAKERYSENSE_MODEL_FILE` | `*Q4_K_M*` | Filename pattern |
| `BAKERYSENSE_N_CTX` | `8192` | Context window |
| `BAKERYSENSE_N_GPU_LAYERS` | `-1` | `-1` = all layers on GPU (Metal on Mac) |
| `BAKERYSENSE_TEMPERATURE` | `0.2` | Sampling temperature |

A 3 GB E2B fallback: `BAKERYSENSE_MODEL_REPO=unsloth/gemma-4-E2B-it-GGUF BAKERYSENSE_MODEL_FILE='*Q4_K_M*'`.

If you already have a GGUF on disk (from a browser download, a different machine, or a hand-quantised fine-tune) point directly at it:

```bash
BAKERYSENSE_MODEL_PATH=/Users/me/models/gemma-4-E4B-it-Q4_K_M.gguf \
python scripts/demo_agent.py
```

## Testing

```bash
python -m pytest tests/ -v
```

49 Python tests covering features (leak-freeness), forecaster (train/predict/save/load/SHAP), newsvendor math, eval metrics, agent tool dispatch, vision JSON parsing, session tool-calling loop, and JS↔Python gbm-walker parity (700 cases, 7 quantiles, 100 sampled rows, all within 1e-4 absolute error).

On the web side (bakerysense-web/, Cloudflare Workers + Next.js 16), 123 TypeScript tests: 106 integration tests in the Miniflare workers pool (auth, refresh, JWKS rotation, RBAC matrix, multi-tenant isolation, connector CRUD, chat turn POST, dashboard-flow, chat-ui-smoke, admin-connectors-flow, actuals-flow, metrics-rolling-wape, retrain-pipeline) + 11 unit tests in happy-dom (ConfidenceBar render, pure-math metrics wape/drift, LLM-replay request-hash determinism) + 6 Playwright E2E scenarios (2 more `fixme`d pending recorded LLM fixtures). Grand total across Python + TypeScript + E2E: **172 tests**.

## Reproducibility

Everything is deterministic or seeded:
- `.python-version` pins CPython 3.11
- `pyproject.toml` pins dependency floors; `uv pip install -e '.[dev,agent]'` produces a consistent environment
- `bakerysense.data.load_bakery()` uses `seed=42` for the synthetic fallback
- `QuantileGBM` training uses fixed hyperparameters in `DEFAULT_PARAMS`
- `scripts/train_baseline.py` persists the fitted model to `models/gbm/` so the agent demo loads exactly the tested weights

To verify on a fresh machine:

```bash
git clone <repo> && cd gemma-4-hack
uv venv && source .venv/bin/activate
uv pip install -e '.[dev]'
python -m pytest tests/ -q              # Python tests
cd bakerysense-web && npm run verify    # typecheck + eslint + 106 workers tests + 7 unit tests
python scripts/train_baseline.py        # MASE < 1, saves models/gbm/
python scripts/demo_agent.py --tools-only
```

## Results

On the public **French Bakery Kaggle dataset** (matthieugimbert/french-bakery-daily-sales, 2021-2022, top-20 SKUs by volume, 28-day holdout, identical per-SKU fit + horizon for every method — see [`scripts/benchmark_vs_baselines.py`](scripts/benchmark_vs_baselines.py)):

| Forecaster | WAPE | MASE | pinball-q0.5 |
|---|---|---|---|
| Seasonal-naive (lag-7) | 0.341 | 1.000 | 3.27 |
| AutoARIMA (statsforecast)        | 0.548 | 1.610 | 5.26 |
| AutoETS (statsforecast)          | 0.271 | 0.796 | 2.60 |
| CrostonClassic (intermittent)    | 0.764 | 2.244 | 7.34 |
| **V1 LightGBM** (ours, with weather + lag-365) | **0.245** | **0.719** | **2.35** |
| **V1.5 population prior** (ours, family × dow median) | **0.212** | **0.623** | **2.04** |
| **V1.5 BLEND 50/50 prior+GBM** (ours) | **0.212** | **0.624** | **2.04** |
| **V1.5 PER-QUANTILE blend (Tier 4 — production)** (ours) | **0.212** | **0.623** | **2.04** |
| TimesFM-2.0-500m zero-shot               | 0.314 | 0.921 | 3.01 |
| **V1.5 PRIOR + TimesFM TAIL (Tier 6 — awaiting backend)** (ours) | **0.212** | **0.623** | **2.04** |

V1.5 population prior beats every classical baseline on the median forecast — the (family × dow) median is a remarkably stable point estimator because it ignores recent-shock noise. But the prior's `q0.9` is poorly calibrated for newsvendor (pinball **2.38** vs the GBM's **1.15**) because it's a static historical 90th percentile. **Per-quantile blend** (Tier 4) routes each quantile to the forecaster that wins it: prior owns `q0.4 / q0.5 / q0.6` (lower WAPE), GBM owns `q0.1 / q0.2 / q0.8 / q0.9` (calibrated tails), with a 50/50 ramp at `q0.3 / q0.7`. Multiplied by a `maturity = clip(actuals_count / 90, 0, 1)` factor so cold tenants still see pure prior. See [`bakerysense-web/src/lib/forecast-router.ts`](bakerysense-web/src/lib/forecast-router.ts).

**TimesFM-2 head-to-head** (`scripts/benchmark_timesfm.py`): zero-shot TimesFM-2.0-500m is **48% worse at the median** (WAPE 0.314) because it has no access to weather, holidays, or the corpus prior — but **5.3% better at the q0.9 tail** (pinball 1.091 vs GBM 1.153) because the decoder-only model has more honest tail calibration. Production target is **Tier 6 = prior median + TimesFM tail** which posts WAPE **0.212 (unchanged) / pinball-q0.9 1.091**, a strict improvement over Tier 4. The wiring is straightforward — Sprint 2's `predictTimesFM` stub returns the canonical 9-quantile output — but live inference is blocked on a backend (Cloudflare Container, Modal, or Replicate) since the 500M-param model doesn't fit a vanilla Worker.

LightGBM beats the seasonal-naive baseline on **19 of 20 SKUs**, with the largest wins on long-tail items (COOKIE, FICELLE, ECLAIR) where naive struggles most. Gemma 4 then translates these numbers into merchant-facing language via tool calls — see [`docs/demo_transcript.md`](docs/demo_transcript.md).

### Cross-dataset generalization

Same forecasters, three published benchmarks (`scripts/benchmark_nn5.py` + `scripts/benchmark_m4_daily.py`):

| Dataset | Domain | Best (V1.5) WAPE | Best published | Our delta |
|---|---|---|---|---|
| **French Bakery** | retail, weather, holidays | **0.212** | AutoETS 0.271 | **−22%** |
| **NN5 Daily** | ATM withdrawals (weekly only, no covariates) | 0.208 | AutoETS 0.192 | +8% |
| **M4 Daily** | heterogeneous (financial / demographic / industrial) | 0.342 | TimesFM-2 0.018 | far behind |

V1.5's (family × dow) population prior is a *correct* inductive bias for retail with strong weekly seasonality — it dominates French Bakery and is competitive on NN5 — but it's the *wrong* bias for non-seasonal heterogeneous data, where TimesFM-2 zero-shot is the right tool. The per-quantile architecture (Tier 6) generalizes: TimesFM-2 wins the q0.9 calibration on every dataset tested, so the production blend always benefits from routing the tail to it.

On M4 Daily the TimesFM-2.0-500m zero-shot result we measured (sMAPE 2.16) **beats every published M4 method** including the M4 winner Smyl ES-RNN (3.046) and the original TimesFM paper's own number (2.94, on the older 1.0-200m). That's the value of a recent foundation model. The lesson for the production system: route by data characteristics, don't blindly apply one forecaster.

## License

[CC-BY-4.0](./LICENSE). Competition winners are required to release their submission under this license ([Rules §2.5](https://www.kaggle.com/competitions/gemma-4-good-hackathon/rules)).

## Status

**Week 1** (complete)
- Scaffold, data loader (synthetic + real French Bakery support), features, LightGBM 7-quantile forecaster with save/load, newsvendor layer, SHAP explanations, agent tool surface, llama.cpp server wrapper, scripted/interactive demo, pytest suite.

**Week 2** (complete)
- P1 Foundation — D1 schema, Argon2id, JWT ES256 + JWKS rotation, refresh-token tombstones, CSRF double-submit, RBAC, tenant-scoped connectors (8 presets, OpenRouter OAuth) ✓
- P2 Forecasting Worker — pure-JS `gbm-walker` (700/700 parity with Python within 1e-4), R2 feature store + tree bundle, tool registry with 5 tools, Queue-driven agent loop, context compactor, SSE streaming ✓
- P3 UI — landing, tenant shell, dashboard (BakePlanTable + ConfidenceBar), SKU detail (QuantileChart + DriverBars + plain-language stat tiles + collapsible explainer), chat with SSE rendering and intuitive tool trace (forecast chips + driver bars), display-case photo → Gemma vision → markdowns, admin (connectors / data preview / users / branches / model & retraining / audit), account settings ✓
- P4 Feedback loop — `daily_actuals` + `forecast_snapshots` D1 tables, close-out-today dialog + inline "report actual" + CSV import, rolling WAPE badge on dashboard + drift banner on SKU detail, model-pointer KV layer for hot version-swap, retrain queue + manual trigger + training-inputs CSV export to R2, HMAC-signed `/api/internal/publish-model` with >10% rolling-MAE regression guard, `scripts/retrain_tenant.py` local retrain → publish flow ✓
- P5 E2E + submission — Playwright 7-scenario coverage of the demo journey (landing/signin/dashboard/SKU-detail/chat/display-case/signout; 5+6 fixme until LLM fixtures recorded), LLM fixture replayer (`BS_REPLAY_FIXTURES=1`), idempotent `seedDemo` + HMAC `POST /api/admin/seed-demo`, GitHub Actions E2E workflow, deploy + smoke docs, demo storyboard + narration script + ≤1500-word Kaggle writeup + cover image spec ✓
- V2 forecasting architecture (Sprints 0/1/3/4 shipped, Sprint 2 stubbed) — feature registry + per-tenant availability mask; cold-start router with population-prior fallback for new tenants; Open-Meteo weather ingestion + cultural festival lookup; hierarchical reconciliation (bottom-up + OLS-MinT); TimesFM-2 backbone interface stub. See [`docs/architecture/v2-migration.md`](docs/architecture/v2-migration.md). 39 new unit tests; total 104.
- V1.5 head-to-head benchmark — added `scripts/benchmark_vs_baselines.py` to fit AutoARIMA / AutoETS / CrostonClassic / SeasonalNaive per-SKU on the same 28-day × 20-SKU holdout, plus four accuracy upgrades: **(Tier 1)** maturity-weighted blend of population prior + GBM on warm/mature tenants; **(Tier 2)** added `lag_365` to the GBM features for year-over-year seasonality; **(Tier 3)** real Open-Meteo weather backfill (Paris archive) replaces the constant `temp_c=15.0 / precip_mm=0.0` placeholders — `humidity`, `wind_kmh`, `is_storm` columns flow through the GBM and the production V2 pipeline; **(Tier 4)** per-quantile alpha — at maturity the median stays with the prior (lower WAPE) and the tails switch to the GBM (calibrated q0.9 for newsvendor). The Tier 4 mature-tenant forecaster posts WAPE **0.2121 / MASE 0.623 / pinball-q0.9 1.15** — better median than every baseline including pure GBM, same calibrated tail as pure GBM. 14 new unit tests on the per-quantile blend; total 178.

**Week 3 / 4** (remaining)
- Record the demo video with the bakery owner against `docs/demo/script.md` / `storyboard.md`
- Deploy to Cloudflare Workers, seed the demo tenant, update the Live demo URL above
- Stretch: QLoRA fine-tune via Unsloth on bakery vocabulary · Ollama modelfile packaging · TimesFM cold-start sidecar · markdown policy calibration
