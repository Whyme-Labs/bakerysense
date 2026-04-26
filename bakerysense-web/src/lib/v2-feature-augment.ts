/**
 * V2 feature augmentation. Joins external signals (weather, festivals,
 * branch metadata) onto the autoregressive feature row from the V1
 * pipeline so a downstream FM (or the existing GBM if its training
 * matrix grew to include them) sees a fuller input.
 *
 * Today the V1 GBM is trained on 13 features and ignores anything
 * extra — this augmenter adds optional V2 fields and the GBM handler
 * just drops them. When V2 lands, the same augmenter wires straight
 * into TimesFM static + future-known covariates.
 *
 * Per-tenant availability mask is honoured: if a tenant doesn't have
 * `weather_temp_c` in its mask, the augmenter doesn't even hit the
 * weather store for that tenant. Cheap correctness.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { readWeatherFeatures } from "./weather/persist";
import { festivalFeatures } from "./festivals";
import type { TenantFeatureMask } from "./feature-registry";

interface AugmentArgs {
  env: CloudflareEnv;
  tenantId: string;
  branchId: string;
  date: string;
  mask: TenantFeatureMask;
}

const WEATHER_IDS = [
  "weather_temp_c",
  "weather_rain_mm",
  "weather_is_raining",
  "weather_humidity_pct",
  "weather_uv_index",
  "weather_storm_warning",
];

const FESTIVAL_IDS = [
  "is_chinese_new_year",
  "is_hari_raya",
  "is_christmas",
  "is_deepavali",
  "is_mid_autumn",
  "is_pre_festival_eve",
  "is_school_holiday",
  "days_until_holiday",
];

function anyAvailable(mask: TenantFeatureMask, ids: string[]): boolean {
  for (const id of ids) if (mask.available.has(id)) return true;
  return false;
}

/**
 * Build the V2 feature add-on for a single (branch, date). Returns only
 * the IDs the tenant has declared in its availability mask, so the caller
 * can union it with the V1 row without leaking cross-tenant data.
 */
export async function augmentV2Features({
  env, tenantId, branchId, date, mask,
}: AugmentArgs): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  const wantsWeather = anyAvailable(mask, WEATHER_IDS);
  const wantsFestivals = anyAvailable(mask, FESTIVAL_IDS);
  if (!wantsWeather && !wantsFestivals) return out;

  // Single branches lookup gets us locale (festivals) and validates
  // membership for the tenant (defence-in-depth — the join is keyed on
  // branchId so cross-tenant leakage shouldn't happen, but we don't want
  // a future bug to silently slip a wrong branch through).
  const branch = await getDb(env)
    .select({ tenantId: branches.tenantId, locale: branches.locale })
    .from(branches)
    .where(eq(branches.id, branchId))
    .get();
  if (!branch || branch.tenantId !== tenantId) return out;

  if (wantsWeather) {
    const w = await readWeatherFeatures(env, branchId, date);
    for (const [k, v] of Object.entries(w)) {
      if (mask.available.has(k)) out[k] = v;
    }
  }

  if (wantsFestivals) {
    const f = festivalFeatures(branch.locale, date);
    for (const [k, v] of Object.entries(f)) {
      if (mask.available.has(k)) out[k] = v;
    }
  }

  return out;
}
