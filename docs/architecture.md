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

## Web layer (Cloudflare Workers + Next.js)

The `bakerysense-web/` directory is a Next.js 16 app deployed to Cloudflare Workers via `@opennextjs/cloudflare`.

### Persistence — Cloudflare D1 + Drizzle ORM

Binding: `env.DB` (D1Database). Client helper: `src/db/client.ts::getDb(env)`.

Schema (6 tables, `drizzle/0000_init.sql`):

```
tenants           — slug, name, vertical, plan
users             — email, password_hash, email_verified
memberships       — user_id → users, tenant_id → tenants, role enum
branches          — tenant_id → tenants, name, city, cluster, type
branch_access     — membership_id × branch_id (composite PK)
audit_log         — tenant_id, actor_user_id, action, target, metadata_json
```

### KV

Binding: `env.KV` (KVNamespace). Used for session cache, short-lived tokens, JWKS, and per-tenant connector records.

#### Connector KV scheme

| KV key | Contents |
|---|---|
| `connector:tenant:<tid>:index` | `{ connectorIds: string[], defaultId: string \| null }` |
| `connector:tenant:<tid>:<connId>` | `Connector` JSON — credential AES-256-GCM encrypted with `CONNECTOR_MEK` |

See `bakerysense-web/src/lib/connector.ts` for CRUD helpers and `src/lib/connector-presets.ts` for the 8 built-in provider presets.

### Secrets

Injected via `wrangler secret put` (production) or `.dev.vars` (local):
`SESSION_SIGNING_KEY`, `JWKS_ENCRYPTION_KEY`, `CONNECTOR_MEK`, `OPENROUTER_API_KEY`, `OPENROUTER_OAUTH_CLIENT_ID`, `OPENROUTER_OAUTH_CLIENT_SECRET`, `OPS_ROTATE_SECRET`.

### UI layer (Next.js App Router)

The web surface is tenant-scoped at `/t/[slug]/*`. Session is ES256 JWT in an HttpOnly `bs_at` cookie, accompanied by a CSRF token in a readable `bs_csrf` cookie; every mutating request carries the CSRF token in the `X-CSRF-Token` header, auto-injected by `src/lib/api-client.ts::apiFetch`. `src/lib/use-session.ts` is the React hook that loads `/api/auth/me`.

Pages (`src/app/`):

```
/                              landing (stats + sample exchange)
/signin, /signup               auth (P1)
/t/[slug]/layout.tsx           shell — Nav, BranchSelector, UserMenu, StatusBadge
/t/[slug]/dashboard            today's bake plan (BakePlanTable + ConfidenceBar)
/t/[slug]/sku/[family]         quantile band + SHAP drivers + trend sparkline
/t/[slug]/chat                 Gemma conversation, SSE-streamed tool trace + answers
/t/[slug]/display-case         photo upload → Gemma vision → markdown suggestions
/t/[slug]/admin/connectors     per-tenant LLM connector CRUD + OpenRouter OAuth
/t/[slug]/admin/branches       branch CRUD
/t/[slug]/admin/users          member invite + role change + remove
/t/[slug]/admin/audit          last 100 audit-log entries
/account/settings              password change + dev BYOK overrides (localStorage)
```

Components (`src/components/`):

```
shell/       Nav, BranchSelector, UserMenu, StatusBadge, TenantHeader, ErrorBoundary
forecast/    ConfidenceBar, BakePlanTable, QuantileChart, DriverBars, TrendLine (hand-rolled SVG)
feedback/    CloseOutDayDialog + CloseOutDayTrigger, ReportWrongForecastButton
chat/        ChatThread, MessageBubble, ToolTrace, PromptInput, TurnStatus
display-case/PhotoUpload, CountsTable, MarkdownList
admin/       ConnectorList/Form/Test, MemberTable, InviteDialog, BranchTable/Editor, AuditLogTable
account/     PasswordChange, DevOverridesPanel
```

REST endpoints added by P3 that dispatch directly to the tool registry (bypassing Gemma) for the dashboard and detail pages:

