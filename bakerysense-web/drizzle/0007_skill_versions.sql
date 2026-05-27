-- Skill version registry (Self-Evolving Harness foundation).
--
-- A `skill` is a tool with a manifest (contract) + rules.json (evolvable
-- state). This table mirrors `model_versions` (drizzle 0004) but tracks
-- skill *artifacts* instead of ML model artifacts.
--
-- Hierarchical scope (brand × branch):
--   branch_id IS NULL  → brand-level default (applies to every branch
--                        unless overridden).
--   branch_id IS NOT NULL → branch-level override for that branch only.
--
-- A branch's effective skill rules at runtime = deep_merge(
--   active brand-level rules_json,
--   active branch-level rules_json,
-- )  -- branch wins per-key. See src/lib/harness/resolver.ts.
--
-- Evolution ancestry is recorded via parent_skill_version_id (a graph,
-- not a tree — promotion from branch → brand creates a node whose parent
-- is the branch row that motivated it).
CREATE TABLE `skill_versions` (
  `id`                       text PRIMARY KEY NOT NULL,
  `tenant_id`                text NOT NULL,
  -- NULL = brand-level default. NOT NULL = branch-level override.
  `branch_id`                text,
  -- Logical skill identifier. Matches the directory name under
  -- src/lib/skills/ (e.g. 'forecast', 'bake_plan', 'waste_risk').
  `skill_id`                 text NOT NULL,
  -- Monotonic per (tenant_id, COALESCE(branch_id,''), skill_id).
  `version_number`           integer NOT NULL,
  -- Lineage chain. Points at the version this one supersedes. NULL only
  -- for the first version per skill per scope.
  `parent_skill_version_id`  text,
  -- Skill contract — declared inputs, outputs, constraints, eval metrics.
  -- Mirrors the JSON in src/lib/skills/<skill_id>/skill.manifest.json at
  -- the time this version was created.
  `manifest_json`            text NOT NULL,
  -- Evolvable payload. The proposer's bounded edits target this JSON.
  -- Format is skill-specific (see manifest.evolvable_via for shape).
  `rules_json`               text NOT NULL,
  -- Lifecycle:
  --   draft       → created but not yet serving (e.g. pending approval).
  --   active      → currently in use for this scope.
  --   superseded  → was active, replaced by a newer version.
  --   rejected    → proposed but never activated (validation/approval failed).
  `status`                   text NOT NULL DEFAULT 'draft',
  `activated_at`             integer,
  `superseded_at`            integer,
  -- WAPE/MASE on the holdout window at the time this version was promoted.
  -- NULL for the bootstrap/built-in version (no holdout to score against).
  `validation_metrics_json`  text,
  `created_at`               integer NOT NULL,
  FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`)                  ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`)
    REFERENCES `branches`(`id`)                 ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`parent_skill_version_id`)
    REFERENCES `skill_versions`(`id`)           ON UPDATE no action ON DELETE no action,
  -- Status sanity: activated_at/superseded_at are only meaningful for
  -- non-draft rows.
  CHECK (
    (`status` = 'draft'      AND `activated_at` IS NULL AND `superseded_at` IS NULL)
    OR
    (`status` = 'active'     AND `activated_at` IS NOT NULL AND `superseded_at` IS NULL)
    OR
    (`status` = 'superseded' AND `activated_at` IS NOT NULL AND `superseded_at` IS NOT NULL)
    OR
    (`status` = 'rejected')
  )
);
--> statement-breakpoint
-- Unique per (tenant, scope, skill, version). COALESCE folds brand-level
-- (branch_id NULL) rows into the empty-string bucket so version_number is
-- monotonic within each scope.
CREATE UNIQUE INDEX `skill_versions_unique_idx`
  ON `skill_versions` (`tenant_id`, COALESCE(`branch_id`, ''), `skill_id`, `version_number`);
--> statement-breakpoint
-- Hot path: "current active rules for (tenant, branch, skill)".
CREATE INDEX `skill_versions_active_idx`
  ON `skill_versions` (`tenant_id`, `branch_id`, `skill_id`, `status`);
--> statement-breakpoint
CREATE INDEX `skill_versions_parent_idx`
  ON `skill_versions` (`parent_skill_version_id`);
