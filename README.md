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

On the public **French Bakery Kaggle dataset** (matthieugimbert/french-bakery-daily-sales, 2021-2022, top-20 SKUs by volume, 28-day holdout):

| Metric | Seasonal-naive (lag-7) | LightGBM q=0.5 |
|---|---|---|
| WAPE | 0.341 | **0.249** |
| MASE | 1.000 | **0.731** |

LightGBM beats the naive baseline on **19 of 20 SKUs**, with the largest wins on long-tail items (COOKIE +24.5 pp, FICELLE +22.8 pp, ECLAIR +21.2 pp) where naive struggles most. Gemma 4 then translates these numbers into merchant-facing language via tool calls — see [`docs/demo_transcript.md`](docs/demo_transcript.md).

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

**Week 3 / 4** (remaining)
- Record the demo video with the bakery owner against `docs/demo/script.md` / `storyboard.md`
- Deploy to Cloudflare Workers, seed the demo tenant, update the Live demo URL above
- Stretch: QLoRA fine-tune via Unsloth on bakery vocabulary · Ollama modelfile packaging · TimesFM cold-start sidecar · markdown policy calibration
