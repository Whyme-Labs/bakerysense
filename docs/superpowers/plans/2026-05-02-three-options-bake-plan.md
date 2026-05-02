# Three-Options Morning Bake Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's single-number bake recommendation with three narrated options (conservative / balanced / aggressive). Each option carries its own expected waste, expected stockout probability, and a one-sentence Gemma-narrated tradeoff. The baker picks one, the pick is committed, and the decision is lineage-linked back to the forecast snapshot and model version that produced it.

**Why this and not something else.** Pan-industry data says perishables + uncertain demand + thin margin = mathematically inevitable waste. No baker can solve quantile-newsvendor in their head; even a competent one defaults to "bake more than yesterday" which is structurally biased. This is the *math problem no human can solve mentally that every bakery has* — the test we agreed to apply before building. Workflow checklists, scheduling, bookkeeping fail that test and stay out of scope.

**Architecture.** A pure-TS simulation engine integrates over the existing 7-quantile forecast to produce expected outcomes per candidate bake quantity. A plan generator emits 3 candidates per SKU around the newsvendor optimum. A new `bake_plan_decisions` table records which option the baker committed to, joining `forecast_snapshots` → `model_versions` from the lineage layer. The dashboard SKU row goes from one number to three cards with a *Commit* control. Gemma gets a new tool `narrate_plan_options` so the baker can ask "explain the tradeoffs" and get a baker-language answer grounded in the simulated outcomes (deterministic numbers from the engine; semantic prose from the LLM — same separation principle as everywhere else in the codebase).

**Tech stack.** Same as the rest of `bakerysense-web/` — Drizzle on D1, TypeScript on Cloudflare Workers, Next.js 16 App Router, the existing forecast router and KV pointer, the Tier 1+2 lineage helpers from `src/lib/lineage.ts`.

---

## Scope discipline

**In scope (v1):**
- Three candidate quantities per SKU (conservative / balanced / aggressive)
- Expected waste (units), expected stockout probability, expected unsold revenue (in bake-units, not currency until prices land)
- Dashboard UI with a *Commit* button per SKU
- One audit-trailed commit row per (branch × SKU × date)
- Gemma narration tool
- `bake_plan_decisions` table joined to lineage

