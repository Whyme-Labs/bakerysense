-- Decision lineage tables (Tier 1 production-grade).
--
-- Adds:
--   1. model_versions       — durable registry of every trained forecaster,
--                             with parent links, training window, validation
--                             metrics, and lifecycle status.
--   2. retrain_events       — log of every retrain attempt (manual,
--                             scheduled, WAPE-breach), linking parent model
--                             to output model with status/timing.
--   3. forecast_snapshots
--      .model_version_id    — additive nullable FK to model_versions.id.
--                             Existing rows keep this NULL (sentinel for
--                             "pre-lineage"). New writes populate it.
--
-- All changes are additive — no existing column is dropped or modified, so
-- this migration is safe to apply to a populated production database.
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`model_kind` text NOT NULL,
	`version_number` integer NOT NULL,
	`r2_key` text,
	`parent_model_id` text,
	`trained_at` integer NOT NULL,
	`training_window_start` text NOT NULL,
	`training_window_end` text NOT NULL,
	`training_actuals_count` integer DEFAULT 0 NOT NULL,
	`validation_metrics_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`activated_at` integer,
	`superseded_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_versions_unique_idx` ON `model_versions` (`tenant_id`,`model_kind`,`version_number`);
--> statement-breakpoint
CREATE INDEX `model_versions_active_idx` ON `model_versions` (`tenant_id`,`model_kind`,`status`);
--> statement-breakpoint
CREATE INDEX `model_versions_parent_idx` ON `model_versions` (`parent_model_id`);
--> statement-breakpoint
CREATE TABLE `retrain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`model_kind` text NOT NULL,
	`triggered_by` text NOT NULL,
	`triggered_by_user_id` text,
	`trigger_metric` text,
	`trigger_value` text,
	`trigger_threshold` text,
	`parent_model_id` text,
	`output_model_id` text,
	`training_window_start` text NOT NULL,
	`training_window_end` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`status_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `retrain_events_tenant_status_idx` ON `retrain_events` (`tenant_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `retrain_events_output_idx` ON `retrain_events` (`output_model_id`);
--> statement-breakpoint
CREATE INDEX `retrain_events_parent_idx` ON `retrain_events` (`parent_model_id`);
--> statement-breakpoint
ALTER TABLE `forecast_snapshots` ADD `model_version_id` text;
--> statement-breakpoint
CREATE INDEX `forecast_snap_model_version_idx` ON `forecast_snapshots` (`model_version_id`);
