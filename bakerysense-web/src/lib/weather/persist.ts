/**
 * Persistence layer for V2 weather features. Writes to D1
 * `branch_weather_daily`, reads at forecast time keyed by (branch_id, date).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branchWeatherDaily } from "@/db/schema";
import type { DailyWeather } from "./open-meteo";

export async function upsertWeather(
  env: CloudflareEnv,
  branchId: string,
  rows: DailyWeather[],
  source: "open_meteo_archive" | "open_meteo_forecast",
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb(env);
  const now = Date.now();
  // SQLite via Drizzle batch insert with ON CONFLICT replace. D1 supports
  // `INSERT OR REPLACE` natively.
  let written = 0;
  for (const r of rows) {
    await db
      .insert(branchWeatherDaily)
      .values({
        branchId,
        date: r.date,
        temperatureMeanC: r.temperatureMeanC?.toString() ?? null,
        precipitationMm: r.precipitationMm?.toString() ?? null,
        humidityMeanPct: r.humidityMeanPct?.toString() ?? null,
        uvIndexMax: r.uvIndexMax?.toString() ?? null,
        windSpeedMaxKmh: r.windSpeedMaxKmh?.toString() ?? null,
        isStorm: r.isStorm,
        source,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [branchWeatherDaily.branchId, branchWeatherDaily.date],
        set: {
          temperatureMeanC: r.temperatureMeanC?.toString() ?? null,
          precipitationMm: r.precipitationMm?.toString() ?? null,
          humidityMeanPct: r.humidityMeanPct?.toString() ?? null,
          uvIndexMax: r.uvIndexMax?.toString() ?? null,
          windSpeedMaxKmh: r.windSpeedMaxKmh?.toString() ?? null,
          isStorm: r.isStorm,
          source,
          fetchedAt: now,
        },
      })
      .run();
    written += 1;
  }
  return written;
}

/**
 * Read weather features for a (branch, date) and return them keyed by
 * the IDs in feature-registry.ts. Returns empty if no data — the
 * forecast pipeline treats absent weather as null (model-mask) which
 * the registry's `fallback: null` rule handles correctly.
 */
export async function readWeatherFeatures(
  env: CloudflareEnv,
  branchId: string,
  date: string,
): Promise<Record<string, number>> {
  const row = await getDb(env)
    .select()
    .from(branchWeatherDaily)
    .where(and(
      eq(branchWeatherDaily.branchId, branchId),
      eq(branchWeatherDaily.date, date),
    ))
    .get();
  if (!row) return {};
  const out: Record<string, number> = {};
  if (row.temperatureMeanC != null) out.weather_temp_c = parseFloat(row.temperatureMeanC);
  if (row.precipitationMm != null) {
    const mm = parseFloat(row.precipitationMm);
    out.weather_rain_mm = mm;
    out.weather_is_raining = mm > 0.1 ? 1 : 0;
  }
  if (row.humidityMeanPct != null) out.weather_humidity_pct = parseFloat(row.humidityMeanPct);
  if (row.uvIndexMax != null) out.weather_uv_index = parseFloat(row.uvIndexMax);
  if (row.isStorm) out.weather_storm_warning = 1;
  return out;
}
