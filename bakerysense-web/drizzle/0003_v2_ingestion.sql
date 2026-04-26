-- V2 ingestion layer: branch lat/lon + locale, daily weather store.
ALTER TABLE `branches` ADD COLUMN `lat` text;
ALTER TABLE `branches` ADD COLUMN `lon` text;
ALTER TABLE `branches` ADD COLUMN `timezone` text;
ALTER TABLE `branches` ADD COLUMN `locale` text;

CREATE TABLE `branch_weather_daily` (
  `branch_id` text NOT NULL,
  `date` text NOT NULL,
  `temperature_mean_c` text,
  `precipitation_mm` text,
  `humidity_mean_pct` text,
  `uv_index_max` text,
  `wind_speed_max_kmh` text,
  `is_storm` integer DEFAULT 0,
  `source` text NOT NULL,
  `fetched_at` integer NOT NULL,
  PRIMARY KEY (`branch_id`, `date`),
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`)
);

CREATE INDEX `branch_weather_date_idx` ON `branch_weather_daily` (`date`);
