// Skill-rule resolver — pure deep-merge for brand × branch inheritance.
//
// At runtime a branch's effective skill rules are computed by merging the
// brand-level baseline with the branch-level override:
//
//   effective = deepMergeRules(brandRules, branchRules)
//
// Merge semantics:
//   - branch wins per key when both define the same key
//   - plain-object × plain-object → recurse
//   - anything else on the branch side replaces wholesale (arrays,
//     primitives, null, mixed-type)
//   - missing on branch → brand value passes through unchanged
//   - branch = null | undefined → returns brand unchanged
//
// This matches the SkillOpt-inspired design where the proposer emits
// bounded JSON-Patch-shaped edits against the brand baseline and the
// branch's stored override is a *sparse* object containing only the
// keys it has diverged on. See docs/architecture/self-evolving-harness.md
// §7 for the broader resolution model.
//
// The function is pure: neither input is mutated.

export type Rules = Record<string, unknown>;

/** Plain-object guard. Distinguishes `{}` from arrays, null, Date, Map etc.
 *  Important because arrays-and-null on the branch side should REPLACE the
 *  brand value rather than trigger a recursive merge. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (typeof v !== "object" || v === null) return false;
	if (Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

export function deepMergeRules(brand: Rules, branch: Rules | null | undefined): Rules {
	if (branch === null || branch === undefined) return { ...brand };
	const out: Rules = { ...brand };
	for (const key of Object.keys(branch)) {
		// Defensive: never let a branch override walk into Object.prototype.
		// Rules come from trusted sources (disk JSON + our DB writes) today,
		// but this guard is cheap and protects future ingest paths.
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		const branchValue = branch[key];
		const brandValue = brand[key];
		if (isPlainObject(brandValue) && isPlainObject(branchValue)) {
			out[key] = deepMergeRules(brandValue as Rules, branchValue as Rules);
		} else {
			out[key] = branchValue;
		}
	}
	return out;
}