**Out of scope (defer):**
- Weather sensitivity replan
- Markdown-timing simulation
- Supplier-shock scenarios
- Side-by-side multi-SKU compare view
- Cost-ratio sliders / per-decision overrides
- Currency support (we don't have unit prices yet — express outcomes in units)
- Auto-commit / batch commit (every commit is one SKU at a time, deliberately)

If a reviewer pushes for any of the deferred items, point them at the structural-math test from the design conversation and confirm whether the math is *genuinely unsolvable in head* (in which case it earns a follow-up plan) vs *workflow tooling we shouldn't build*.

---

## File structure

All paths relative to `bakerysense-web/` unless noted.

```
drizzle/
└── 0006_bake_plan_decisions.sql               create

src/
├── db/schema.ts                               modify — add bakePlanDecisions table
├── lib/
│   ├── simulation.ts                          create — pure-math engine: expected waste, stockout p, margin
│   ├── plan-options.ts                        create — generate 3 candidates from a quantile forecast
│   └── tools/narrate_plan_options.ts          create — Gemma tool wrapper around plan-options + simulation
├── app/
│   ├── api/
│   │   ├── forecast/plans/route.ts            create — GET (returns 3 plans per SKU with simulated outcomes)
│   │   └── bake-plans/commit/route.ts         create — POST (records the operator's choice, audit + lineage)
│   └── t/[slug]/dashboard/page.tsx            modify — render PlanOptions per SKU
├── components/
│   └── dashboard/
│       ├── PlanOptions.tsx                    create — 3-card layout with Commit
│       └── CommittedBadge.tsx                 create — rendered after commit (shows which option won)
├── worker-test.js                             modify — wire 2 new routes
└── tests/
    ├── unit/
    │   ├── simulation.test.ts                 create — math correctness
    │   └── plan-options.test.ts               create — candidate generation invariants
    └── integration/
        └── bake-plan-flow.test.ts             create — list plans → commit → audit + lineage row
```

---

## Spec reference

This is a new product surface; no prior spec covers it. The structural-pain framing comes from the 2026-05-02 design conversation in this branch's session log. The simulation math is the standard quantile-newsvendor outcome integral; reference: any operations-research textbook on perishable-inventory decision under uncertainty.

---

## Task 1: Migration — `bake_plan_decisions` table

**Files:**
- Create: `bakerysense-web/drizzle/0006_bake_plan_decisions.sql`
- Modify: `bakerysense-web/src/db/schema.ts`

The table records one row per committed plan choice: `(tenant, branch, family, date)` unique, the chosen `bake_quantity`, the `option_kind` (`conservative` / `balanced` / `aggressive` / `custom`), the `forecast_snapshot_id` it was based on, the `model_version_id` (denormalised from the snapshot for fast lineage joins), expected outcomes at commit time (so we can later reconcile prediction vs actual), and audit metadata (committed_by_user_id, committed_at, notes).

- [ ] **Step 1: Add the drizzle schema definition**

```typescript
// src/db/schema.ts — append
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
  }),
);
```

- [ ] **Step 2: Hand-write the SQL migration**

```sql
-- drizzle/0006_bake_plan_decisions.sql
CREATE TABLE `bake_plan_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `family` text NOT NULL,
  `date` text NOT NULL,
  `option_kind` text NOT NULL,
  `bake_quantity` integer NOT NULL,
  `forecast_snapshot_id` text,
  `model_version_id` text,
  `expected_waste_units` text,
  `expected_stockout_prob` text,
  `expected_units_sold` text,
  `committed_by_user_id` text NOT NULL,
  `committed_at` integer NOT NULL,
  `notes` text,
  FOREIGN KEY (`tenant_id`)             REFERENCES `tenants`(`id`)             ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`)             REFERENCES `branches`(`id`)            ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`forecast_snapshot_id`)  REFERENCES `forecast_snapshots`(`id`)  ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`model_version_id`)      REFERENCES `model_versions`(`id`)      ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`committed_by_user_id`)  REFERENCES `users`(`id`)               ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bake_plan_decisions_unique_idx` ON `bake_plan_decisions` (`tenant_id`,`branch_id`,`family`,`date`);
--> statement-breakpoint
CREATE INDEX `bake_plan_decisions_lookup_idx` ON `bake_plan_decisions` (`tenant_id`,`branch_id`,`date`);
--> statement-breakpoint
CREATE INDEX `bake_plan_decisions_snapshot_idx` ON `bake_plan_decisions` (`forecast_snapshot_id`);
```

- [ ] **Step 3: Typecheck**

Run: `cd bakerysense-web && npm run typecheck`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add bakerysense-web/drizzle/0006_bake_plan_decisions.sql bakerysense-web/src/db/schema.ts
git commit -m "feat(plans): bake_plan_decisions table for committed operator choices"
```

---

## Task 2: Simulation engine

**Files:**
- Create: `bakerysense-web/src/lib/simulation.ts`
- Test: `bakerysense-web/tests/unit/simulation.test.ts`

Pure math. Given a 7-quantile forecast (the existing `quantilesJson` shape `{q0.1, q0.25, q0.5, q0.75, q0.9, ...}`) and a candidate `bakeQuantity`, produce expected waste (units), expected stockout probability, and expected units sold. The integral is approximated by piecewise-linear interpolation over the quantile pairs — this is what every newsvendor implementation does in practice and matches the precision of the input.

- [ ] **Step 1: Write the failing test for the no-stockout edge case**

```typescript
// tests/unit/simulation.test.ts
import { describe, it, expect } from "vitest";
import { simulateOutcome, type Quantiles } from "@/lib/simulation";

describe("simulation engine", () => {
  it("returns zero stockout when bake exceeds q0.9", () => {
    const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
    const out = simulateOutcome(q, 200);
    expect(out.expectedStockoutProb).toBeLessThan(0.05);
    expect(out.expectedWasteUnits).toBeGreaterThan(80); // bake 200, demand ~100 → ~100 wasted
    expect(out.expectedUnitsSold).toBeLessThan(120);
  });
});
```

Run: `npx vitest run tests/unit/simulation.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 2: Implement the engine**

```typescript
// src/lib/simulation.ts
//
// Quantile-newsvendor outcome simulation. Given a 7-quantile demand forecast
// and a candidate bake quantity, returns expected waste, expected stockout
// probability, and expected units sold. Pure math, no DB.
//
// The integral over the demand distribution is approximated by piecewise-
// linear interpolation between adjacent quantiles. This matches the precision
// of the input (7 anchor points; tighter integration would imply structure
// the forecast doesn't carry).
export type Quantiles = Record<number, number>;
// Numeric keys 0..1 mapping to predicted units. Keys must include at least
// 0.1 and 0.9; intermediate quantiles are interpolated through.

export interface SimulatedOutcome {
  expectedWasteUnits: number;
  expectedStockoutProb: number;
  expectedUnitsSold: number;
}

export function simulateOutcome(q: Quantiles, bakeQuantity: number): SimulatedOutcome {
  // Normalise: sort entries by quantile probability, prepend (0, q0_floor)
  // and append (1, q0_ceiling) using slope continuation so the tails are
  // covered. Then walk the segments and compute three integrals.
  // ... (full implementation)
}
```

The full implementation walks the segments `[(p_i, x_i), (p_{i+1}, x_{i+1})]`, treats demand within each segment as uniform on `[x_i, x_{i+1}]` with mass `p_{i+1} - p_i`, and integrates `max(bake - demand, 0)` for waste and `1[demand > bake]` for stockout probability. For the head/tail extensions: linearly extend the slope of the first/last segment, capped at zero on the lower end.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run tests/unit/simulation.test.ts`
Expected: PASS.

- [ ] **Step 4: Add three more tests**

```typescript
it("returns ~zero waste when bake is below q0.1", () => {
  const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
  const out = simulateOutcome(q, 50);
  expect(out.expectedWasteUnits).toBeLessThan(1);
  expect(out.expectedStockoutProb).toBeGreaterThan(0.95);
});

it("balances at the median for symmetric forecast", () => {
  const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
  const out = simulateOutcome(q, 100);
  expect(out.expectedStockoutProb).toBeCloseTo(0.5, 1);
});

it("monotonic — higher bake => lower stockout, higher waste", () => {
  const q: Quantiles = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
  const lo = simulateOutcome(q, 80);
  const hi = simulateOutcome(q, 120);
  expect(hi.expectedStockoutProb).toBeLessThan(lo.expectedStockoutProb);
  expect(hi.expectedWasteUnits).toBeGreaterThan(lo.expectedWasteUnits);
});
```

Run all four. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bakerysense-web/src/lib/simulation.ts bakerysense-web/tests/unit/simulation.test.ts
git commit -m "feat(plans): quantile-newsvendor outcome simulation engine"
```

---

## Task 3: Plan options generator

**Files:**
- Create: `bakerysense-web/src/lib/plan-options.ts`
- Test: `bakerysense-web/tests/unit/plan-options.test.ts`

Given the 7-quantile forecast and the tenant's cost ratio (Cu/Co), emit three candidate bake quantities labelled `conservative` / `balanced` / `aggressive`, each annotated with its `SimulatedOutcome`. Balanced is the newsvendor optimum for the cost ratio (we already compute this in `decision/`). Conservative is the demand q0.3 floor. Aggressive is the q0.8 ceiling. These breakpoints are intentional defaults — no operator-tunable sliders in v1.

- [ ] **Step 1: Test — three labelled options ordered by quantity**

```typescript
import { generatePlanOptions } from "@/lib/plan-options";

it("emits three options ordered conservative ≤ balanced ≤ aggressive", () => {
  const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
  const opts = generatePlanOptions(q, { cu: 1, co: 1 });
  expect(opts.conservative.bakeQuantity).toBeLessThanOrEqual(opts.balanced.bakeQuantity);
  expect(opts.balanced.bakeQuantity).toBeLessThanOrEqual(opts.aggressive.bakeQuantity);
});

it("each option carries a simulated outcome", () => {
  const q = { 0.1: 80, 0.25: 90, 0.5: 100, 0.75: 110, 0.9: 120 };
  const opts = generatePlanOptions(q, { cu: 1, co: 1 });
  for (const o of [opts.conservative, opts.balanced, opts.aggressive]) {
    expect(o.outcome.expectedWasteUnits).toBeGreaterThanOrEqual(0);
    expect(o.outcome.expectedStockoutProb).toBeGreaterThanOrEqual(0);
    expect(o.outcome.expectedStockoutProb).toBeLessThanOrEqual(1);
  }
});
```

Run. Expected: FAIL.

- [ ] **Step 2: Implement**

```typescript
// src/lib/plan-options.ts
import { simulateOutcome, type Quantiles, type SimulatedOutcome } from "./simulation";

export interface PlanOption {
  kind: "conservative" | "balanced" | "aggressive";
  bakeQuantity: number;
  outcome: SimulatedOutcome;
}

export interface PlanOptionSet {
  conservative: PlanOption;
  balanced: PlanOption;
  aggressive: PlanOption;
}

export function generatePlanOptions(
  q: Quantiles,
  cost: { cu: number; co: number },
): PlanOptionSet {
  // Balanced = newsvendor optimum: target quantile = Cu / (Cu + Co).
  // Interpolate that quantile from the input.
  // Conservative = q at probability 0.3.
  // Aggressive   = q at probability 0.8.
  // Each gets simulateOutcome called on it.
  // ... (full implementation)
}
```

- [ ] **Step 3: Run tests, verify they pass.**

- [ ] **Step 4: Commit**

```bash
git add bakerysense-web/src/lib/plan-options.ts bakerysense-web/tests/unit/plan-options.test.ts
git commit -m "feat(plans): three-option generator (conservative/balanced/aggressive)"
```

---

## Task 4: API — `GET /api/forecast/plans`

**Files:**
- Create: `bakerysense-web/src/app/api/forecast/plans/route.ts`
- Modify: `bakerysense-web/worker-test.js`
- Test: extend `bakerysense-web/tests/integration/bake-plan-flow.test.ts` (created in Task 6)

Returns three plan options per SKU for a given branch + date. Reuses the existing `/api/forecast/batch` machinery to fetch the forecast and the tenant's cost ratio, then runs `generatePlanOptions` per row.

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/forecast/plans/route.ts
import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generatePlanOptions } from "@/lib/plan-options";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await resolveSession(env, req);
    if (!session) throw new Unauthorized();
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch");
    const date = url.searchParams.get("date");
    if (!branchId || !date) {
      return Response.json({ error: "branch and date required" }, { status: 400 });
    }
    // ... fetch forecast for tenant + branch + date (reuse forecast-router code path),
    // fetch cost ratio (reuse existing tenant config), call generatePlanOptions per
    // (branch, family) row, return the array.
  } catch (e) {
    return errorResponse(e);
  }
}
```

- [ ] **Step 2: Wire into `worker-test.js`**

Match `/api/forecast/plans` literal path BEFORE the `/api/forecast/:family` regex.

- [ ] **Step 3: Rebuild OpenNext**

```bash
cd bakerysense-web && npx opennextjs-cloudflare build
```

- [ ] **Step 4: Commit**

```bash
git add bakerysense-web/src/app/api/forecast/plans/route.ts bakerysense-web/worker-test.js
git commit -m "feat(plans): GET /api/forecast/plans returning 3 options per SKU"
```

---

## Task 5: API — `POST /api/bake-plans/commit`

**Files:**
- Create: `bakerysense-web/src/app/api/bake-plans/commit/route.ts`
- Modify: `bakerysense-web/worker-test.js`

Records the operator's choice. Body: `{ branchId, family, date, optionKind, bakeQuantity, forecastSnapshotId?, expected: { wasteUnits, stockoutProb, unitsSold } }`. Writes to `bakePlanDecisions` (idempotent on the unique index — re-committing for the same SKU-day overwrites). Emits `bake_plan.committed` audit row. Looks up `model_version_id` via the snapshot.

- [ ] **Step 1: Implement the route**

(branch_manager and tenant_admin roles permitted; require CSRF on POST; constant-time check that the snapshot belongs to the caller's tenant if `forecastSnapshotId` is provided)

- [ ] **Step 2: Add `bake_plan.committed` and `bake_plan.committed_failed` to `AuditAction` union in `src/lib/audit.ts`.**

- [ ] **Step 3: Wire into `worker-test.js`.**

- [ ] **Step 4: Commit.**

---

## Task 6: Integration test — full flow

**Files:**
- Create: `bakerysense-web/tests/integration/bake-plan-flow.test.ts`

End-to-end: signup tenant_admin, seed branch + forecast snapshot, hit `GET /api/forecast/plans`, verify three options come back, POST `/api/bake-plans/commit`, verify the row in `bakePlanDecisions` table joins to the model version, verify the audit event row exists.

- [ ] **Step 1: Write the test (4-5 cases)**

Each case in its own `it()`:
1. happy path — three options returned for a branch with a snapshot
2. commit succeeds and writes a row with the right `option_kind`, `bake_quantity`, `model_version_id`
3. re-commit for the same SKU-day overwrites (idempotent)
4. cross-tenant snapshot id is rejected (404, not 403)
5. unauthenticated commit returns 401

- [ ] **Step 2: Run tests; expect PASS for all 5.**

- [ ] **Step 3: Commit.**

---

## Task 7: Gemma tool — `narrate_plan_options`

**Files:**
- Create: `bakerysense-web/src/lib/tools/narrate_plan_options.ts`
- Modify: `bakerysense-web/src/lib/tools/index.ts` (register tool)

Wrapper around `generatePlanOptions` that asks Gemma to add a one-sentence baker-language narration per option. The numeric outputs come from the engine; only the prose comes from the LLM. Same separation principle as the rest of the codebase (numeric=deterministic, semantic=LLM).

The tool input is `{ branchId, family, date }`. The tool output is the three options plus a `narration` string per option.

- [ ] **Step 1: Implement the tool.** Use `generatePlanOptions` for math; format a Gemma sub-prompt that takes the three numbers and emits one sentence per option in baker register ("If you bake 90, you'll likely run out by 3pm and turn customers away. If you bake 116, expect ~18 unsold units. If you bake 140, expect ~30 unsold."). Whitelist the output: never emit anything that contradicts the numeric values.

- [ ] **Step 2: Register the tool in `TOOL_REGISTRY`.**

- [ ] **Step 3: Verify the tool-call audit (added in Tier 1+2) records the dispatch.**

- [ ] **Step 4: Commit.**

---

## Task 8: Dashboard UI — `PlanOptions` cards

**Files:**
- Create: `bakerysense-web/src/components/dashboard/PlanOptions.tsx` (client component)
- Create: `bakerysense-web/src/components/dashboard/CommittedBadge.tsx`
- Modify: `bakerysense-web/src/app/t/[slug]/dashboard/page.tsx`

The dashboard SKU row goes from one number to a 3-card layout. Each card shows: the option kind (Conservative / Balanced / Aggressive), the bake quantity (large), expected waste units (small, muted), expected stockout probability (small, muted, percent), and a *Commit* button. Default-selected card is `balanced`. After commit, the row collapses to a `CommittedBadge` showing the chosen kind + quantity.

- [ ] **Step 1: Build `PlanOptions.tsx` (client) — fetches `/api/forecast/plans`, renders cards, posts to `/api/bake-plans/commit` on click. Optimistic UI + error toast on 4xx.**

- [ ] **Step 2: Build `CommittedBadge.tsx` (server) — reads the `bake_plan_decisions` table for this branch+date.**

- [ ] **Step 3: Modify `dashboard/page.tsx` — fetch committed plans server-side, render the badge if committed, otherwise render the client `PlanOptions` component.**

- [ ] **Step 4: Visual smoke check — run `npm run dev`, sign in as `demo@bakerysense.app`, confirm the dashboard renders three cards per SKU row, commit one, refresh, confirm the badge shows.**

- [ ] **Step 5: Commit.**

---

## Task 9: Update docs

**Files:**
- Modify: `docs/architecture.md` — add a "Three-options bake plan" section under Decision lineage
- Modify: `README.md` (feature branch only) — mention the new layer in Architecture

- [ ] Step 1: Update `architecture.md` with the new table, the simulation engine, the API endpoints, and a one-paragraph rationale for the structural-pain framing (so future contributors don't bolt on workflow features without re-reading).

- [ ] Step 2: Update README.md.

- [ ] Step 3: Commit.

---

## Task 10: Run full suite, push branch

- [ ] `cd bakerysense-web && npm run typecheck` — clean
- [ ] `npm test` — full suite green (target: 187 baseline + ~12 new = ~199)
- [ ] `git push origin feature/decision-lineage` — branch update

---

## Self-review checklist

- [ ] Every task above touches files listed in the "File structure" section. No orphan files.
- [ ] No placeholders ("TBD", "implement later", "see ...") in any code block.
- [ ] Migration is additive only — no DROP, no ALTER COLUMN, no NOT NULL on existing columns.
- [ ] Tenant scope is enforced in both endpoints. Cross-tenant gets 404, not 403.
- [ ] CSRF on POST /api/bake-plans/commit.
- [ ] Lineage row joins via `forecast_snapshots.model_version_id` (the FK from Tier 1).
- [ ] Audit row written on commit AND on commit failure (use existing `tool.invoked` / `tool.failed` pattern from Tier 1+2 where applicable, or new `bake_plan.committed` action).
- [ ] Worker-test.js wired for both new routes.
- [ ] OpenNext rebuilt before running full vitest.
- [ ] Don't merge to master pre-2026-05-18.
