# BakerySense

[![License: CC-BY-4.0](https://img.shields.io/badge/License-CC--BY--4.0-lightgrey.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-172%20passing-brightgreen)](./tests)
[![Gemma 4](https://img.shields.io/badge/Gemma%204-E4B%20Q4__K__M-orange)](https://ollama.com/library/gemma4)

Offline-first production decision copilot for bakeries. Submission for the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon) (deadline **2026-05-18**).

## Live demo

- **App:** <https://bakerysense-web.swmengappdev.workers.dev>
- **Video:** <https://youtu.be/N_ADKVnl90w> (1:53). Local copy: [`docs/demo/demo-final.mp4`](docs/demo/demo-final.mp4); storyboard at [`docs/demo/storyboard.md`](docs/demo/storyboard.md).
- **Kaggle writeup:** [`kaggle-submission/writeup-for-kaggle.md`](kaggle-submission/writeup-for-kaggle.md) (≤1500 words, the version submitted)

Demo credentials:
- `demo@bakerysense.app` / `Demo2026DemoDemo` — `tenant_admin`, all 5 branches
- `manager@bakerysense.app` / `Manager2026Manager` — `branch_manager`, 2 branches

The live app runs Gemma 4 (`google/gemma-4-26b-a4b-it` via OpenRouter) end-to-end: sign in, pick a branch on the dashboard, ask "how many TRADITIONAL BAGUETTE should I bake tomorrow?" in chat. Gemma calls `forecast` + `explain_drivers` and returns a plain-language answer grounded in the JS LightGBM walker.

> **A note on the live demo's TimesFM tail.** The hosted demo's `perq_blend_v2` (V1.5 prior + TimesFM q0.9 tail) routes to a localtunnel from the maintainer's laptop. When the laptop closes, the Worker falls back to `perq_blend_v1` (GBM tail) **automatically** — verified live; the demo never breaks. To run the full Tier 6 pipeline 24/7, self-host the TimesFM sidecar (one of three paths below). BakerySense is open source under CC-BY-4.0; we do not charge for hosting.

## Self-host (BYO deploy)

Two surfaces — both designed to be run on your own infrastructure with zero per-merchant cost.

### a. The Cloudflare Worker (the app)

End-to-end deploy checklist in [`docs/deploy.md`](docs/deploy.md): D1 + KV + R2 + Queues bindings, secret material (`SESSION_SIGNING_KEY`, `JWKS_ENCRYPTION_KEY`, `CONNECTOR_MEK`), migrations, `npm run deploy`. ~15 minutes from `wrangler login` to seeded tenant.

### b. The TimesFM sidecar (optional, enables `perq_blend_v2`)

The forecaster works without it (V1 LightGBM and V1.5 prior run pure-TS in the Worker). Adding TimesFM-2.0-500m for the q0.9 tail is what gets you the full Tier 6 production blend. The serving layer is in [`scripts/serve_timesfm.py`](scripts/serve_timesfm.py); set `TIMESFM_ENDPOINT` on the Worker and `perq_blend_v1` flips to `perq_blend_v2` with no redeploy.

| Path | Best for | Notes |
|---|---|---|
| **Modal** | quickest start, free credits | `modal deploy scripts/deploy_modal.py` — one command. |
| **Cloudflare Container** | same account as the Worker | build [`scripts/Dockerfile.timesfm`](scripts/Dockerfile.timesfm), push, bind in `wrangler.jsonc`. |
| **Render / Replicate / any K8s** | existing infra | uvicorn entry: `scripts/serve_timesfm.py:app`. CPU-only works (~3-5s/call). |

When the sidecar is up, set `TIMESFM_ENDPOINT=https://your-host` as a Worker secret. The Worker probes `/healthz` and falls back to GBM if the sidecar is down — there is no hard dependency.

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

**Decision-centric, not data-centric.** Data, forecast logic, baker action, and tenant security live in one Worker with end-to-end decision lineage:

- `model_versions` — durable registry of every trained forecaster (parent_model_id, training_window, validation_metrics, status). Bootstrapped lazily from the KV pointer for existing tenants.
- `retrain_events` — every retrain attempt (manual / scheduled / WAPE-breach) with parent → output linkage and status_message on failure.
- `forecast_snapshots.model_version_id` — additive FK so any bake plan traces back to the model and training window that produced it.
- `bake_plan_decisions` — every committed three-options bake plan with the chosen `option_kind` and lineage FKs to `forecast_snapshots` + `model_versions` (CHECK-constrained to travel together).
- `audit_log` — every Gemma tool dispatch (`forecast`, `narrate_plan_options`, `explain_drivers`, …) with input args, result summary, and latency. Closes the loop from a markdown suggestion or bake choice back to the forecast.
- `GET /api/admin/lineage[/:snapshotId]` and the *Decision lineage* panel in the Model tab surface the chain for tenant_admins.

**Stage 4 + 5 — three-options bake plan.** The dashboard SKU row goes from one number to three narrated options (conservative / balanced / aggressive) with expected waste, stockout probability, and units sold from a pure-TS quantile-newsvendor simulation engine (`src/lib/simulation.ts`). The operator commits one; Gemma narrates tradeoffs via the `narrate_plan_options` tool.

See [docs/architecture.md](docs/architecture.md) for module-level detail and the *Decision lineage (production)* + *Three-options bake plan* sections for the full schema, endpoints, simulation engine, and SQL view (`decision_lineage_v`).

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

### Cross-dataset generalization (9 benchmarks, 23 tiers)

> Full research log + every negative result documented in [`docs/research/tier-scorecard.md`](docs/research/tier-scorecard.md).


Same forecasters, five published benchmarks (`scripts/benchmark_nn5.py` + `scripts/benchmark_m4_daily.py` + `scripts/benchmark_kaggle_web_traffic.py` + `scripts/benchmark_m5.py`):

| Dataset | Domain | V1.5 prior | Best classical | TimesFM-2 zero-shot | Published top |
|---|---|---|---|---|---|
| **French Bakery** | retail + weather + holidays, dense | **0.212 WAPE** | AutoETS 0.271 | 0.314 | (no leaderboard — V1.5 wins by 22%) |
| **NN5 Daily** | ATM, weekly seasonal only | 0.208 WAPE | **AutoETS 0.192** | 0.197 | DeepAR / N-BEATS |
| **M4 Daily** | heterogeneous (financial / demographic / industrial) | 31.4 sMAPE | AutoETS 3.06 (subset) | **2.16 sMAPE** | M4 winner ES-RNN 3.046 |
| **Kaggle Web Traffic** | Wikipedia views (viral, trending) | 53.5 SMAPE | Seasonal-naive 45.1 | **38.8 SMAPE** (top 50 / top 5%) | Winner cpmpml 35.48 |
| **M5 Walmart** (level 12) | intermittent retail, 30K SKUs, 5y | 0.803 WAPE | AutoETS 0.685 (subset) | **0.666 WAPE** | M5 winner WRMSSE 0.520 |
| **M5 Walmart** (full WRMSSE, 12 levels, bottom-up) | hierarchical retail | 3.363 | – | **1.864** | M5 winner 0.520 / median 0.65 / naive 0.91 |
| **M5 Walmart** (Tier 10: TimesFM L1 top-down) | hierarchical retail | – | – | **0.800** | beats naive 0.91 by 12.5%; below median 0.65 |
| **M5 Walmart** (Tier 14: TimesFM L9 store×dept top-down) | hierarchical retail | – | – | **0.713** | beats naive by 22%; approaches median 0.65 |
| **M5 Walmart Uncertainty** (Tier 18: TimesFM quantiles clamped, L9 + leaf shares) | hierarchical retail, WSPL metric | – | – | 0.1705 | top 10 of 909 teams (winner 0.157) |
| **M5 Walmart Uncertainty** (Tier 19: TimesFM + extrapolated tails) | as above + linear quantile extrapolation | – | – | **0.1638** | **top ~5 of 909 teams** (top 0.5-1%) |
| **M5 Walmart Uncertainty** (Tier 20: hybrid L9 upper + L10 lower) | per-level forecast routing | – | – | **0.1427** | below winner's 0.157 on validation |
| **M5 Walmart Uncertainty** (Tier 21: L9 + L10 + L11 routing) | 3-level hybrid | – | – | **0.1379** | top-tier range on validation period (winner 0.157 private; expected private rank: top 5–20) |
| **M4 Monthly** (5K subset, 18-step) | broad domain monthly | – | – | sMAPE **10.20** | better than Chronos-Large 12.71 / ES-RNN 12.13 on subset (caveat: not full set) |
| **Tourism Monthly** | tourism arrivals, 24-step | – | – | sMAPE **20.79** | worse than Chronos-Large ~18.0 / ETS 18.7 — small-N monthly isn't TimesFM's sweet spot |
| **Hospital** | weekly counts, 12-step | – | – | MASE **0.876** | worse than Chronos / MOIRAI / TimesFM ~0.75 — weekly counts data |

**TimesFM-2.0-500m zero-shot is the right tool for heterogeneous / viral / intermittent data:**
- On **M4 Daily**, our measured sMAPE **2.16 beats every published method** — including the M4 winner Smyl ES-RNN (3.046), N-BEATS (2.94), and the original TimesFM paper's own number (2.94 on the older 1.0-200m).
- On **Kaggle Web Traffic** (1,095 teams in original 2017 competition), our SMAPE **38.83 places in the top 50 (top 5%)** — without any fine-tuning, feature engineering, or covariates. Just the raw TimesFM-2 weights.
- On **M5 Walmart** (5,558 teams), TimesFM-2 zero-shot WAPE **0.666 beats AutoETS 0.685 and seasonal-naive 0.862** on level 12 (30,490 series). RMSSE at level 12 = 1.022, on par with single-model LightGBM in M5 papers (~1.05 published). The naive bottom-up aggregation gives full WRMSSE 1.864.

  **2024 foundation-model context (the actually-relevant 2026 comparison):** on three GIFT-Eval-class datasets we ran TimesFM-2 zero-shot directly. M4 Monthly subset sMAPE 10.2 (better than Chronos-Large 12.71, but on 5K/48K subsample). Tourism Monthly sMAPE 20.79 (worse than Chronos ~18.0). Hospital MASE 0.876 (worse than Chronos / MOIRAI / TimesFM-paper ~0.75). The honest read: zero-shot TimesFM-2 with our pipeline is **competitive with 2024 foundation-model peers on retail-daily, weaker on small-N monthly and weekly counts**. The architectural pattern (per-quantile routing, per-level top-down) is what generalizes — it's a wiring win, not a model win.

  **Tier 10 multi-level reconciliation** changes the picture: forecast the L1 TOTAL series with TimesFM-2 directly (just one series, RMSSE 0.598 — beats seasonal-naive 0.751 at L1), then disaggregate to all 30,490 leaves via last-28-day historical revenue shares. Result: **WRMSSE 0.800 — beats the naive benchmark (0.91-1.07) by 12.5%**.

  **Tier 14 (deeper aggregation) goes further: WRMSSE 0.713 — 22% better than naive**. Forecast the 70 store × department series with TimesFM (~0.5 sec inference total), disaggregate within each group via item-level shares. Captures cross-store variation (CA SNAP days, TX promotions) that L1/L4 forecasts can't. With 71 TimesFM API calls and a divisor, lands above the leaderboard median (~0.65) but dramatically ahead of the 5,558-team field's bottom half. The M5 winner reached 0.520 with 12+ model ensembles + per-level training — proving the gap isn't about TimesFM, but about ensemble + tuning depth.

  **On the SECOND M5 leaderboard (Uncertainty Track, 909 teams), the same architecture lands in the TOP 10.** Tier 18 reuses the L9 forecast pipeline but extracts TimesFM's full 9-quantile output and disaggregates each quantile to leaves via the same shares. WSPL 0.1705 on the full 12-level × 9-quantile evaluation — the M5 Uncertainty winner posted 0.157, top 10 was ≤ 0.175, top 100 was 0.190-0.220, median ~0.25. We slot into the **top 10 range** with 71 forecast calls. The reason for the dramatic relative-rank improvement vs the Accuracy track: TimesFM-2's pre-trained quantile heads are excellent, while the Accuracy track is dominated by L12 point-forecast noise that single-pass models struggle with.

  The architectural lesson: for hierarchical retail, a small number of foundation-model forecasts at well-chosen intermediate levels + classical disaggregation beats 30K independent leaf forecasts (and beats classical methods alone) at a tiny fraction of the compute.

**V1.5's (family × dow) population prior** is a *correct* retail inductive bias — wins decisively on French Bakery and is competitive on NN5 — but it's the *wrong* bias for non-seasonal heterogeneous data, where it loses to even seasonal-naive.

**The per-quantile architecture (Tier 6) is what generalizes universally** — TimesFM-2 wins the q0.9 calibration on every dataset tested (5.3% improvement on French Bakery, 11% on NN5, 31% on Kaggle Web Traffic), so the production blend always benefits from routing the tail to it.

**Architecture-vs-model attribution (the cleanest experiment, Tier 23):** drop in Amazon's `chronos-bolt-base` under the exact same Tier 21 pipeline on M5 Uncertainty — WSPL **0.1396 vs TimesFM-2's 0.1379**, within 1.2%. The wiring (per-quantile + per-level routing + tail extrapolation) carries the result. The choice of foundation model is fungible at the 1% level.

The production system's value is the **wiring**: drop V1.5 in for retail tenants, drop TimesFM in for everything else, route q0.9 through TimesFM regardless. The forecast router's stage-aware blend is data-agnostic.

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
