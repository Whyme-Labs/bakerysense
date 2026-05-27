# Self-Evolving Harness — Architecture Sketch

**Status:** Design sketch (2026-05-28). Not yet implemented.
**Target hackathon:** UCWS Singapore 2026.
**Influences:** SkillOpt (arXiv:2605.23904), EmbodiSkill (arXiv:2605.10332), Phil Schmid / LobeHub's "Harness" framing.

---

## 0. Thesis

BakerySense is a **self-evolving operations harness** for perishable SMEs. Skills are external, version-controlled, training-free artifacts. Each branch is its own agent with its own evolved playbook; the brand is a federation of those agents. Every night the harness replays its own execution traces, diagnoses misses, proposes bounded edits to skill artifacts, validates them on holdout data, and surfaces accepted improvements for owner approval. The forecasting model (Gemma 4 E4B + GBM) stays frozen on-device; only the skills evolve.

---

## 1. What already exists (the harness, hiding in plain sight)

| Concept | Lives at | Maps to harness term |
|---|---|---|
| Tools (6) | `bakerysense-web/src/lib/tools/` | Skills |
| Model lineage graph | `model_versions` + `retrain_events` (drizzle 0004) | Skill ancestry |
| Per-decision audit trail | `bake_plan_decisions` (drizzle 0006) | Execution trace |
| Forecast snapshots | `forecast_snapshots` + `model_version_id` FK | Per-step trace event |
| Decision-lineage UI | `live-model-tab-lineage.png` | Execution-trace UI |
| Multi-tenant + branches | `tenants` × `branches` | Hierarchical agent identity |
| Hierarchical reconciliation | `hierarchical.ts` | (forecast-only; pattern reused for skills) |

The trace plumbing is done. What's missing: **(a)** skills-as-versioned-artifacts, **(b)** the diagnose→propose→validate loop, **(c)** brand↔branch inheritance for skills.

---

## 2. Four new concepts

