/**
 * Platform-wide feature registry — the single source of truth for every
 * feature a forecaster, residual, or refill optimizer can consume.
 *
 * Why this exists:
 *
 * 1. Friendly labels are used in three UI surfaces (DriverBars,
 *    ToolTrace, ModelInfoPanel). Inline maps drift; this registry
 *    is the canonical source.
 *
 * 2. Production tenants don't all have the same capabilities. A bakery
 *    with weather-station data ships richer forecasts than one without.
 *    The registry declares which features each model layer expects and
 *    where they come from, so we can mask features cleanly per tenant
 *    instead of branching code per case.
 *
 * 3. The V2 roadmap (TimesFM backbone + GBM residual + ingestion
 *    workers) adds 30+ features. Documenting them here today makes
 *    that migration a registry-entry add, not a refactor.
 *
 * Each tenant's `feature_availability` JSON column on `tenants` is a
 * subset of the registry's `id` values. The forecast pipeline reads
 * the tenant's availability mask, builds the input vector with the
 * intersection of (registered ∩ available ∩ model-trained-on), and
 * pads/masks the rest with each feature's declared `fallback`.
 */

export type FeatureSource =
  | "autoregressive"   // derived from sales history (lag, rolling)
  | "calendar"         // derived from the date itself
  | "tenant_pos"       // requires the tenant POS connector to provide it
  | "weather_api"      // requires lat/lon + a weather backfill job
  | "festival_lookup"  // requires a regional festival calendar
  | "macro"            // economic indicators (CPI, FX, fuel)
  | "iot"              // requires sensor hardware in the branch
  | "behavioral"       // requires customer-behavior signals
  | "static_attr";     // static covariate (SKU/branch metadata)

export type FeatureLayer =
  | "v1_gbm"           // active in the current LightGBM forecaster
  | "v2_fm_static"     // V2 TimesFM static covariate (entity attribute)
  | "v2_fm_future"     // V2 TimesFM future-known covariate
  | "v2_residual"      // V2 GBM residual layer
  | "v3_refill"        // V3 real-time refill optimizer
  | "constraint";      // hard constraint, post-prediction

export interface FeatureSpec {
  id: string;
  friendly: string;
  description: string;
  source: FeatureSource;
  layer: FeatureLayer;
  /** Numeric default if missing AND the model can't mask. Use `null` when the
   *  consumer should attention-mask instead of substituting a number. */
  fallback: number | null;
  /** Roadmap stage at which this feature becomes consumable. */
  stage: "v1" | "v2" | "v3";
  /** Capabilities the tenant must have to populate this feature. */
  requires?: string[];
}

