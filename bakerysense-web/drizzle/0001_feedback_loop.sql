CREATE TABLE `daily_actuals` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `family` text NOT NULL,
  `date` text NOT NULL,
  `recommended_bake` integer,
  `actual_bake` integer,
  `actual_sales` integer,
  `waste_units` integer,
  `source` text NOT NULL,
  `captured_by_user_id` text,
  `captured_at` integer NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`captured_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_actuals_unique_idx` ON `daily_actuals` (`tenant_id`,`branch_id`,`family`,`date`);
--> statement-breakpoint
CREATE INDEX `daily_actuals_lookup_idx` ON `daily_actuals` (`tenant_id`,`branch_id`,`date`);
--> statement-breakpoint
CREATE TABLE `forecast_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `family` text NOT NULL,
  `date` text NOT NULL,
  `model_version` integer NOT NULL DEFAULT 0,
  `bake_quantity` integer NOT NULL,
  `quantiles_json` text NOT NULL,
  `served_at` integer NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_snap_unique_idx` ON `forecast_snapshots` (`tenant_id`,`branch_id`,`family`,`date`,`model_version`);
--> statement-breakpoint
CREATE INDEX `forecast_snap_lookup_idx` ON `forecast_snapshots` (`tenant_id`,`branch_id`,`date`);
