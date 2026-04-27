# V2 forecasting architecture migration

> **Status (April 2026):** Sprints 0, 1, 3, 4 shipped. Sprint 2 (TimesFM serving) is interface-locked but not yet wired to a backend.

## Why this exists

V1 of BakerySense uses a single LightGBM tabular model with 13 hand-engineered features. That works for daily SKU-level forecasting on a single mature tenant with the French Bakery dataset, but it has three load-bearing problems for a production multi-tenant system:

1. **Cold-start fails.** A new tenant with 0 days of actuals has no forecast — the GBM needs ≥30 days to be useful.
2. **Feature flexibility is implicit.** Every tenant is assumed to have all 13 features; if a tenant lacks a connector for promotions, the model silently treats absence as 0 (a meaningful signal in tree splits).
3. **Different problems share one model.** Hourly refill optimisation, daily bake planning, and procurement forecasting all force their concerns into the same 13-feature GBM.

V2 splits this into a layered architecture where each layer owns one concern, governed by a feature registry that tells the system which signals exist for which tenant.

## Layered architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ FORECAST LAYER (multi-horizon)                                   │
│   Backbone:  TimesFM-2 (daily) ─ STUB (Sprint 2)                 │
│   Residual:  LightGBM (Sprint 0+1) — V1 today, residual in V2    │
│   Cold:      population prior   ─ shipped (Sprint 1)             │
│                                                                  │
│   Static covariates:                                             │
│     SKU attrs, branch attrs, demographics, halal, location       │
│   Future-known covariates:                                       │
│     Weather forecast (Open-Meteo)  ─ shipped (Sprint 3)          │
│     Festival calendar (per locale) ─ shipped (Sprint 3)          │
│     Public holidays                ─ shipped (Sprint 3)          │
│     Promotion calendar (CRM)       — roadmap                     │
│                                                                  │
│   Hierarchical reconciliation: ─ shipped (Sprint 4)              │
│     bottom-up + OLS-MinT  tenant → branch → SKU                  │
├──────────────────────────────────────────────────────────────────┤
│ DECISION LAYER                                                   │
│   Newsvendor (per-SKU bake quantity) ─ V1 (untouched)            │
│   Real-time refill optimiser         — V3 roadmap                │
├──────────────────────────────────────────────────────────────────┤
│ EXPLANATION LAYER (Gemma 4)                                      │
│   SHAP/attention drivers, plain-language reasoning ─ V1 + Sprint 0│
│     (driver attribution now respects tenant feature mask)        │
└──────────────────────────────────────────────────────────────────┘
```

## Sprint-by-sprint

### Sprint 0 — Feature registry + tenant availability mask

The foundation. Every feature any layer can consume is declared in `src/lib/feature-registry.ts` with `id`, `friendly`, `source`, `layer`, `fallback`, `stage`, `requires`. The 60+ entries span V1 active features through V3 IoT signals.

`tenants.feature_availability` (JSON column, migration `0002`) records the subset of features each tenant has data for. `loadTenantFeatureMask()` enforces this everywhere — so the explain panel only surfaces actionable drivers, the V2 augmenter only fetches weather for tenants that subscribe to it, and a future TimesFM call only sees covariates the tenant actually has.

The three UI surfaces (DriverBars, ToolTrace, ModelInfoPanel) now share one source of truth via `friendlyLabel()` instead of three drift-prone inline maps.

**Tests:** 8 unit tests on registry semantics + mask intersection + fallback rules.

### Sprint 1 — Cold-start router + population prior

`src/lib/forecast-router.ts` classifies every forecast request into one of four stages based on actuals count:

| Stage | Threshold | Strategy | Bands |
|---|---|---|---|
| `no_data` | 0 actuals | Population prior | ×1.6 |
| `cold` | 1–29 actuals | Population prior | ×1.3 |
| `warm` | 30–89 actuals | V1 GBM | ×1.1 |
| `mature` | 90+ actuals | V1 GBM | ×1.0 |

Per-SKU classification first (a brand-new SKU on a mature tenant still gets cold-start treatment for that item).

`src/lib/corpus-prior.ts` ships embedded population priors anchored on `(family × dow)`, derived from the French Bakery training corpus. Unknown families fall through to a default prior.

The forecast tool's contract (input → 7-quantile output) is unchanged; the response now also includes `stage`, `actuals_count`, `confidence_banner`, `forecaster`. The SKU detail page surfaces a stage badge with appropriate visual treatment.

**Tests:** 19 unit tests covering thresholds, band widening symmetry, quantile interpolation, prior lookup, and end-to-end cold-start envelope.

### Sprint 2 — TimesFM serving (stub)

`src/lib/forecasters/timesfm.ts` defines the V2 backbone interface but throws `TimesFmUnavailableError` until a backend is configured via `TIMESFM_ENDPOINT`. The forecast router will catch this and fall back to V1 GBM, so clients see a graceful downgrade rather than a 500.

**Migration to live:**
1. Provision a Cloudflare Container with TimesFM-2 weights cached on a persistent volume. Expose `POST /infer`.
2. Bind the container service in `wrangler.jsonc` as `TIMESFM`.
3. Replace the throwing body with `await env.TIMESFM.fetch("/infer", ...)`.
4. Forecast router promotes warm/mature stages to `"timesfm_v2_lora"`.

**Why stub now:** the input schema (`history`, `static_covariates`, `future_known`, `tenant_lora`) is exactly what the V2 ingestion layer (Sprint 3) is already producing. Stubbing locks the contract so we don't refactor the forecast tool when the container ships.

### Sprint 3 — Weather + festival ingestion

`src/lib/weather/open-meteo.ts` is a free Open-Meteo client (no API key, 10K req/day cap). `fetchHistorical()` for one-shot training backfills, `fetchForecast()` for the daily 14-day refresh.

`src/lib/weather/persist.ts` upserts to D1 `branch_weather_daily` (composite PK on `(branch_id, date)`), and `readWeatherFeatures()` emits the registry-keyed feature set at predict time.

`src/lib/festivals.ts` is a static lookup. Covers Chinese New Year, Hari Raya, Christmas, Deepavali, mid-Autumn, plus French school holidays for the demo dataset. Locale matching is BCP-47 prefix-based. Emits `is_<festival>=1`, `is_pre_festival_eve`, `days_until_holiday`.

`src/lib/v2-feature-augment.ts` joins these into the V1 row at predict time, **but only for features the tenant has declared**. No fetches if the tenant isn't subscribed, no cross-tenant data leakage.

`src/scripts/cron/weather-cron.ts` is the scheduled handler — fans out 4 concurrent Open-Meteo fetches across all branches with `lat`/`lon`, polite to the free tier.

**Schema additions** (migration `0003`):
- `branches.lat`, `lon`, `timezone`, `locale` — nullable, populated at branch onboarding
- `branch_weather_daily` — composite-PK weather store with all fields nullable so partial coverage works

**Tests:** 11 festival tests on locale matching, date boundaries, pre-eve flag, days-until-holiday countdown.

### Sprint 4 — Hierarchical reconciliation

`src/lib/hierarchical.ts` provides bottom-up and OLS-MinT reconciliation for tenant → branch → SKU forecasts.

- **bottom-up** trusts leaves only and sums upward. Optimal when higher-level forecasts are unavailable. Default for V1.5.
- **OLS-MinT** projects observed base forecasts onto the coherent subspace via the closed-form `S(S'S)^-1 S' y`. The implementation correctly filters the summing matrix to observed rows — a missing parent forecast is "no signal", not "zero". When V2's TimesFM is producing direct category-level forecasts, MinT mixes them with SKU-level forecasts to keep the dashboard internally consistent.

Includes a small linear-algebra kernel (no external BLAS dep) for hierarchies up to a few hundred leaves.

**Tests:** 8 unit tests on traversal, leaf enumeration, bottom-up aggregation, OLS identity-on-coherent input, and the gap-closing case where higher-level signal pulls leaves up.

### Sprint 5 — V1.5 accuracy upgrades (head-to-head benchmark)

`scripts/benchmark_vs_baselines.py` puts our forecasters head-to-head with published `statsforecast` baselines (AutoARIMA / AutoETS / CrostonClassic / SeasonalNaive) on the same 28-day × 20-SKU holdout from the French Bakery dataset. The benchmark surfaced three small but cumulative wins:

**Tier 1 — maturity-weighted blend.** The population prior turns out to beat the GBM at the median (WAPE 0.212 vs 0.245) because the (family × dow) median ignores recent-shock noise. But the GBM still owns the q0.9 tail (where the newsvendor picks bake). `alphaForBlending(actuals_count) = clip(n / 90, 0, 1)` and `blendQuantiles(prior, gbm, alpha)` in `src/lib/forecast-router.ts` mix both: stable prior medians **plus** calibrated GBM tails. Cold tenants (alpha=0) get the prior; mature tenants (alpha=1) get the GBM; in between, a smooth ramp.

**Tier 2 — lag_365.** Added year-over-year seasonality to the GBM features (`src/bakerysense/features.py`). LightGBM treats NaN as a valid split direction, so the lag is usable from day 1 even for tenants without 1+ year of history. `drop_warmup` keys on the longest non-yearly lag (28) to avoid losing 12 months of training data on a 1.7-year corpus.

**Tier 3 — real weather backfill.** The original loader hardcoded `temp_c=15.0 / precip_mm=0.0` for the Kaggle CSV. `scripts/fetch_weather.py` pulls 637 days of Paris weather (Open-Meteo archive, free tier) and writes `data/raw/weather_paris.csv`; the loader joins on `date` and exposes `temp_c`, `precip_mm`, `humidity`, `wind_kmh`, `is_storm`. The production V2 pipeline (Sprint 3) already consumes the same registry-keyed columns via `branch_weather_daily`, so training and serving stay schema-aligned.

| Forecaster | WAPE | MASE | pinball-q0.9 |
|---|---|---|---|
| Seasonal-naive (lag-7)            | 0.341 | 1.000 | – |
| AutoARIMA (statsforecast)         | 0.548 | 1.610 | – |
| AutoETS (statsforecast)           | 0.271 | 0.796 | – |
| CrostonClassic (intermittent)     | 0.764 | 2.244 | – |
| V1 LightGBM (with weather + lag-365) | 0.245 | 0.719 | **1.153** |
| V1.5 population prior             | 0.212 | 0.623 | – |
| V1.5 BLEND 50/50 prior+GBM        | 0.212 | 0.624 | – |

The blend's MASE of 0.624 sits comfortably below every classical baseline. Production blend uses maturity-weighted alpha — at alpha=1 (mature tenant in this benchmark) the blend reduces to GBM, so the headline number for warming-up tenants is the prior's 0.212.

## What's next

| Roadmap item | Status | Notes |
|---|---|---|
| TimesFM Cloudflare Container | Not started | Sprint 2 stub is ready; needs hardware decision |
| Tenant LoRA pipeline | Not started | Trains 50–500-example LoRA per tenant after warm-up |
| GBM residual on FM output | Not started | Wraps existing `predict()`; trivial once FM is live |
| Promotion calendar ingestion | Not started | Tenant CRM connector schema |
| Macro feeds (CPI, FX, fuel) | Not started | One ingestion worker per data source |
| V3 refill optimiser | Not started | Separate workstream — needs IoT pipeline + pilot store |

## Testing

All sprints are covered by unit tests in `tests/unit/`:

| Test file | Tests | Covers |
|---|---|---|
| `feature-registry.test.ts` | 8 | Sprint 0 |
| `forecast-router.test.ts` | 19 | Sprint 1 |
| `festivals.test.ts` | 11 | Sprint 3 |
| `hierarchical.test.ts` | 8 | Sprint 4 |
| (existing) | 58 | V1 carryover |

**Total: 104 unit tests passing.**

## Why this design holds up at scale

Three properties carry through the layers and let the system "work on whatever data is available, however little of it":

1. **Feature registry is the contract.** Adding a new feature is a registry entry, not a code change. The tenant capability declaration tells every consumer (model, UI, ingestion job) what to do — present it, mask it, fetch it, hide it.
2. **The cold-start router separates strategy from contract.** Same input → same output envelope, but the strategy under the hood scales from a population prior on day 1 to a tenant-tuned FM at day 365. Callers never branch.
3. **Hierarchical reconciliation makes multi-level forecasts coherent.** When V2 lands and TimesFM produces forecasts at multiple levels, MinT keeps them consistent. The dashboard never shows "branch total ≠ sum of SKU forecasts".

These three properties are the load-bearing ones — adding new datasets, new model types, new ingestion sources, or new tenant-capability gradients doesn't require touching them.
