import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const tenants = sqliteTable("tenants", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	vertical: text("vertical").notNull(),
	plan: text("plan").notNull().default("free"),
	createdAt: integer("created_at").notNull(),
	// JSON array of feature IDs from src/lib/feature-registry.ts; NULL means
	// "use V1_DEFAULT_AVAILABILITY". Populated at tenant onboarding from
	// connector capability detection. See feature-registry.ts for layout.
	featureAvailability: text("feature_availability"),
});

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		emailVerified: integer("email_verified").notNull().default(0),
		createdAt: integer("created_at").notNull(),
		lastLoginAt: integer("last_login_at"),
	},
	(t) => ({
		emailIdx: uniqueIndex("users_email_idx").on(t.email),
	}),
);

export const memberships = sqliteTable(
	"memberships",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		role: text("role", { enum: ["platform_admin", "tenant_admin", "branch_manager", "staff", "viewer"] }).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		userTenantIdx: uniqueIndex("memberships_user_tenant_idx").on(t.userId, t.tenantId),
		tenantIdx: index("memberships_tenant_idx").on(t.tenantId),
	}),
);

export const branches = sqliteTable(
	"branches",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		name: text("name").notNull(),
		city: text("city"),
		cluster: text("cluster"),
		type: text("type"),
		// V2 ingestion: lat/lon/timezone unlocks weather + festival joins.
		// Nullable so existing branches keep working; the cron and the feature
		// pipeline both no-op when these are absent.
		lat: text("lat"),                  // SQLite stores as TEXT; parsed as float at use site
		lon: text("lon"),
		timezone: text("timezone"),        // IANA tz, e.g. "Europe/Paris"
		locale: text("locale"),            // BCP-47 region for festival lookup, e.g. "fr-FR" or "en-SG"
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantNameIdx: uniqueIndex("branches_tenant_name_idx").on(t.tenantId, t.name),
	}),
);

export const branchWeatherDaily = sqliteTable(
	"branch_weather_daily",
	{
		branchId: text("branch_id").notNull().references(() => branches.id),
		date: text("date").notNull(),                  // ISO YYYY-MM-DD
		temperatureMeanC: text("temperature_mean_c"),  // °C, daily mean
		precipitationMm: text("precipitation_mm"),    // mm
		humidityMeanPct: text("humidity_mean_pct"),
		uvIndexMax: text("uv_index_max"),
		windSpeedMaxKmh: text("wind_speed_max_kmh"),
		isStorm: integer("is_storm").default(0),       // 0 / 1 — storm warning hit
		source: text("source").notNull(),              // "open_meteo_archive" | "open_meteo_forecast"
		fetchedAt: integer("fetched_at").notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.branchId, t.date] }),
		dateIdx: index("branch_weather_date_idx").on(t.date),
	}),
);

export const branchAccess = sqliteTable(
	"branch_access",
	{
		membershipId: text("membership_id").notNull().references(() => memberships.id),
		branchId: text("branch_id").notNull().references(() => branches.id),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.membershipId, t.branchId] }),
	}),
);

export const auditLog = sqliteTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull(),
		actorUserId: text("actor_user_id"),
		action: text("action").notNull(),
		target: text("target"),
		metadataJson: text("metadata_json"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantTimeIdx: index("audit_tenant_time_idx").on(t.tenantId, t.createdAt),
	}),
);

export const dailyActuals = sqliteTable(
	"daily_actuals",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		branchId: text("branch_id").notNull().references(() => branches.id),
		family: text("family").notNull(),
		date: text("date").notNull(),
		recommendedBake: integer("recommended_bake"),
		actualBake: integer("actual_bake"),
		actualSales: integer("actual_sales"),
		wasteUnits: integer("waste_units"),
		source: text("source", { enum: ["manual", "close_out_photo", "pos_import", "csv_import"] }).notNull(),
		capturedByUserId: text("captured_by_user_id").references(() => users.id),
		capturedAt: integer("captured_at").notNull(),
	},
	(t) => ({
		tenantBranchFamilyDateIdx: uniqueIndex("daily_actuals_unique_idx").on(
			t.tenantId, t.branchId, t.family, t.date,
		),
		tenantBranchDateIdx: index("daily_actuals_lookup_idx").on(t.tenantId, t.branchId, t.date),
	}),
);