export const FEATURE_REGISTRY: ReadonlyArray<FeatureSpec> = [
  // ─── V1 — autoregressive lags (live in current LightGBM) ───────────────
  { id: "lag_1",            friendly: "Yesterday's sales",      description: "Sales of this SKU one day before the forecast date.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "lag_7",            friendly: "Last week, same day",    description: "Sales seven days before — captures weekly seasonality.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "lag_14",           friendly: "Two weeks ago",          description: "Sales fourteen days before — captures fortnightly cycles.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "lag_28",           friendly: "Four weeks ago",         description: "Sales twenty-eight days before — monthly anchor.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "rolling_mean_7",   friendly: "Past-week average",      description: "Mean of the last seven days of sales.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "rolling_mean_28",  friendly: "Past-month average",     description: "Mean of the last twenty-eight days.", source: "autoregressive", layer: "v1_gbm", fallback: 0, stage: "v1" },

  // ─── V1 — calendar features ────────────────────────────────────────────
  { id: "dow",              friendly: "Day of week",            description: "0=Sun, 6=Sat. Captures within-week seasonality.", source: "calendar", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "is_weekend",       friendly: "Weekend",                description: "Binary flag for Sat/Sun.", source: "calendar", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "is_holiday",       friendly: "Public holiday",         description: "Binary flag for the tenant's locale public holidays.", source: "calendar", layer: "v1_gbm", fallback: 0, stage: "v1" },
  { id: "month",            friendly: "Month of year",          description: "1–12 month index. Captures annual seasonality.", source: "calendar", layer: "v1_gbm", fallback: 1, stage: "v1" },

  // ─── V1 — tenant POS attributes ────────────────────────────────────────
  { id: "promo",            friendly: "Promotion active",       description: "1 if a promotion is running on this SKU on this date.", source: "tenant_pos", layer: "v1_gbm", fallback: 0, stage: "v1", requires: ["pos.promotions"] },
  { id: "price",            friendly: "Price level",            description: "Current shelf price in tenant currency.", source: "tenant_pos", layer: "v1_gbm", fallback: 0, stage: "v1", requires: ["pos.prices"] },
  { id: "family",           friendly: "SKU family",             description: "Categorical SKU family (BREAD / PASTRY / VIENNOISERIE / …).", source: "static_attr", layer: "v1_gbm", fallback: 0, stage: "v1" },

  // ─── V2 — calendar derivations (cheap to add, big lift) ────────────────
  { id: "quarter",          friendly: "Quarter of year",        description: "1–4. Captures fiscal/seasonal grouping.", source: "calendar", layer: "v2_fm_future", fallback: 1, stage: "v2" },
  { id: "week_of_year",     friendly: "Week of year",           description: "1–53. Captures near-holiday clusters.", source: "calendar", layer: "v2_fm_future", fallback: 1, stage: "v2" },
  { id: "season",           friendly: "Season",                 description: "Spring / Summer / Autumn / Winter — affects product-mix demand.", source: "calendar", layer: "v2_fm_future", fallback: 0, stage: "v2" },
  { id: "is_start_of_month",friendly: "Start of month",         description: "Payday effect on premium items.", source: "calendar", layer: "v2_fm_future", fallback: 0, stage: "v2" },
  { id: "is_end_of_month",  friendly: "End of month",           description: "Budget tightening on consumer spend.", source: "calendar", layer: "v2_fm_future", fallback: 0, stage: "v2" },
  { id: "days_until_holiday", friendly: "Days until next holiday", description: "Pre-holiday stocking behaviour.", source: "calendar", layer: "v2_fm_future", fallback: 30, stage: "v2" },
  { id: "is_school_holiday",friendly: "School holiday",         description: "Families visit more; kids' items spike.", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.school_calendar"] },

  // ─── V2 — weather covariates (Open-Meteo backfill) ─────────────────────
  { id: "weather_temp_c",   friendly: "Temperature (°C)",       description: "Forecast or actual mean daily temperature.", source: "weather_api", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_rain_mm",  friendly: "Rainfall (mm)",          description: "Precipitation total. Rainy days reduce foot traffic.", source: "weather_api", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_is_raining", friendly: "Currently raining",    description: "Binary — immediate impact on walk-in volume.", source: "weather_api", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_humidity_pct", friendly: "Humidity (%)",       description: "Affects product staleness and customer comfort.", source: "weather_api", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_uv_index", friendly: "UV index",               description: "Outdoor dining / market activity proxy.", source: "weather_api", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_haze",     friendly: "Haze / smoke event",     description: "Common in SEA — suppresses foot traffic.", source: "weather_api", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["branch.lat_lon"] },
  { id: "weather_storm_warning", friendly: "Storm warning",     description: "Emergency stocking-up behaviour.", source: "weather_api", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["branch.lat_lon"] },

  // ─── V2 — cultural festival markers ────────────────────────────────────
  { id: "is_chinese_new_year", friendly: "Chinese New Year",   description: "Bak kwa, pineapple tarts spike (SG/MY).", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_sea"] },
  { id: "is_hari_raya",     friendly: "Hari Raya / Ramadan",    description: "Kuih and traditional pastry surge.", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_sea"] },
  { id: "is_christmas",     friendly: "Christmas period",       description: "Fruit cakes, log cakes, stollen.", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_global"] },
  { id: "is_deepavali",     friendly: "Deepavali",              description: "Murukku, Indian sweets.", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_sea"] },
  { id: "is_mid_autumn",    friendly: "Mid-Autumn Festival",    description: "Mooncakes (SG/MY/HK/CN).", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_sea"] },
  { id: "is_pre_festival_eve", friendly: "Day before festival", description: "Highest demand spike — rush buying.", source: "festival_lookup", layer: "v2_fm_future", fallback: 0, stage: "v2", requires: ["locale.festivals_global"] },

  // ─── V2 — branch / SKU static covariates ───────────────────────────────
  { id: "branch_store_type", friendly: "Store type",            description: "Mall / HDB void deck / CBD / transport hub. Drives baseline volume.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2" },
  { id: "branch_lat",       friendly: "Branch latitude",        description: "Geo-coordinate; used for weather joins and demographic clustering.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2" },
  { id: "branch_lon",       friendly: "Branch longitude",       description: "Geo-coordinate.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2" },
  { id: "branch_office_density", friendly: "Nearby office density", description: "Weekday lunch-rush proxy.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2", requires: ["branch.demographics"] },
  { id: "branch_residential_density", friendly: "Nearby residential density", description: "Weekend family traffic.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2", requires: ["branch.demographics"] },
  { id: "branch_tourist_score", friendly: "Tourist foot-traffic score", description: "Hotel / attraction proximity.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2", requires: ["branch.demographics"] },
  { id: "branch_halal_cert", friendly: "Halal certified",       description: "Opens access to Muslim-majority market in SEA.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2" },
  { id: "sku_shelf_life_h", friendly: "Shelf life (hours)",     description: "Determines refill urgency and waste risk.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2" },
  { id: "sku_margin",       friendly: "Product margin",         description: "Priority refill for high-margin items.", source: "static_attr", layer: "v2_fm_static", fallback: null, stage: "v2" },
  { id: "sku_is_signature", friendly: "Signature item",         description: "Bestseller flag — needs more frequent refill.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2" },
  { id: "sku_is_seasonal",  friendly: "Seasonal product",       description: "Time-limited demand burst.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2" },
  { id: "sku_packaging",    friendly: "Packaging type",         description: "Wrapped vs unwrapped affects freshness window.", source: "static_attr", layer: "v2_fm_static", fallback: 0, stage: "v2" },

  // ─── V2 — historical demand context (FM autoregressive supplement) ─────
  { id: "sell_through_rate",friendly: "Sell-through rate",      description: "(Sold / produced) × 100. Demand-overestimation signal.", source: "tenant_pos", layer: "v2_residual", fallback: null, stage: "v2", requires: ["pos.production_log"] },
  { id: "stockout_freq_7d", friendly: "Stockout frequency (7d)",description: "Demand-underestimation signal.", source: "tenant_pos", layer: "v2_residual", fallback: 0, stage: "v2", requires: ["pos.production_log"] },
  { id: "waste_last_period",friendly: "Waste / markdowns last period", description: "Demand-overestimation signal.", source: "tenant_pos", layer: "v2_residual", fallback: 0, stage: "v2", requires: ["pos.waste_capture"] },
  { id: "lag_365",          friendly: "Same day last year",     description: "Year-over-year seasonal anchor (FM context).", source: "autoregressive", layer: "v2_fm_static", fallback: null, stage: "v2" },

  // ─── V2 — promotions & marketing context ───────────────────────────────
  { id: "promo_type",       friendly: "Promotion type",         description: "% off / bundling / loyalty points.", source: "tenant_pos", layer: "v2_residual", fallback: 0, stage: "v2", requires: ["pos.promotions"] },
  { id: "is_featured",      friendly: "Featured in menu/banner",description: "Visibility uplift effect.", source: "tenant_pos", layer: "v2_residual", fallback: 0, stage: "v2", requires: ["pos.promotions"] },
  { id: "competitor_promo", friendly: "Competitor promotion",   description: "Traffic diversion risk.", source: "tenant_pos", layer: "v2_residual", fallback: 0, stage: "v2", requires: ["external.competitor_feed"] },

  // ─── V2 — macro / economic ─────────────────────────────────────────────
  { id: "macro_cpi",        friendly: "CPI (food)",             description: "Purchasing-power indicator.", source: "macro", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["external.macro_feed"] },
  { id: "macro_fx",         friendly: "Exchange rate",          description: "Affects imported ingredient pricing.", source: "macro", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["external.macro_feed"] },
  { id: "macro_fuel_index", friendly: "Fuel / delivery index",  description: "Supply-chain cost pressure on production frequency.", source: "macro", layer: "v2_fm_future", fallback: null, stage: "v2", requires: ["external.macro_feed"] },

  // ─── V3 — real-time IoT / behavioural (refill optimizer) ───────────────
  { id: "shelf_weight",     friendly: "Shelf weight sensor",    description: "Real-time depletion detection.", source: "iot", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.weight_sensor"] },
  { id: "shelf_camera_pct", friendly: "Camera shelf occupancy", description: "Computer-vision fill-rate estimation.", source: "iot", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.shelf_camera"] },
  { id: "rfid_removal_rate",friendly: "RFID removal rate",      description: "Per-item removal tracking.", source: "iot", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.rfid"] },
  { id: "foot_traffic_15m", friendly: "Foot traffic (15-min)",  description: "Catchment-area activity, sensor or camera-based.", source: "behavioral", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.foot_traffic"] },
  { id: "queue_length",     friendly: "Queue length at checkout",description: "Impulse add-on opportunity.", source: "behavioral", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.queue_camera"] },
  { id: "dwell_near_shelf", friendly: "Dwell time near shelf",  description: "Browsing / hesitation indicator.", source: "behavioral", layer: "v3_refill", fallback: null, stage: "v3", requires: ["iot.shelf_camera"] },

  // ─── Hard constraints (post-prediction, decision layer) ────────────────
  { id: "constraint_oven_capacity", friendly: "Oven capacity",  description: "Hard ceiling on batch output.", source: "static_attr", layer: "constraint", fallback: 9999, stage: "v2" },
  { id: "constraint_staff_headcount", friendly: "Staff on shift",description: "Refill execution capacity.", source: "tenant_pos", layer: "constraint", fallback: 9999, stage: "v2", requires: ["pos.shift_schedule"] },
  { id: "constraint_fefo",  friendly: "FEFO compliance",        description: "First-expired-first-out — must be honoured.", source: "static_attr", layer: "constraint", fallback: 1, stage: "v2" },
  { id: "constraint_ingredient_stock", friendly: "Ingredient stock", description: "Production constraint — flour, butter, etc.", source: "tenant_pos", layer: "constraint", fallback: 9999, stage: "v2", requires: ["pos.inventory"] },
];

// ──────────────────────────────────────────────────────────────────────────
// Convenience indices
// ──────────────────────────────────────────────────────────────────────────

const BY_ID: Map<string, FeatureSpec> = new Map(
  FEATURE_REGISTRY.map((f) => [f.id, f]),
);

export function getFeature(id: string): FeatureSpec | null {
  return BY_ID.get(id) ?? null;
}

export function friendlyLabel(id: string): string {
  const spec = BY_ID.get(id);
  if (spec) return spec.friendly;
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function featuresForLayer(layer: FeatureLayer): FeatureSpec[] {
  return FEATURE_REGISTRY.filter((f) => f.layer === layer);
}

export function featuresForStage(stage: "v1" | "v2" | "v3"): FeatureSpec[] {
  return FEATURE_REGISTRY.filter((f) => f.stage === stage);
}

/** Default V1 availability — every tenant onboarded today gets these. */
export const V1_DEFAULT_AVAILABILITY: ReadonlyArray<string> =
  FEATURE_REGISTRY.filter((f) => f.layer === "v1_gbm").map((f) => f.id);

export interface TenantFeatureMask {
  /** Set of feature IDs the tenant has data for. */
  available: Set<string>;
}

export function maskFromList(ids: ReadonlyArray<string>): TenantFeatureMask {
  return { available: new Set(ids) };
}

/**
 * Build a feature row for a model, intersecting registered features with
 * the tenant's availability mask. Missing features get the registered
 * fallback (numeric) or null (model-mask token). Caller decides whether
 * to substitute the fallback or pass null straight through to an
 * attention-masking model.
 */
export function buildModelInput(
  rawFeatures: Record<string, number>,
  modelExpects: ReadonlyArray<string>,
  mask: TenantFeatureMask,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const id of modelExpects) {
    const spec = BY_ID.get(id);
    if (!spec) continue;
    if (!mask.available.has(id)) {
      out[id] = spec.fallback;
      continue;
    }
    out[id] = rawFeatures[id] ?? spec.fallback;
  }
  return out;
}
