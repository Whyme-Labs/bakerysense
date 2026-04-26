/**
 * TimesFM-2 client interface — V2 backbone forecaster.
 *
 * Status: **interface-only stub**. The contract is locked so the
 * surrounding code (router, residual GBM, hierarchical reconciler)
 * can be written and tested today; the actual model serving lives in
 * a Cloudflare Container or external GPU box and gets wired in once
 * that infra exists.
 *
 * Why a stub now rather than nothing:
 *
 * 1. The forecast router needs to make routing decisions based on
 *    whether the FM backend is available — easier to test those
 *    branches when the interface is concrete.
 *
 * 2. The feature-augment pipeline emits weather + festival + static
 *    covariates today. Those are the FM's input. Defining the
 *    request schema now means we don't refactor when serving lands.
 *
 * 3. Tenants that want the FM today can override the stub with their
 *    own `TIMESFM_ENDPOINT` env binding pointing at a private GPU
 *    box (Modal / Replicate / fly.io / a Cloudflare Container).
 *
 * Migration path (post-stub):
 *
 *   a. Provision a Cloudflare Container with the TimesFM-2 weights
 *      cached on a persistent volume. Expose POST /infer.
 *   b. Bind the container service in wrangler.jsonc as TIMESFM.
 *   c. Replace the body of `predictTimesFM` below with
 *      `await env.TIMESFM.fetch("/infer", {...})`.
 *   d. Forecast router promotes warm/mature stages from
 *      "lightgbm_quantile_js" to "timesfm_v2_lora" (with a tenant
 *      LoRA loaded from R2 alongside the base model).
 *
 * Reference paper: "TimesFM: A Decoder-Only Foundation Model for
 * Time-Series Forecasting" (Das et al., ICML 2024). Open weights at
 * google/timesfm-2.0-500m on HuggingFace, Apache 2.0.
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
 * V2 forecast call. Currently a stub: throws TimesFmUnavailableError so
 * callers fall back. When the container ships, replace the body with
 * a service-binding fetch.
 */
export async function predictTimesFM(
  env: CloudflareEnv,
  _input: TimesFmInput,
): Promise<TimesFmOutput> {
  // Read the binding from env at runtime. When TIMESFM_ENDPOINT is
  // absent we throw so the router falls back; when present we POST.
  const endpoint = (env as unknown as { TIMESFM_ENDPOINT?: string }).TIMESFM_ENDPOINT;
  if (!endpoint) {
    throw new TimesFmUnavailableError("TIMESFM_ENDPOINT not set");
  }
  // Live path — disabled today; uncomment + test once a backend exists.
  //
  // const res = await fetch(`${endpoint}/infer`, {
  //   method: "POST",
  //   headers: { "content-type": "application/json" },
  //   body: JSON.stringify(_input),
  // });
  // if (!res.ok) throw new TimesFmUnavailableError(`HTTP ${res.status}`);
  // return (await res.json()) as TimesFmOutput;
  throw new TimesFmUnavailableError("live path disabled — see migration notes");
}

/** Cheap probe used by the router to decide whether to attempt a V2
 *  call at all. Avoids paying the request roundtrip on every forecast. */
export function isTimesFmConfigured(env: CloudflareEnv): boolean {
  return Boolean((env as unknown as { TIMESFM_ENDPOINT?: string }).TIMESFM_ENDPOINT);
}
