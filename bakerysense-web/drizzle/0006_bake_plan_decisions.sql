CREATE TABLE `bake_plan_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `family` text NOT NULL,
  `date` text NOT NULL,
  `option_kind` text NOT NULL,
  `bake_quantity` integer NOT NULL,
  `forecast_snapshot_id` text,
  `model_version_id` text,
  `expected_waste_units` text,
  `expected_stockout_prob` text,
  `expected_units_sold` text,
  `committed_by_user_id` text NOT NULL,
  `committed_at` integer NOT NULL,
  `notes` text,
  -- Lineage coherence: forecast_snapshot_id and model_version_id are
  -- denormalised as a pair — either both NULL (no lineage) or both set.
  CHECK (
    (`forecast_snapshot_id` IS NULL AND `model_version_id` IS NULL)
    OR
    (`forecast_snapshot_id` IS NOT NULL AND `model_version_id` IS NOT NULL)
  ),
  FOREIGN KEY (`tenant_id`)             REFERENCES `tenants`(`id`)             ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`)             REFERENCES `branches`(`id`)            ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`forecast_snapshot_id`)  REFERENCES `forecast_snapshots`(`id`)  ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`model_version_id`)      REFERENCES `model_versions`(`id`)      ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`committed_by_user_id`)  REFERENCES `users`(`id`)               ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bake_plan_decisions_unique_idx` ON `bake_plan_decisions` (`tenant_id`,`branch_id`,`family`,`date`);
--> statement-breakpoint
CREATE INDEX `bake_plan_decisions_lookup_idx` ON `bake_plan_decisions` (`tenant_id`,`branch_id`,`date`);
--> statement-breakpoint
CREATE INDEX `bake_plan_decisions_snapshot_idx` ON `bake_plan_decisions` (`forecast_snapshot_id`);
--> statement-breakpoint
CREATE INDEX `bake_plan_decisions_model_version_idx` ON `bake_plan_decisions` (`model_version_id`);
