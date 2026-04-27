/**
 * TimesFM-2 client interface — V2 backbone forecaster.
 *
 * Status: **interface-only stub**, validated against TimesFM-2.0-500m
 * zero-shot (April 2026 benchmark — see scripts/benchmark_timesfm.py).
 *
 * Empirical findings on the French Bakery 28-day × 20-SKU holdout:
 *
 *   • TimesFM zero-shot WAPE 0.314 (vs V1.5 0.212) — 48% WORSE at
 *     the median. Zero-shot has no access to weather, holidays, or
 *     the corpus prior, so the population prior wins decisively.
 *
 *   • TimesFM zero-shot pinball-q0.9 1.091 (vs V1 LightGBM 1.153) —
 *     5.3% BETTER at the tail. The decoder-only model has more honest
 *     tail calibration even without covariates.
 *
 * Therefore the production wiring is **Tier 6** (not "promote everything
 * to TimesFM"): keep the V1.5 population prior at the median, route q0.8
 * and q0.9 to TimesFM. Verified strict improvement over Tier 4:
 *   WAPE same (0.212) · q0.5 pinball same (2.04) · q0.9 pinball -5.3%
 *
 * Migration path (post-stub):
 *
 *   a. Provision a Cloudflare Container with TimesFM-2.0-500m weights
 *      cached on a persistent volume. Expose POST /infer.
 *      Container needs ~5GB RAM for FP16 inference, ~10GB for FP32.
 *      CPU inference is ~1s/series; GPU (Containers preview) is ~50ms.
 *
 *   b. Bind the container service in wrangler.jsonc as TIMESFM.
 *
 *   c. Replace the body of `predictTimesFM` below with
 *      `await env.TIMESFM.fetch("/infer", {...})`.
 *
 *   d. Forecast router does NOT promote the median to TimesFM — it
 *      stays with the population prior. Only q0.8 / q0.9 route to
 *      TimesFM (Tier 6). Forecaster label becomes "perq_blend_v2".
 *
 *   e. Tenant LoRA training (V2 roadmap) can later pull the median
 *      onto TimesFM too once the model has seen tenant covariates.
 *
 * Reference: Das et al., "TimesFM: A Decoder-Only Foundation Model for
 * Time-Series Forecasting" (ICML 2024). Open weights at
 * google/timesfm-2.0-500m-pytorch on HuggingFace, Apache 2.0.
 */

export interface TimesFmInput {
  /** Most-recent N days of observed sales (oldest first). N >= 28
   *  recommended for the 200M variant; >= 96 for the 500M. */
  history: number[];
  /** Static covariates that don't change over the forecast horizon. */
  static_covariates?: Record<string, number | null>;
  /** Future-known covariates indexed by horizon offset (0 = day 1).
   *  Each row carries the same keys; nulls where unavailable. */
  future_known?: Array<Record<string, number | null>>;
  /** How many days ahead to forecast. */
  horizon: number;
  /** Quantile levels to return. */
  quantiles: number[];
  /** Optional tenant LoRA adapter ID (loaded from R2 by the server). */
  tenant_lora?: string | null;
}

export interface TimesFmOutput {
  /** quantile_<q> → array of horizon predictions, indexed 0..horizon-1. */
  quantiles: Record<string, number[]>;
  /** Echo of which model variant served the request. */
  model: "timesfm-2.0-200m" | "timesfm-2.0-500m";
  /** Whether a tenant LoRA was applied. */
  lora_applied: boolean;
  /** Inference latency on the server (ms). */
  latency_ms: number;
}

/**
 * Sentinel error thrown when the TimesFM backend is not configured.
 * The forecast router catches this and falls back to the V1 GBM path
 * — clients see a graceful downgrade, not a 500.
 */
export class TimesFmUnavailableError extends Error {
  constructor(reason: string) {
    super(`TimesFM backend unavailable: ${reason}`);
    this.name = "TimesFmUnavailableError";
  }
}

/**
 * V2 forecast call. Calls the FastAPI backend at TIMESFM_ENDPOINT/infer
 * (matches scripts/serve_timesfm.py byte-for-byte). Throws
 * TimesFmUnavailableError when no backend is configured or the call
 * fails — the forecast router catches and falls back to V1 GBM tails.
 *
 * Timeout is intentionally short (5s) because newsvendor decisions
 * cannot block on a slow ML service; better to fall back than stall.
 */
const TIMESFM_TIMEOUT_MS = 5000;

export async function predictTimesFM(
  env: CloudflareEnv,
  input: TimesFmInput,
): Promise<TimesFmOutput> {
  const endpoint = (env as unknown as { TIMESFM_ENDPOINT?: string }).TIMESFM_ENDPOINT;
  if (!endpoint) {
    throw new TimesFmUnavailableError("TIMESFM_ENDPOINT not set");
  }
  const url = endpoint.replace(/\/$/, "") + "/infer";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMESFM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new TimesFmUnavailableError(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as TimesFmOutput;
  } catch (err) {
    if (err instanceof TimesFmUnavailableError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new TimesFmUnavailableError(reason);
  } finally {
    clearTimeout(t);
  }
}

/** Cheap probe used by the router to decide whether to attempt a V2
 *  call at all. Avoids paying the request roundtrip on every forecast. */
export function isTimesFmConfigured(env: CloudflareEnv): boolean {
  return Boolean((env as unknown as { TIMESFM_ENDPOINT?: string }).TIMESFM_ENDPOINT);
}
