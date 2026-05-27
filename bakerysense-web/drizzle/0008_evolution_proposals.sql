-- Evolution proposals (Self-Evolving Harness, Pending Approval Queue).
--
-- A row is created by the nightly inspector (src/lib/harness/inspector.ts)
-- when it has identified a learnable miss pattern and proposed a bounded
-- edit on a skill's rules_json. The validator runs the edit against a
-- strictly disjoint holdout window before the row reaches owner approval.
--
-- Lifecycle:
--   pending              → validation passed; awaiting owner review.
--   approved             → owner accepted; a new skill_versions row was
--                          created with status=active and this proposal's
--                          edit applied.
--   rejected             → owner rejected.
--   rejected_validation  → validator did not show meaningful improvement
--                          on the holdout window; auto-dropped without
--                          owner involvement (still recorded for audit).
--   expired              → > N days old without review; superseded.
--
-- Auditability: diagnosis_detail_json carries the per-trace classification
-- (cause + reason_code + reason_payload) so any approval decision is
-- traceable back to the rows that motivated it.
CREATE TABLE `evolution_proposals` (
  `id`                       text PRIMARY KEY NOT NULL,
  `tenant_id`                text NOT NULL,
  -- NULL = proposal targets a brand-level skill version (cross-branch
  -- promotion). NOT NULL = proposal targets the named branch's override.
  `branch_id`                text,
  `skill_id`                 text NOT NULL,
  -- The skill_versions row this proposal edits. The proposed child version
  -- will be inserted with parent_skill_version_id = this on approval.
  `parent_skill_version_id`  text NOT NULL,
  -- Ordered array of bounded edit operations: [{op, path, value, from?}]
  -- where op ∈ {'add','delete','replace'}. JSON-Patch-shaped on purpose
  -- so future LLM-augmented proposers can emit standard structures.
  `edit_ops_json`            text NOT NULL,
  -- JSON array of bake_plan_decisions.id rows that motivated this
  -- proposal (the "learnable" rows from inspector step 2).
  `evidence_trace_ids`       text NOT NULL,
  -- Gemma-narrated short summary shown to owner ("Banana cake was over-
  -- forecasted on 7 of last 8 Wednesdays by 18% ± 3%. Lower Wed multiplier
  -- to 0.85."). Numeric content is deterministic; Gemma narrates only.
  `diagnosis_summary`        text NOT NULL,
  -- Per-row classification detail. Array of {trace_id, cause, reason_code,
  -- reason_payload}. cause ∈ {stockout_capped, operator_correction,
  -- operator_override, context_shock_recurring, context_shock_one_off,
  -- skill_error, insufficient_evidence}. See harness/diagnoser.ts.
  `diagnosis_detail_json`    text NOT NULL,
  -- {before_wape, after_wape, before_mase, after_mase, holdout_window}.
  -- Populated by validator (step 4). NULL until validation runs.
  `validation_metrics_json`  text,
  -- 0 / 1 / NULL (not yet run).
  `validation_passed`        integer,
  `status`                   text NOT NULL DEFAULT 'pending',
  `reviewed_by_user_id`      text,
  `reviewed_at`              integer,
  `created_at`               integer NOT NULL,
  FOREIGN KEY (`tenant_id`)
    REFERENCES `tenants`(`id`)            ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`)
    REFERENCES `branches`(`id`)           ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`parent_skill_version_id`)
    REFERENCES `skill_versions`(`id`)     ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reviewed_by_user_id`)
    REFERENCES `users`(`id`)              ON UPDATE no action ON DELETE no action,
  -- Review coherence: reviewed_by/reviewed_at populated iff status reflects
  -- a human review outcome (approved/rejected).
  CHECK (
    (`status` IN ('pending','rejected_validation','expired')
       AND `reviewed_by_user_id` IS NULL AND `reviewed_at` IS NULL)
    OR
    (`status` IN ('approved','rejected')
       AND `reviewed_by_user_id` IS NOT NULL AND `reviewed_at` IS NOT NULL)
  )
);
--> statement-breakpoint
-- Hot path: "show me pending proposals for this tenant/branch".
CREATE INDEX `evolution_proposals_pending_idx`
  ON `evolution_proposals` (`tenant_id`, `branch_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `evolution_proposals_parent_idx`
  ON `evolution_proposals` (`parent_skill_version_id`);
--> statement-breakpoint
CREATE INDEX `evolution_proposals_skill_idx`
  ON `evolution_proposals` (`tenant_id`, `skill_id`, `created_at`);