export const forecastSnapshots = sqliteTable(
	"forecast_snapshots",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		branchId: text("branch_id").notNull().references(() => branches.id),
		family: text("family").notNull(),
		date: text("date").notNull(),
		// Legacy integer model_version column. Kept nullable-default-0 for
		// pre-lineage rows. New writes additionally populate modelVersionId
		// (FK to modelVersions). Once all live rows have a non-null
		// modelVersionId, this column can be dropped in a follow-up migration.
		modelVersion: integer("model_version").notNull().default(0),
		// Decision-lineage FK introduced in migration 0004. Nullable on
		// existing rows; required for new writes via the forecast writer.
		// References modelVersions.id (a tenant-scoped uuid).
		modelVersionId: text("model_version_id"),
		bakeQuantity: integer("bake_quantity").notNull(),
		quantilesJson: text("quantiles_json").notNull(),
		servedAt: integer("served_at").notNull(),
	},
	(t) => ({
		uniq: uniqueIndex("forecast_snap_unique_idx").on(t.tenantId, t.branchId, t.family, t.date, t.modelVersion),
		lookup: index("forecast_snap_lookup_idx").on(t.tenantId, t.branchId, t.date),
		modelVersionIdx: index("forecast_snap_model_version_idx").on(t.modelVersionId),
	}),
);

// Decision lineage — model artifact registry.
//
// Every active forecaster (gbm_v1, v1_5_prior, perq_blend_v1, perq_blend_v2)
// gets a row per (tenant, kind, version_number). The KV pointer
// `tenant:{tenantId}:model_pointer:{kind}` continues to be the runtime fast
// path; this table is the durable, queryable source of truth for audits,
// rollback, and reproducibility.
//
// Status transitions:
//   draft        → trained but not yet active for tenant
//   active       → currently serving forecasts (one per tenant×kind)
//   superseded   → was active, replaced by a newer version
//   rolled_back  → was active, manually demoted (still readable, not serving)
export const modelVersions = sqliteTable(
	"model_versions",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		// Forecaster kind. Mirrors the values in src/lib/forecasters/.
		modelKind: text("model_kind", {
			enum: ["gbm_v1", "v1_5_prior", "perq_blend_v1", "perq_blend_v2", "timesfm_v2"],
		}).notNull(),
		// Monotonic per (tenant, modelKind). Bumped by the retrain pipeline.
		versionNumber: integer("version_number").notNull(),
		// R2 key for the model artifact, when applicable. NULL for in-Worker
		// priors (V1.5 lives entirely in code; only its training metadata is
		// stored here).
		r2Key: text("r2_key"),
		// Lineage chain — points at the previous active version that this one
		// replaced (NULL only for the first version per kind per tenant).
		parentModelId: text("parent_model_id"),
		trainedAt: integer("trained_at").notNull(),
		// Training data window — ISO YYYY-MM-DD inclusive on both ends.
		trainingWindowStart: text("training_window_start").notNull(),
		trainingWindowEnd: text("training_window_end").notNull(),
		// Number of (tenant, branch, family, date) rows in the training set.
		// Useful for cold-start reasoning ("we only had 47 actuals").
		trainingActualsCount: integer("training_actuals_count").notNull().default(0),
		// JSON blob: {"wape": 0.21, "mase": 0.62, "pinball_q05": 2.04, "pinball_q09": 1.15}.
		// Validation metrics on the held-out tail of the training window.
		validationMetricsJson: text("validation_metrics_json"),
		status: text("status", { enum: ["draft", "active", "superseded", "rolled_back"] })
			.notNull()
			.default("draft"),
		activatedAt: integer("activated_at"),
		supersededAt: integer("superseded_at"),
		notes: text("notes"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantKindVersionIdx: uniqueIndex("model_versions_unique_idx").on(
			t.tenantId, t.modelKind, t.versionNumber,
		),
		tenantKindStatusIdx: index("model_versions_active_idx").on(
			t.tenantId, t.modelKind, t.status,
		),
		parentIdx: index("model_versions_parent_idx").on(t.parentModelId),
	}),
);