1. **Skill manifest** — JSON file shipped next to each tool; declares inputs/outputs/constraints/eval-metrics.
2. **Skill version registry** — mirrors `model_versions` but for skill artifacts (`skill_versions` table).
3. **Evolution proposal** — a bounded edit (add/delete/replace) on a skill manifest, awaiting validation + owner approval. (SkillOpt's contribution.)
4. **Miss diagnosis** — when next-day actuals arrive, classify each forecast miss. Only genuine skill faults feed the proposer. (EmbodiSkill's contribution.)

---

## 3. File / code layout (additive only)

```
bakerysense-web/
  src/lib/
    skills/                          # NEW — was "tools/"; tools/ kept as alias
      forecast/
        skill.manifest.json          # NEW — contract
        skill.ts                     # = existing tools/forecast.ts
        skill.rules.json             # NEW — evolvable rules
      bake_plan/
        skill.manifest.json
        skill.ts
        skill.rules.json
      waste_risk/ ...
      explain_drivers/ ...

    harness/                         # NEW — the runtime layer
      registry.ts                    # load+resolve skills (brand→branch override)
      resolver.ts                    # hierarchical merge: category < brand < branch
      proposer.ts                    # SkillOpt-style bounded edits
      validator.ts                   # replay against holdout, score, accept/reject
      diagnoser.ts                   # EmbodiSkill miss-classification
      inspector.ts                   # nightly orchestrator
      trace.ts                       # thin wrapper over existing lineage tables

    skill-versions.ts                # NEW — DB access (mirrors model_versions)
    evolution-proposals.ts           # NEW — DB access

  drizzle/
    0007_skill_versions.sql          # NEW
    0008_evolution_proposals.sql     # NEW

  src/app/t/[tenant]/
    harness/                         # NEW — UI
      page.tsx                       # "Harness Evolution" — pending proposals
      [proposalId]/page.tsx          # diff view + approve/reject
```

No deletions. Existing `tools/index.ts` re-exports from `skills/*/skill.ts` so nothing breaks.

---

## 4. Data model deltas

### 4.1 `0007_skill_versions.sql`

```sql
CREATE TABLE skill_versions (
  id                      text PRIMARY KEY NOT NULL,
  tenant_id               text NOT NULL,
  branch_id               text,              -- NULL = brand-level; set = branch override
  skill_id                text NOT NULL,     -- 'forecast' | 'bake_plan' | ...
  version_number          integer NOT NULL,
  parent_skill_version_id text,              -- evolution ancestry
  manifest_json           text NOT NULL,
  rules_json              text NOT NULL,     -- the evolvable payload
  status                  text NOT NULL DEFAULT 'draft',
                                             -- draft|active|superseded|rejected
  activated_at            integer,
  superseded_at           integer,
  validation_metrics_json text,              -- WAPE/MASE on holdout at promotion time
  created_at              integer NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (parent_skill_version_id) REFERENCES skill_versions(id)
);
CREATE UNIQUE INDEX skill_versions_unique
  ON skill_versions(tenant_id, COALESCE(branch_id, ''), skill_id, version_number);
CREATE INDEX skill_versions_active
  ON skill_versions(tenant_id, branch_id, skill_id, status);
```

### 4.2 `0008_evolution_proposals.sql`

```sql
CREATE TABLE evolution_proposals (
  id                      text PRIMARY KEY NOT NULL,
  tenant_id               text NOT NULL,
  branch_id               text,              -- NULL = brand-level
  skill_id                text NOT NULL,
  parent_skill_version_id text NOT NULL,
  edit_ops_json           text NOT NULL,     -- [{op,path,value,from?}]
  evidence_trace_ids      text NOT NULL,     -- JSON array of bake_plan_decisions.id
  diagnosis_summary       text NOT NULL,     -- Gemma-narrated, human-readable
  diagnosis_detail_json   text NOT NULL,     -- per-row classification + reason_code
                                             -- (auditability — see §6 step 2)
  validation_metrics_json text,              -- before/after WAPE on holdout
  validation_passed       integer,           -- 0/1; null = not yet run
  status                  text NOT NULL DEFAULT 'pending',
                                             -- pending|approved|rejected|expired|rejected_validation
  reviewed_by_user_id     text,
  reviewed_at             integer,
  created_at              integer NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (parent_skill_version_id) REFERENCES skill_versions(id)
);
CREATE INDEX evolution_proposals_pending
  ON evolution_proposals(tenant_id, branch_id, status, created_at);
```

Both tables additive; no existing-row migration needed.

---

## 5. Skill manifest schema

`src/lib/skills/forecast/skill.manifest.json`:

```json
{
  "skill_id": "forecast",
  "version": "1.0.0",
  "goal": "Produce per-SKU per-branch quantile demand forecast for D+1.",
  "inputs": [
    {"name": "branch_id", "type": "string", "required": true},
    {"name": "horizon_days", "type": "int", "default": 1},
    {"name": "quantiles", "type": "float[]", "default": [0.5, 0.7, 0.9]}
  ],
  "outputs": [
    {"name": "forecast_by_sku", "type": "ForecastTable"},
    {"name": "confidence", "type": "float"},
    {"name": "explanation_features", "type": "SHAP"}
  ],
  "tools_allowed": ["model_versions.read", "weather.read", "festivals.read"],
  "tools_forbidden": ["llm.generate_numbers"],
  "constraints": [
    "Forecast quantity must be non-negative.",
    "Confidence < 0.4 must set flag low_confidence=true.",
    "Numeric output comes from GBM only; LLM is never the source of quantities."
  ],
  "eval_metrics": ["wape", "mase", "stockout_rate", "waste_rate"],
  "evolvable_via": "skill.rules.json"
}
```

`skill.rules.json` is the **evolvable** surface:

```json
{
  "dow_multipliers": {
    "Mon": 1.00, "Tue": 1.00, "Wed": 1.00,
    "Thu": 1.05, "Fri": 1.18, "Sat": 1.30, "Sun": 0.85
  },
  "event_overrides": [
    {"event": "school_holiday", "multiplier": 1.12, "scope": "all"}
  ],
  "sku_adjustments": [],
  "stockout_correction_factor": 1.05,
  "waste_penalty_window_days": 3
}
```

Manifest = **contract** (rarely changes). `rules.json` = **state** (evolves nightly). This separation is the SkillOpt pattern.

---

## 6. The nightly self-inspection loop

`src/lib/harness/inspector.ts` — runs once per day per branch:

```
function nightlyInspect(branch):
  # 1. PULL TRACES
  decisions = bake_plan_decisions WHERE branch_id = branch
              AND date IN [last 7 days]
  actuals   = sales WHERE branch_id = branch AND date IN [last 7 days]
  joined    = decisions ⨝ actuals

  # 2. DIAGNOSE EACH MISS (EmbodiSkill)
  # Classification is deterministic priority-ordered. Each row gets ONE cause
  # plus a reason_code recording which rule fired (auditability).
  for row in joined where |forecast - actual| / actual > 0.15:
    cause, reason_code, reason_payload = diagnoser.classify(row, context = {
      weather: weather_for(row.date, branch),
      festivals: festivals_for(row.date, branch),
      operator_edit: row.option_kind != 'recommended',
      historical_event_corr: historical_correlation(row.event, row.family, branch),
    })
    row.cause, row.reason_code, row.reason_payload = cause, reason_code, reason_payload

  # Priority order (top wins):
  #   1. stockout_capped         — actual_sales == actual_bake AND waste_units == 0
  #                                ⇒ demand is censored; row is a LOWER bound only.
  #                                Excluded from skill_error learning.
  #   2. operator_correction     — operator picked non-recommended option AND
  #                                outcome better than recommended option's
  #                                predicted outcome ⇒ tacit operator knowledge,
  #                                feed proposer (treat operator's choice as truth).
  #   3. operator_override       — operator picked non-recommended option AND
  #                                outcome ≤ recommended option's prediction.
  #                                Excluded from learning (execution noise).
  #   4. context_shock_recurring — known event AND event historically correlates
  #                                with miss for this SKU ⇒ ESCALATE to engineering
  #                                ("forecast doesn't use this feature"); not a
  #                                rules.json fix. Filed as a Harness-bug task.
  #   5. context_shock_one_off   — known event, no historical correlation ⇒
  #                                excluded (one-time noise).
  #   6. skill_error             — default for unexplained miss above threshold.
  #   7. insufficient_evidence   — below threshold; no action.

  learnable_rows = filter(joined, cause IN {skill_error, operator_correction})
  if len(learnable_rows) < MIN_EVIDENCE: return

  # 3. PROPOSE BOUNDED EDIT (SkillOpt — "textual learning rate" + guardrails)
  current_rules = active skill_versions(branch, 'forecast').rules_json
  edit_ops = proposer.propose(
    current_rules,
    evidence = learnable_rows,
    budget = {
      max_ops:           3,         # at most 3 edits per night
      max_delta_per_op:  0.2,       # no single multiplier moves > 0.2
      floor:             0.5,       # multipliers clamped to [0.5, 2.0]
      ceiling:           2.0,
      exploration_every: 7,         # every 7th run, propose a probe at
                                    # un-adjusted baseline for one day
                                    # to escape censored-feedback spirals
    }
  )

  # 4. VALIDATE (SkillOpt's gate — strictly disjoint windows)
  # Evidence window: days [-7, -1]   (used in step 2)
  # Holdout window:  days [-30, -8]  (NEVER overlaps with evidence)
  # Disjoint windows prevent the validator from confirming an edit using the
  # same data that motivated it.
  holdout = traces in [date - 30, date - 8]
  before_wape = score(current_rules, holdout)
  after_rules = apply(current_rules, edit_ops)
  after_wape  = score(after_rules, holdout)
  passed = after_wape < before_wape - MIN_IMPROVEMENT

  # 5. PERSIST PROPOSAL
  evolution_proposals.insert({
    branch_id: branch,
    skill_id: 'forecast',
    edit_ops_json: edit_ops,
    evidence_trace_ids: skill_error_rows.map(.id),
    diagnosis_summary: gemma.narrate(learnable_rows, edit_ops),
    diagnosis_detail_json: [{trace_id, cause, reason_code, reason_payload} ...],
    validation_metrics_json: {before_wape, after_wape},
    validation_passed: passed,
    status: passed ? 'pending' : 'rejected_validation'
  })
```

**Gemma's role:** narrates the diagnosis ("Banana cake systematically over-forecasted on Wednesdays; 7 of last 8 Wednesdays missed by 18%±3%. Edit lowers the Wed multiplier to 0.85.") — does **not** compute the numbers. Same deterministic-core discipline as the original forecast layer.

---

## 7. Hierarchical resolution (brand × branch)

`src/lib/harness/resolver.ts`:

```
function resolveSkill(skillId, tenantId, branchId):
  brand_rules  = active skill_version(tenantId, branch_id=NULL, skillId).rules_json
                 ?? built_in_defaults(skillId)
  branch_delta = active skill_version(tenantId, branch_id=branchId, skillId).rules_json
                 ?? {}
  return deep_merge(brand_rules, branch_delta)  # branch wins per-key
```

**Promotion** (branch → brand):

```
function maybePromote(tenantId, skillId, ruleKey):
  branches_with_same_edit = COUNT(branch_versions
    WHERE rules_json[ruleKey] != brand_default[ruleKey]
    AND rules_json[ruleKey] within ±10% of each other)
  if branches_with_same_edit >= PROMOTION_THRESHOLD:
    create evolution_proposal(branch_id=NULL, ...)
```

**Privacy story:** branches never see each other's raw sales — only their *learned rule values* are compared at HQ. Brand HQ approves the promoted rule; branches keep their own override if they want to opt out.

---

## 8. Demo flow (3 minutes)

1. Open **Branch A** (Bukit Bintang — high foot traffic, office workers). Yesterday's plan. Decision-lineage trace visible.
2. Run **nightly inspect** (mocked instant). Show 2 proposals appear in `/harness`.
3. Click proposal → side-by-side diff of `skill.rules.json`. Read Gemma's diagnosis. Show WAPE before/after on holdout. Approve.
4. Switch to **Branch B** (Subang — suburban, weekend-heavy). Same brand, same starting rules. Show *its* harness has produced *different* proposals — banana cake spike on Sundays, not Wednesdays. Branches have diverged.
5. Open **Brand HQ** view. Show "3 of 5 branches independently lowered Wed multiplier for `banana_cake` → promote to brand default?" Approve.
6. Switch to **Branch C** (new branch, joined yesterday). Show it inherits the just-promoted brand rule — no cold-start.

Two cuts of self-evolution (branch local + brand federation) in one demo, powered by existing decision-lineage backbone.

---

## 9. Three-day cut vs. stretch

**Must-ship (3 days):**
- `0007_skill_versions.sql`, `0008_evolution_proposals.sql`
- Manifests + `rules.json` for `forecast` and `bake_plan` only
- `resolver.ts`, `inspector.ts`, `proposer.ts`, `validator.ts`, `diagnoser.ts`
- Diagnoser: rule-based v1 with full 7-cause priority order (§6 step 2);
  stockout *inferred* from `daily_actuals` (`actual_sales == actual_bake AND
  waste_units == 0`) — no schema change needed for stockout
- Proposer guardrails: max_ops=3, max_delta=0.2, floor 0.5, ceiling 2.0,
  exploration probe every 7 runs (§6 step 3)
- Validator: strictly disjoint windows (evidence [-7,-1], holdout [-30,-8])
- Gemma narrates diagnoses; never produces numeric edits
- `/harness` page: list pending proposals + diff + approve/reject
- Seed two branches with divergent 14-day mock histories

**Stretch:**
- Brand-promotion proposal generator
- Third branch demonstrating inheritance after promotion
- Diagnoser upgraded to Gemma-classified (still rule-validated)
- Evolution metrics on dashboard ("3 rules learned this week, +RM127 estimated weekly savings")

**Cut entirely:**
- Editing the manifest itself (only `rules.json` is evolvable in v1)
- Cross-tenant federation
- Auto-apply without approval (always human-gated)
- New skills beyond the 6 existing

---

## 10. References

- SkillOpt: "Executive Strategy for Self-Evolving Agent Skills" — arXiv:2605.23904 (May 2026)
- EmbodiSkill: "Skill-Aware Reflection for Self-Evolving Embodied Agents" — arXiv:2605.10332 (May 2026)
- LobeHub blog: "Self-Evolving Harness — Build a Harness That Builds Itself" (2026)
- Phil Schmid: original "Harness" framing.