```
GET  /api/skus?branch=         → list_skus
GET  /api/forecast/[family]    → forecast
GET  /api/explain/[family]     → explain_drivers
GET  /api/forecast/batch       → list_skus then forecast per SKU
POST /api/photo                → direct multimodal fetch to connector + suggest_markdowns
```

REST endpoints added by P4 for merchant actuals feedback:

```
POST /api/actuals              → upsert actual (branchId, family, date, actualBake?, actualSales?, wasteUnits?, recommendedBake?, source?)
GET  /api/actuals?branch=      → list actuals for a branch
```

The P4 feedback loop adds two client components to the dashboard:
- **`CloseOutDayDialog`** — fixed-position modal (portal-less) opened by a "Close out today" button in the dashboard header. Renders a table of all forecast SKUs with `actual_bake` and `actual_sales` number inputs. On save, fires `N` parallel `POST /api/actuals` calls (skipping blank rows). Managed by a co-located `CloseOutDayTrigger` client component that holds the `open` state.
- **`ReportWrongForecastButton`** — inline ghost button in each `BakePlanTable` row that expands an absolute-positioned popover with a single `actualSales` input. Closes on outside click or after successful submit; shows a "Saved" indicator for 2 seconds.

Visual identity: Geist Sans + Geist Mono, oklch design tokens in `src/app/tokens.css` (honey-amber bakery default, swappable for future verticals), Tailwind 4 utilities over token CSS variables. No chart library — all charts are hand-rolled SVG.

Test matrix (Cloudflare Miniflare workers pool via `@cloudflare/vitest-pool-workers`, plus happy-dom for pure unit tests): 106 workers tests (auth/refresh/JWKS rotation/RBAC matrix/multi-tenant isolation/connector CRUD/chat turn/dashboard-flow/chat-ui-smoke/admin-connectors-flow/actuals-flow/metrics-rolling-wape/retrain-pipeline) + 7 unit tests (ConfidenceBar SVG render + pure-math metrics: wape + driftDetected), all passing.

## Feedback loop (P4)

A closed loop between the merchant's own actuals and the model that serves them forecasts. Two new D1 tables, four new KV keys, one new R2 prefix, one new queue, and one signed publish endpoint.

### New D1 tables (`drizzle/0001_feedback_loop.sql`)

```
daily_actuals         tenant × branch × family × date grain — what actually happened
                      (recommended_bake, actual_bake, actual_sales, waste_units, source)
forecast_snapshots    tenant × branch × family × date × model_version — what we forecast
                      (bake_quantity, quantiles_json, served_at)
```

`daily_actuals` carries a unique index on `(tenant_id, branch_id, family, date)` so repeated captures for the same SKU-day upsert in place. `forecast_snapshots` is idempotent on `(tenant, branch, family, date, model_version)` so calling `/api/forecast/...` multiple times for the same day doesn't pile up snapshots.

### New KV keys (`src/lib/model-pointer.ts`)

```
model:active:<tid>        → { version, treesR2Key, featuresR2Key, trainedAt, rollingMae }
model:versions:<tid>      → [{ version, trainedAt, metrics, treesR2Key, featuresR2Key }, ...] (last 20)
retrain:last:<tid>        → { status: idle|queued|running|awaiting_publish|published|aborted, startedAt?, finishedAt?, outcome?, reason? }
```

`src/lib/features.ts` resolves tree + feature R2 keys through the active pointer; its in-memory cache is keyed by `${tenantId}:${version}` and a new version bump evicts the stale entry automatically. Fresh tenants (no pointer written yet) fall back to the seed paths `tenant:<tid>/trees/latest.json` and `tenant:<tid>/features/latest.json`, so day-1 tenants work unchanged.

### New R2 layout

```
bakerysense-models/
  tenant:<tid>/training-inputs/<yyyymmddHHMMSS>.csv   queue consumer output
  tenant:<tid>/v<n>/trees/latest.json                 published by Python retrain script
  tenant:<tid>/v<n>/features/latest.json              published by Python retrain script
```

### REST endpoints

