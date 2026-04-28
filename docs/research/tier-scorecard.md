# Tier Scorecard — 23-tier experimental record

This document is the consolidated research log for the V1.5 / V2 architecture
work. Each "Tier" is a discrete experiment with a falsifiable claim. We document
both wins and negative results because the negatives are as architecturally
informative as the positives.

The production system runs **Tier 1 + Tier 4 + Tier 6** (live in
`bakerysense-web` worker `c91217e7`). Tiers 7-23 are research findings that
inform the architecture but aren't all wired into the live worker.

---

## At a glance

| Tier | Description | Status | Headline |
|---|---|---|---|
| 1 | Maturity-weighted blend (prior + GBM) | shipped + LIVE | smooth ramp from cold to mature |
| 2 | `lag_365` feature | shipped | wash on 1.7y French Bakery; helps M5/Favorita |
| 3 | Real Open-Meteo weather backfill | shipped | -1.8% relative WAPE on the GBM |
| 4 | Per-quantile alpha (prior median + GBM tails) | **shipped + LIVE** | `WAPE 0.212`, the production WAPE on French Bakery |
| 5 | Per-SKU alpha tuning | NEGATIVE | overfits 28-day valid set; documented |
| 6 | TimesFM tail at q0.9 | **shipped + LIVE** | -5.3% q0.9 pinball, generalises across datasets |
| 7 | Conformal calibration | small lift | 0.3% on GBM; counterproductive on overcovered prior |
| 8 | Hierarchical OLS-MinT (French Bakery) | NEGATIVE on FB | wins on M5 → Tier 10 |
| 9 | TimesFM + linear xreg covariates | partial lift | -3.8% over zero-shot, doesn't catch V1.5 |
| 10 | M5 L1 top-down disaggregation | shipped path | `WRMSSE 0.800`, beats naive 0.913 |
| 11 | TimesFM + GBM residual | NEGATIVE | needs rolling-origin training; documented |
| 12 | M5 L4 top-down | partial | `WRMSSE 0.792` |
| 13 | M5 L1 + L4 50/50 blend | wash | `WRMSSE 0.792`, no improvement |
| **14** | **M5 L9 (store × dept) top-down** | **best single-pass M5 Accuracy** | **`WRMSSE 0.713`** |
| 15 | M5 L11 top-down (too granular) | NEGATIVE | `WRMSSE 1.136`, errors compound |
| 16 | sNaive at L9 + leaf shares | counterfactual | `WRMSSE 0.852` (TimesFM contributes 2/3 of T14 win) |
| 17 | dow-aware leaf shares | NEGATIVE | `WRMSSE 0.721`, noisier than static |
| 18 | M5 Uncertainty L9 quantiles, clamped | win | `WSPL 0.171` (top 10 of 909) |
| 19 | + linear quantile-tail extrapolation | win | `WSPL 0.164` (top 5) |
| 20 | + L10 forecast for L10/L11/L12 | win | `WSPL 0.143` |
| **21** | **+ L11 (3-level hybrid)** | **best M5 Uncertainty** | **`WSPL 0.138`** |
| 22 | GIFT-Eval comparison vs Chronos / MOIRAI papers | mixed | wins on M4 daily, loses on Tourism + Hospital |
| **23** | **Chronos-Bolt + Tier 21 architecture** | **architecture-vs-model proof** | **`WSPL 0.140` — 1.2% delta from TimesFM** |

---

## Forecasters and datasets covered

**Forecasters tested:**
- V1 LightGBM (with weather + lag-365)
- V1.5 population prior (`family × dow` median)
- V1.5 PER-QUANTILE T4 (prior at median, GBM at tails)
- TimesFM-2.0-500m (Google, 2024)
- TimesFM-2 + linear xreg (T9)
- Chronos-Bolt-Base (Amazon, 2024)
- AutoARIMA / AutoETS / CrostonClassic / SeasonalNaive (statsforecast)

**Datasets benchmarked:**

| Dataset | Series | Horizon | Domain |
|---|---|---|---|
| French Bakery (Kaggle) | 20 | 28 d | retail + weather + holidays, dense |
| NN5 Daily | 111 | 56 d | ATM withdrawals, weekly only |
| M4 Daily | 4,227 | 14 d | heterogeneous (financial / demographic / industrial) |
| M4 Monthly (5K subset) | 5,000 | 18 m | broad domain |
| Tourism Monthly | 366 | 24 m | tourism arrivals |
| Hospital | 767 | 12 w | weekly counts |
| Kaggle Web Traffic | 145,063 | 59 d | Wikipedia page views, viral / trending |
| M5 Accuracy | 30,490 | 28 d | hierarchical retail (Walmart, intermittent) |
| M5 Uncertainty | 30,490 | 28 d | same data, quantile evaluation |

---

## The architectural recipe (production-ready pattern)

After 23 tiers, the recipe that *generalizes* — empirically validated by
Tier 23 (swapping TimesFM-2 for Chronos-Bolt under the same pipeline gave
WSPL 0.140 vs 0.138, within 1.2%):

