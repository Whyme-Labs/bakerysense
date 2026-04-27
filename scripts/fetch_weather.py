"""Fetch Open-Meteo historical archive for the bakery dataset's date range
and save to data/raw/weather_paris.csv. Free tier, no API key.

The French Bakery dataset doesn't disclose its city; we use Paris as the
canonical French location (48.8566° N, 2.3522° E) on the assumption that
demand patterns reflect a French metropolitan area. Re-run with different
coords if the bakery's true location is known.

Output schema (one row per date):
    date, temp_c, precip_mm, humidity, wind_kmh, weather_code, is_storm
"""
from __future__ import annotations

import csv
import json
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "data" / "raw" / "weather_paris.csv"

LAT, LON = 48.8566, 2.3522
START, END = "2021-01-02", "2022-09-30"
TZ = "Europe/Paris"


def main() -> int:
    params = urllib.parse.urlencode({
        "latitude": LAT,
        "longitude": LON,
        "start_date": START,
        "end_date": END,
        "daily": ",".join([
            "temperature_2m_mean",
            "precipitation_sum",
            "relative_humidity_2m_mean",
            "wind_speed_10m_max",
            "weather_code",
        ]),
        "timezone": TZ,
    })
    url = f"https://archive-api.open-meteo.com/v1/archive?{params}"
    print(f"GET {url}")

    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)

    daily = data["daily"]
    n = len(daily["time"])
    print(f"got {n} daily rows")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "temp_c", "precip_mm", "humidity", "wind_kmh", "weather_code", "is_storm"])
        for i in range(n):
            code = daily["weather_code"][i]
            w.writerow([
                daily["time"][i],
                daily["temperature_2m_mean"][i],
                daily["precipitation_sum"][i],
                daily["relative_humidity_2m_mean"][i],
                daily["wind_speed_10m_max"][i],
                code,
                1 if (code is not None and code >= 80) else 0,
            ])
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