```
POST /api/actuals                           record one SKU-day (merchant close-out)
GET  /api/actuals?branch=                   list recent actuals for a branch
PATCH /api/actuals/:id                      update/correct a row
DELETE /api/actuals/:id                     remove a row
POST /api/actuals/bulk                      CSV import (tenant_admin only)
GET  /api/actuals/metrics?branch=&window=   rolling WAPE per family

POST /api/admin/retrain                     enqueue a retrain job (tenant_admin only)
GET  /api/admin/retrain/history             active pointer + last 20 versions + retrain state
POST /api/internal/publish-model            HMAC-signed — called by the retrain script to
                                            update the active model pointer + append history
```

Every mutation writes an audit event: `actuals.recorded`, `actuals.updated`, `actuals.deleted`, `actuals.bulk_imported`, `retrain.enqueued`, `retrain.published`, `retrain.aborted`, `drift.detected`.

### Pipeline

```
Merchant clicks "Trigger retrain now" in /t/[slug]/admin/retraining
  → POST /api/admin/retrain   (tenant_admin + CSRF)
  → env.RETRAIN_QUEUE.send({ type: "retrain", tenantId, triggeredBy: "manual", triggeredAt })
  → retrain:last:<tid> = { status: "queued", startedAt }

Queue consumer (src/lib/queue-consumer.ts routes by batch.queue)
  → handleRetrainMessage(env, job)
  → buildTrainingCsv pulls 180 days of actuals + snapshots
  → uploadTrainingInputs writes to R2 tenant:<tid>/training-inputs/<ts>.csv
  → retrain:last:<tid> = { status: "awaiting_publish", reason: <r2_key> }

Operator (for MVP — Cloudflare Container is future work)
  → wrangler r2 object get bakerysense-models/<r2_key> > ./training-inputs.csv
  → python scripts/retrain_tenant.py --tenant <tid> --training-csv ... \
                --new-version <n> --publish --ops-secret $OPS_ROTATE_SECRET

scripts/retrain_tenant.py
  → trains LightGBM × 7 quantiles with identical DEFAULT_PARAMS as the seed model
  → exports trees + features JSON
  → POSTs canonical JSON + HMAC sha256 signature to /api/internal/publish-model

/api/internal/publish-model (HMAC-signed with OPS_ROTATE_SECRET)
  → verify sig via constant-time compare
  → Zod-validate body; regression guard (new rollingMae > 1.1 * baseline → 409 abort)
  → otherwise: model:active:<tid> ← new pointer, model:versions:<tid> ← append
  → retrain:last:<tid> = { status: "published", finishedAt }
  → audit retrain.published

Next forecast request
  → features.ts reads model:active:<tid>, loads the new tree bundle from R2
  → cache automatically invalidated by version-keyed cache; no redeploy needed
```

### Cron wiring (deferred)

`bakerysense-web/src/scripts/cron/retrain-cron.ts` is a scheduled handler that enumerates tenants with ≥30 `daily_actuals` rows and enqueues a retrain per tenant on a weekly cadence. It is NOT wired into `wrangler.jsonc` — same pattern as the P1 JWKS rotation cron. Reason: OpenNext's default Worker entry doesn't expose `scheduled()` hooks. To enable, deploy as a separate Worker script with its own entry. Manual retrain via `/api/admin/retrain` covers the hackathon demo.

### Container wiring (deferred)

Spec §14.3 envisions the Python retrain running inside a Cloudflare Container wired to the consume side of `retrain-queue`. The MVP ships the Python script (`scripts/retrain_tenant.py`) run locally by the operator — the pipeline shape (queue → training-inputs CSV in R2 → signed publish callback) is identical; only the execution site differs. Container binding is future work.

### Quality surfacing (UI)

`/t/[slug]/dashboard` parallel-fetches `/api/actuals/metrics?window=7` alongside `/api/forecast/batch` and renders a `<QualityBadge>` beside each SKU row (green/amber/red by WAPE, "no signal" if <3 samples).

`/t/[slug]/sku/[family]` renders a `<DriftBanner>` above the charts when `window=14` rolling WAPE exceeds `1.5 × baseline_wape`. Baseline is a hardcoded 0.25 fallback for MVP (R2 `baseline-metrics.json` per-tenant is future work); the banner links to `/t/[slug]/admin/retraining`.

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
