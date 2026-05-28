// skill_versions lifecycle — bootstrap, lookup, and the parent-version
// resolution the proposal writer needs.
//
// Layers (see docs/architecture/self-evolving-harness.md §7):
//   - brand row  (branch_id NULL): the tenant-wide baseline. Bootstrapped
//     lazily from the bundled builtin rules the first time it's needed, so
//     existing tenants join the harness without a backfill.
//   - branch row (branch_id set): a sparse override on top of brand.
//
// Version activation/supersession on approval lives in the approval path
// (see the /harness route); this module provides the reads + the brand
// bootstrap that the inspector relies on to satisfy the NOT NULL
// parent_skill_version_id FK on evolution_proposals.
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { skillVersions } from "@/db/schema";
import { BUILTIN_SKILLS, getManifest, type SkillId } from "@/lib/harness/registry";

type SkillVersionRow = typeof skillVersions.$inferSelect;

function newId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return "skv_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

/** Active version for a scope. branchId null → brand-level. */
export async function getActiveVersion(
	env: CloudflareEnv,
	tenantId: string,
	skillId: SkillId,
	branchId: string | null,
): Promise<SkillVersionRow | null> {
	const rows = await getDb(env)
		.select()
		.from(skillVersions)
		.where(
			and(
				eq(skillVersions.tenantId, tenantId),
				branchId === null ? isNull(skillVersions.branchId) : eq(skillVersions.branchId, branchId),
				eq(skillVersions.skillId, skillId),
				eq(skillVersions.status, "active"),
			),
		)
		.orderBy(desc(skillVersions.versionNumber))
		.limit(1)
		.all();
	return rows[0] ?? null;
}

/** Highest version_number in a scope (0 when none), for monotonic bumping. */
export async function maxVersionNumber(
	env: CloudflareEnv,
	tenantId: string,
	skillId: SkillId,
	branchId: string | null,
): Promise<number> {
	const rows = await getDb(env)
		.select({ v: skillVersions.versionNumber })
		.from(skillVersions)
		.where(
			and(
				eq(skillVersions.tenantId, tenantId),
				branchId === null ? isNull(skillVersions.branchId) : eq(skillVersions.branchId, branchId),
				eq(skillVersions.skillId, skillId),
			),
		)
		.orderBy(desc(skillVersions.versionNumber))
		.limit(1)
		.all();
	return rows[0]?.v ?? 0;
}

/** Active brand-level version, bootstrapped from the bundled builtin rules
 *  on first use. The bootstrap row is byte-for-byte the builtin baseline,
 *  so loadEffectiveRules behaves identically before and after. */
export async function getOrCreateActiveBrandVersion(
	env: CloudflareEnv,
	tenantId: string,
	skillId: SkillId,
): Promise<SkillVersionRow> {
	const existing = await getActiveVersion(env, tenantId, skillId, null);
	if (existing) return existing;

	const now = Date.now();
	const id = newId();
	await getDb(env).insert(skillVersions).values({
		id,
		tenantId,
		branchId: null,
		skillId,
		versionNumber: 1,
		parentSkillVersionId: null,
		manifestJson: JSON.stringify(getManifest(skillId)),
		rulesJson: JSON.stringify(BUILTIN_SKILLS[skillId].rules),
		status: "active",
		activatedAt: now,
		supersededAt: null,
		validationMetricsJson: null,
		createdAt: now,
	});
	const created = await getActiveVersion(env, tenantId, skillId, null);
	// Should always exist now; fall back defensively.
	if (!created) throw new Error("failed to bootstrap brand skill version");
	return created;
}

/** The version a new proposal/edit is layered on top of: the active branch
 *  version if the branch has already diverged, else the (bootstrapped)
 *  active brand version. */
export async function resolveParentVersionId(
	env: CloudflareEnv,
	tenantId: string,
	branchId: string,
	skillId: SkillId,
): Promise<string> {
	const branch = await getActiveVersion(env, tenantId, skillId, branchId);
	if (branch) return branch.id;
	const brand = await getOrCreateActiveBrandVersion(env, tenantId, skillId);
	return brand.id;
}

export interface ActivateArgs {
	tenantId: string;
	branchId: string | null;
	skillId: SkillId;
	/** The full rules document for the new version (brand: full; branch: sparse). */
	rulesJson: string;
	/** Lineage parent. Defaults to the superseded version's id. */
	parentId?: string | null;
	validationMetricsJson?: string | null;
}

/** Supersede the current active version for a scope (if any) and insert a new
 *  active version with a bumped version number. Returns the new version id.
 *
 *  v1 does sequential writes (supersede then insert); there is a brief moment
 *  with no active row, which is fine under the single-owner approval flow. */
export async function supersedeAndActivate(env: CloudflareEnv, args: ActivateArgs): Promise<string> {
	const db = getDb(env);
	const now = Date.now();
	const current = await getActiveVersion(env, args.tenantId, args.skillId, args.branchId);
	const version = (await maxVersionNumber(env, args.tenantId, args.skillId, args.branchId)) + 1;

	if (current) {
		await db
			.update(skillVersions)
			.set({ status: "superseded", supersededAt: now })
			.where(eq(skillVersions.id, current.id));
	}

	const id = newId();
	await db.insert(skillVersions).values({
		id,
		tenantId: args.tenantId,
		branchId: args.branchId,
		skillId: args.skillId,
		versionNumber: version,
		parentSkillVersionId: args.parentId ?? current?.id ?? null,
		manifestJson: current?.manifestJson ?? JSON.stringify(getManifest(args.skillId)),
		rulesJson: args.rulesJson,
		status: "active",
		activatedAt: now,
		supersededAt: null,
		validationMetricsJson: args.validationMetricsJson ?? null,
		createdAt: now,
	});
	return id;
}
