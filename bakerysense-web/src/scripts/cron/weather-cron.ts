/**
 * Daily weather refresh cron. For every branch with a populated
 * (lat, lon), fetches the next 14 days of forecast weather from
 * Open-Meteo and upserts it into branch_weather_daily. The forecast
 * pipeline reads from this store at predict time without any live
 * fetch.
 *
 * Schedule (in wrangler.jsonc): `0 5 * * *` UTC — runs once daily.
 *
 * Backfilling historical weather for training is a separate one-shot
 * via `scripts/backfill_weather.py` (or a dedicated worker route)
 * and lives outside this cron's scope.
 */

import { isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches } from "@/db/schema";
import { fetchForecast } from "@/lib/weather/open-meteo";
import { upsertWeather } from "@/lib/weather/persist";

interface BranchRow {
  id: string;
  lat: string | null;
  lon: string | null;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const rows: BranchRow[] = await getDb(env)
      .select({ id: branches.id, lat: branches.lat, lon: branches.lon })
      .from(branches)
      .where(isNotNull(branches.lat))
      .all();

    let ok = 0;
    let failed = 0;
    // Fan out per-branch fetches but cap concurrency to stay polite to
    // Open-Meteo's free tier (10K req/day, 600 req/min — plenty headroom
    // even with ctx.waitUntil-style fanout, but no point hammering).
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker(): Promise<void> {
      while (cursor < rows.length) {
        const r = rows[cursor++];
        if (!r.lat || !r.lon) continue;
        try {
          const data = await fetchForecast(parseFloat(r.lat), parseFloat(r.lon));
          await upsertWeather(env, r.id, data, "open_meteo_forecast");
          ok += 1;
        } catch (e) {
          console.error(`[weather-cron] ${r.id} failed: ${(e as Error).message}`);
          failed += 1;
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker());
    ctx.waitUntil(Promise.all(workers).then(() => {
      console.log(`[weather-cron] done — ok=${ok} failed=${failed}`);
    }));
  },
};