// Decision lineage — retrain event log.
//
// Every retrain (manual button, scheduled cron, WAPE-breach trigger) creates
// a row at queue time with status=queued. The consumer flips it to running
// and finally succeeded/failed with the output_model_id linked. On failure,
// status_message records the reason; the parent_model_id stays active.
export const retrainEvents = sqliteTable(
	"retrain_events",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		modelKind: text("model_kind", {
			enum: ["gbm_v1", "v1_5_prior", "perq_blend_v1", "perq_blend_v2", "timesfm_v2"],
		}).notNull(),
		// Why this retrain fired.
		triggeredBy: text("triggered_by", {
			enum: ["wape_breach", "manual", "schedule", "ops_force", "first_train"],
		}).notNull(),
		triggeredByUserId: text("triggered_by_user_id").references(() => users.id),
		// Trigger metric details (NULL when triggeredBy is "manual"/"first_train").
		triggerMetric: text("trigger_metric"),       // e.g. "rolling_wape_p7"
		triggerValue: text("trigger_value"),          // stored as TEXT for fp safety
		triggerThreshold: text("trigger_threshold"),
		// Lineage chain. parent_model_id = the version this retrain is replacing
		// (NULL only on first_train). output_model_id is filled in once training
		// succeeds and a new model_versions row is committed.
		parentModelId: text("parent_model_id"),
		outputModelId: text("output_model_id"),
		// Training window planned at queue time (consumer may extend).
		trainingWindowStart: text("training_window_start").notNull(),
		trainingWindowEnd: text("training_window_end").notNull(),
		status: text("status", {
			enum: ["queued", "running", "succeeded", "failed", "cancelled"],
		}).notNull().default("queued"),
		statusMessage: text("status_message"),
		startedAt: integer("started_at"),
		completedAt: integer("completed_at"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantStatusTimeIdx: index("retrain_events_tenant_status_idx").on(
			t.tenantId, t.status, t.createdAt,
		),
		outputModelIdx: index("retrain_events_output_idx").on(t.outputModelId),
		parentModelIdx: index("retrain_events_parent_idx").on(t.parentModelId),
	}),
);

// Three-options bake plan — committed operator choices.
//
// One row per committed plan choice: (tenant, branch, family, date) unique.
// Records which option kind the baker chose (conservative / balanced /
// aggressive / custom), the bake quantity, the lineage links back to the
// forecast snapshot and model version, expected outcomes at commit time (for
// later reconciliation against actuals), and full audit metadata.
//
// model_version_id is denormalised from forecast_snapshots so lineage joins
// are one hop rather than two.
export const bakePlanDecisions = sqliteTable(
	"bake_plan_decisions",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		branchId: text("branch_id").notNull().references(() => branches.id),
		family: text("family").notNull(),
		date: text("date").notNull(),
		optionKind: text("option_kind", {
			enum: ["conservative", "balanced", "aggressive", "custom"],
		}).notNull(),
		bakeQuantity: integer("bake_quantity").notNull(),
		// Lineage links — denormalised from forecast_snapshots so the join is one hop.
		forecastSnapshotId: text("forecast_snapshot_id").references(() => forecastSnapshots.id),
		modelVersionId: text("model_version_id").references(() => modelVersions.id),
		// Expected outcomes computed at commit time (units, not currency).
		expectedWasteUnits: text("expected_waste_units"),     // numeric stored as TEXT for fp safety
		expectedStockoutProb: text("expected_stockout_prob"), // 0..1
		expectedUnitsSold: text("expected_units_sold"),
		committedByUserId: text("committed_by_user_id").notNull().references(() => users.id),
		committedAt: integer("committed_at").notNull(),
		notes: text("notes"),
	},
	(t) => ({
		uniq: uniqueIndex("bake_plan_decisions_unique_idx").on(t.tenantId, t.branchId, t.family, t.date),
		lookupIdx: index("bake_plan_decisions_lookup_idx").on(t.tenantId, t.branchId, t.date),
		snapIdx: index("bake_plan_decisions_snapshot_idx").on(t.forecastSnapshotId),
		modelVersionIdx: index("bake_plan_decisions_model_version_idx").on(t.modelVersionId),
		// Lineage coherence: forecast_snapshot_id and model_version_id are a
		// denormalised pair — either both NULL (no lineage) or both set.
		lineageCoherent: check(
			"bake_plan_decisions_lineage_coherent",
			sql`(${t.forecastSnapshotId} IS NULL AND ${t.modelVersionId} IS NULL) OR (${t.forecastSnapshotId} IS NOT NULL AND ${t.modelVersionId} IS NOT NULL)`,
		),
	}),
);