### For point forecasts on dense daily retail
1. **Compute the population prior** at `(family × dow)` from history.
2. **Compute a foundation-model forecast** at the right intermediate
   aggregation level (L9 = ~70 series for M5; ~category × store).
3. **Disaggregate via static last-28-day revenue shares** to leaves.
4. **Per-quantile blend at maturity** — prior at median, GBM (or FM)
   at q0.9.

### For uncertainty / quantile envelopes
1. Forecast at **multiple aggregation levels** (e.g., L9 + L10 + L11 for M5).
2. **Linear-extrapolate the quantile tails** beyond the FM's pre-trained
   range (`q0.005 ≈ q0.1 - 1.0 * (q0.2 - q0.1)`).
3. **Route each evaluation level to its directly-targeted forecast** —
   L1-L9 from L9-disagg, L10 from L10-disagg, L11/L12 from L11-disagg.
4. **Disaggregate via static within-group leaf shares**, enforce monotonicity.

### When to deviate
- **Sparse / intermittent data (M5)**: prefer top-down from L9 or L10
  over bottom-up at L12.
- **Dense weekly retail with covariates (French Bakery)**: V1.5 prior at
  the median dominates a foundation model that can't see the covariates.
- **Heterogeneous data (M4 daily, Kaggle Web Traffic)**: skip the prior,
  use the FM directly.

### Production wiring
Live worker (`c91217e7`) implements:
- Tier 1: `alphaForBlending(actuals_count)` maturity ramp
- Tier 4: per-quantile target alphas (`QUANTILE_TARGET_ALPHA` in `forecast-router.ts`)
- Tier 6: TimesFM tail injection at q0.8/q0.9 when `TIMESFM_ENDPOINT` is set

Setting `TIMESFM_ENDPOINT` flips the worker from `perq_blend_v1` to
`perq_blend_v2` with no code redeploy. Empirically validated live with the
demo tenant: q0.9 = 125 (TimesFM) vs 128.1 (GBM fallback) on TRADITIONAL
BAGUETTE.

---

## Negative results — what we tried and why it didn't work

### Tier 5 — per-SKU alpha tuning
Hypothesis: each SKU has a different optimal blend ratio. Tune alpha per SKU
on a 28-day valid window. **Result: WAPE 0.212 → 0.241 (worse).** With only
~28 datapoints per SKU, the selection variance dominates the signal.

### Tier 8 — hierarchical OLS-MinT on French Bakery
Reconcile per-SKU forecasts against a TOTAL forecast via OLS-MinT closed
form. **Result: WAPE 0.212 → 0.217 (slightly worse).** The aggregate
forecast is redundant when the leaf forecasts are already strong. *This
becomes a win on M5 (Tier 10).*

### Tier 11 — TimesFM + GBM residual
Train a GBM to predict the residuals of TimesFM forecasts on training data.
**Result: WAPE 1.39** (wildly worse than zero-shot 0.314). 560-row
residual training set overfits a period-specific positive bias.
A proper version needs rolling-origin training (50+ windows × 28 days);
out of scope.

### Tier 13 — L1 + L4 50/50 blend on M5
Blending Tier 10 (L1 forecast) and Tier 12 (L4 forecast) leaves: WSPL
unchanged at 0.792 because L1 ≈ sum of L4 forecasts. Blending two views
of the same signal isn't ensembling.

### Tier 15 — L11 (9,147 series) top-down on M5
Hypothesis: even denser intermediate level helps. **Result: WRMSSE 1.136
— worse than naive bottom-up.** Per-series forecasts at 9,147 series are
too sparse / noisy; errors compound when summed up. **L9 is the empirical
sweet spot.**

### Tier 17 — dow-aware leaf shares
Hypothesis: static (last-28-day) shares miss within-week variation; per-dow
shares (12 obs each over an 84-day window) should be tighter.
**Result: WRMSSE 0.7213 vs 0.7125 static (worse).** Per-dow noise dominates
the within-week signal at the leaf level.

---

## Cross-dataset generalization summary

The cleanest single-dataset comparison vs published 2024 foundation models:

| Dataset | Ours | Best 2024 FM peer | Notes |
|---|---|---|---|
| French Bakery WAPE | **0.212** | TimesFM-2 zero-shot 0.314 | V1.5 wins by 32% (covariates available) |
| NN5 Daily WAPE | 0.197 | AutoETS 0.192 | classical edges out by 3% |
| M4 Daily sMAPE | **2.16** | TimesFM-1 paper 2.94, Chronos ~2.85 | TimesFM-2 retest |
| M4 Monthly sMAPE | 10.20† | Chronos-Large 12.71 | †5K subsample of 48K |
| Tourism Monthly | 20.79 | Chronos-Large ~18.0 | we lose by 3 points |
| Hospital MASE | 0.876 | Chronos / MOIRAI ~0.75 | we lose by 0.13 |
| Kaggle Web Traffic | **38.83** | – | top 50 / top 5% of 1,095 teams |
| M5 Accuracy WRMSSE | **0.713** | M5 winner 0.520 | beats naive baseline 0.91 |
| M5 Uncertainty WSPL | **0.138** (TimesFM), 0.140 (Chronos) | M5 winner 0.157 (private) | top-tier validation range |

