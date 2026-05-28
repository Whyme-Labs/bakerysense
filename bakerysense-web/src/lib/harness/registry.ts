// Skill registry — load builtin defaults + active DB-stored rules, then
// resolve the effective rules for any (tenant, branch, skill).
//
// Three layers, in priority order from low to high:
//   1. Builtin defaults  — JSON files in src/lib/skills/<skill_id>/ shipped
//                          with this Worker. Used as the bootstrap baseline
//                          when no DB row exists for the brand-level scope.
//   2. Brand DB row      — skill_versions(branch_id IS NULL, status='active').
//                          Replaces the entire builtin baseline once present;
//                          the brand row is always stored *full*, not sparse.
//   3. Branch DB row     — skill_versions(branch_id = <branchId>, status='active').
//                          Stored sparse — only the keys this branch has
//                          diverged on. Merged on top of the brand baseline
//                          via resolver.deepMergeRules.
//
// Manifests do NOT evolve at runtime. They ship in the Worker bundle and
// change only via code releases (a manifest change = a contract change =
// reviewable in PR). Only rules.json evolves through the harness.
//
// See docs/architecture/self-evolving-harness.md §6–7 for the broader loop.
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { skillVersions } from "@/db/schema";
import { deepMergeRules, type Rules } from "./resolver";

import forecastManifest from "@/lib/skills/forecast/skill.manifest.json";
import forecastRules from "@/lib/skills/forecast/skill.rules.json";
import bakePlanManifest from "@/lib/skills/bake_plan/skill.manifest.json";
import bakePlanRules from "@/lib/skills/bake_plan/skill.rules.json";

// Known skill identifiers in this build. Adding a new skill = adding a new
// directory under src/lib/skills/ + a new entry below. Anything not in
// this set is rejected at the registry boundary so a typo'd skill_id can't
// silently fall through to a DB query that finds nothing.
export const SKILL_IDS = ["forecast", "bake_plan"] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export function isSkillId(s: string): s is SkillId {
	return (SKILL_IDS as readonly string[]).includes(s);
}

interface SkillManifest {
	skill_id: string;
	version: string;
	goal: string;
	[k: string]: unknown;
}

interface SkillBuiltin {
	manifest: SkillManifest;
	rules: Rules;
}

// JSON imports come back with deeply-readonly inferred types. Cast once
// at the boundary so the rest of the module can treat them as Rules.
export const BUILTIN_SKILLS: Record<SkillId, SkillBuiltin> = {
	forecast: {
		manifest: forecastManifest as SkillManifest,
		rules: forecastRules as Rules,
	},
	bake_plan: {
		manifest: bakePlanManifest as SkillManifest,
		rules: bakePlanRules as Rules,
	},
};

export function getManifest(skillId: SkillId): SkillManifest {
	return BUILTIN_SKILLS[skillId].manifest;
}

/** Active brand-level rules for (tenant, skill).
 *  Returns the builtin baseline when no DB row exists. Once the brand
 *  has ever evolved a skill, this returns the latest active brand row's
 *  full rules_json (not the builtin). */
export async function getActiveBrandRules(
	env: CloudflareEnv,
	tenantId: string,
	skillId: SkillId,
): Promise<Rules> {
	const row = await getDb(env)
		.select({ rulesJson: skillVersions.rulesJson })
		.from(skillVersions)
		.where(
			and(
				eq(skillVersions.tenantId, tenantId),
				isNull(skillVersions.branchId),
				eq(skillVersions.skillId, skillId),
				eq(skillVersions.status, "active"),
			),
		)
		.orderBy(desc(skillVersions.versionNumber))
		.limit(1)
		.all();
	if (row.length === 0) return BUILTIN_SKILLS[skillId].rules;
	return JSON.parse(row[0].rulesJson) as Rules;
}

/** Active branch-level *sparse override* for (tenant, branch, skill).
 *  Returns null when the branch has never diverged from brand. */
export async function getActiveBranchRules(
	env: CloudflareEnv,
	tenantId: string,
	branchId: string,
	skillId: SkillId,
): Promise<Rules | null> {
	const row = await getDb(env)
		.select({ rulesJson: skillVersions.rulesJson })
		.from(skillVersions)
		.where(
			and(
				eq(skillVersions.tenantId, tenantId),
				eq(skillVersions.branchId, branchId),
				eq(skillVersions.skillId, skillId),
				eq(skillVersions.status, "active"),
			),
		)
		.orderBy(desc(skillVersions.versionNumber))
		.limit(1)
		.all();
	if (row.length === 0) return null;
	return JSON.parse(row[0].rulesJson) as Rules;
}

/** Effective runtime rules for a (tenant, branch, skill) call site.
 *  Pulls brand + branch and merges via the resolver. This is the
 *  function every skill implementation should call to read its config. */
export async function loadEffectiveRules(
	env: CloudflareEnv,
	tenantId: string,
	branchId: string,
	skillId: SkillId,
): Promise<Rules> {
	const [brand, branch] = await Promise.all([
		getActiveBrandRules(env, tenantId, skillId),
		getActiveBranchRules(env, tenantId, branchId, skillId),
	]);
	return deepMergeRules(brand, branch);
}
