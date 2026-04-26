-- Per-tenant feature availability bitmap.
-- JSON array of feature IDs from src/lib/feature-registry.ts.
-- NULL means "use V1_DEFAULT_AVAILABILITY" (the 13 features the
-- current LightGBM was trained on).
ALTER TABLE `tenants` ADD COLUMN `feature_availability` text;