**Takeaway:** zero-shot foundation models (any 2024 vintage) + the right
architecture is competitive with bespoke 2020-era ensembles on most retail
data; weaker on small-N monthly and weekly counts where Chronos / MOIRAI
were specifically tuned.

---

## Compute footprint

All results above were produced on a single Apple Silicon MacBook Pro (16 GB
RAM, MPS GPU) with no fine-tuning, no per-level training, no model
ensembling. Total inference time per benchmark:

| Benchmark | TimesFM compute |
|---|---|
| French Bakery (20 SKUs, 28 d) | ~10 s |
| NN5 Daily (111 series) | ~6 s |
| M4 Daily (4,227 series) | ~160 s |
| M5 L9 alone (70 series) | ~10 s |
| M5 L9 + L10 + L11 (Tier 21) | ~10 min |
| Kaggle Web Traffic 5K sample | ~4 min |

The pipeline is genuinely cheap. The 2020 M5 winner trained 12+ models for
weeks on a multi-GPU rig. Our pipeline is one foundation-model API call (×3
levels) + numpy disaggregation.

---

## Reference scripts

| Script | What it does |
|---|---|
| `scripts/benchmark_vs_baselines.py` | Tiers 1-9 on French Bakery (V1 GBM, V1.5 prior, classical baselines, conformal, hierarchical) |
| `scripts/benchmark_timesfm.py` | TimesFM-2 zero-shot on French Bakery |
| `scripts/benchmark_timesfm_residual.py` | Tier 11 (NEGATIVE — kept for reproducibility) |
| `scripts/benchmark_timesfm_covariates.py` | Tier 9 |
| `scripts/benchmark_nn5.py` | NN5 Daily |
| `scripts/benchmark_m4_daily.py` | M4 Daily, beats every published method |
| `scripts/benchmark_kaggle_web_traffic.py` | Wikipedia, top 50 of 1,095 |
| `scripts/benchmark_m5.py` | M5 30K-series WAPE |
| `scripts/m5_wrmsse.py` | M5 WRMSSE library (12-level hierarchical, vectorised) |
| `scripts/benchmark_m5_wrmsse.py` | M5 WRMSSE on full 30,490 series (Tiers 10) |
| `scripts/benchmark_m5_topdown.py` | Tier 10 (L1 → leaves) |
| `scripts/benchmark_m5_multilevel_v2.py` | Tier 12 (L4 → leaves) |
| `scripts/benchmark_m5_blend.py` | Tier 13 |
| `scripts/benchmark_m5_l9.py` | **Tier 14 — best single-pass Accuracy** |
| `scripts/benchmark_m5_l11.py` | Tier 15 (NEGATIVE, kept for reproducibility) |
| `scripts/benchmark_m5_l9_naive.py` | Tier 16 counterfactual |
| `scripts/benchmark_m5_l9_dow.py` | Tier 17 (NEGATIVE, kept for reproducibility) |
| `scripts/benchmark_m5_uncertainty.py` | Tier 18 |
| `scripts/benchmark_m5_uncertainty_v2.py` | Tier 19 |
| `scripts/benchmark_m5_uncertainty_v3.py` | Tier 20 |
| `scripts/benchmark_m5_uncertainty_v4.py` | **Tier 21 — best M5 Uncertainty** |
| `scripts/benchmark_m5_chronos.py` | **Tier 23 — architecture-vs-model proof** |
| `scripts/benchmark_gift_eval.py` | Tier 22 — vs Chronos / MOIRAI 2024 |

---

## Production system

The `bakerysense-web` worker (Cloudflare Workers, OpenNext, Next.js 16) runs:

- **Forecast tool**: `bakerysense-web/src/lib/tools/forecast.ts`
  - per-quantile blend with `QUANTILE_TARGET_ALPHA` schedule (Tier 4)
  - calls `predictTimesFM()` for q0.8/q0.9 when TIMESFM_ENDPOINT is set (Tier 6)
  - graceful fallback to GBM-only if TimesFM unavailable
- **Forecast router**: `bakerysense-web/src/lib/forecast-router.ts`
  - stage classification (no_data / cold / warm / mature)
  - maturity-weighted alpha (Tier 1)
  - blendQuantiles with per-quantile alpha function (Tier 4)
- **TimesFM client**: `bakerysense-web/src/lib/forecasters/timesfm.ts`
  - 5s timeout, AbortController-based
  - graceful fallback on any failure
- **TimesFM serving**: `scripts/serve_timesfm.py` (FastAPI),
  `scripts/Dockerfile.timesfm` (portable container),
  `scripts/deploy_modal.py` (Modal one-liner)

Setting `TIMESFM_ENDPOINT` is the only operational change needed to flip
production from `perq_blend_v1` (Tier 4) to `perq_blend_v2` (Tier 6).

---

*Last updated: 2026-04-28. 23 tiers, 9 datasets, 37+ commits.*
