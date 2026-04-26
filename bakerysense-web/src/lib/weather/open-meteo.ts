/**
 * Open-Meteo client — free historical archive + 14-day forecast for V2
 * weather covariates. No API key required for the free tier; rate limit
 * is generous (10K req/day, 600 req/min).
 *
 * Endpoints:
 *   archive  https://archive-api.open-meteo.com/v1/archive
 *   forecast https://api.open-meteo.com/v1/forecast
 *
 * The weather features land in the GBM/FM input vector via
 * `feature-registry.ts` IDs:
 *   weather_temp_c, weather_rain_mm, weather_humidity_pct,
 *   weather_uv_index, weather_storm_warning.
 *
 * The schedule worker calls these for every branch with lat/lon, persists
 * to D1's `branch_weather_daily` table, and the forecast pipeline joins
 * on (branch_id, date) at predict time. No live fetches in the request
 * path — the cache is daily.
 */

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const DAILY_FIELDS = [
  "temperature_2m_mean",
  "precipitation_sum",
  "relative_humidity_2m_mean",
  "uv_index_max",
  "wind_speed_10m_max",
  "weather_code",
].join(",");

export interface DailyWeather {
  date: string;
  temperatureMeanC: number | null;
  precipitationMm: number | null;
  humidityMeanPct: number | null;
  uvIndexMax: number | null;
  windSpeedMaxKmh: number | null;
  /** 1 if the day's worst weather code matches a storm (>=80 in Open-Meteo's
   *  WMO encoding) — the GBM consumes this as `weather_storm_warning`. */
  isStorm: 0 | 1;
}

interface OpenMeteoDailyResponse {
  daily?: {
    time: string[];
    temperature_2m_mean?: (number | null)[];
    precipitation_sum?: (number | null)[];
    relative_humidity_2m_mean?: (number | null)[];
    uv_index_max?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
    weather_code?: (number | null)[];
  };
  reason?: string;
}

function buildUrl(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("daily", DAILY_FIELDS);
  u.searchParams.set("timezone", "auto");
  return u.toString();
}

function parseRows(json: OpenMeteoDailyResponse): DailyWeather[] {
  const d = json.daily;
  if (!d) return [];
  return d.time.map((date, i) => ({
    date,
    temperatureMeanC: d.temperature_2m_mean?.[i] ?? null,
    precipitationMm: d.precipitation_sum?.[i] ?? null,
    humidityMeanPct: d.relative_humidity_2m_mean?.[i] ?? null,
    uvIndexMax: d.uv_index_max?.[i] ?? null,
    windSpeedMaxKmh: d.wind_speed_10m_max?.[i] ?? null,
    isStorm: ((d.weather_code?.[i] ?? 0) >= 80) ? 1 : 0,
  }));
}

/** Pull historical weather for a (lat, lon) over a date range. Used for
 *  one-time backfills against training data. */
export async function fetchHistorical(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<DailyWeather[]> {
  const url = buildUrl(ARCHIVE, {
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate,
    end_date: endDate,
  });
  const res = await fetch(url, { cf: { cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`open-meteo archive ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as OpenMeteoDailyResponse;
  if (json.reason) throw new Error(`open-meteo archive: ${json.reason}`);
  return parseRows(json);
}

/** Pull the next 14 days of forecast weather for a (lat, lon). Called daily
 *  by the cron worker — every branch with lat/lon gets refreshed. */
export async function fetchForecast(lat: number, lon: number): Promise<DailyWeather[]> {
  const url = buildUrl(FORECAST, {
    latitude: String(lat),
    longitude: String(lon),
    forecast_days: "14",
  });
  const res = await fetch(url, { cf: { cacheTtl: 3600 } } as RequestInit);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`open-meteo forecast ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as OpenMeteoDailyResponse;
  if (json.reason) throw new Error(`open-meteo forecast: ${json.reason}`);
  return parseRows(json);
}
