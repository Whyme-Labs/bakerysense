import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantNameIdx: uniqueIndex("branches_tenant_name_idx").on(t.tenantId, t.name),
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
		modelVersion: integer("model_version").notNull().default(0),
		bakeQuantity: integer("bake_quantity").notNull(),
		quantilesJson: text("quantiles_json").notNull(),
		servedAt: integer("served_at").notNull(),
	},
	(t) => ({
		uniq: uniqueIndex("forecast_snap_unique_idx").on(t.tenantId, t.branchId, t.family, t.date, t.modelVersion),
		lookup: index("forecast_snap_lookup_idx").on(t.tenantId, t.branchId, t.date),
	}),
);
