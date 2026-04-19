# P5 E2E + Video + Submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the hackathon. Playwright E2E coverage for the 7-scenario demo journey (§7.2 of the spec), a deterministic connector-replay layer so chat + photo scenarios don't need a live LLM, a seed script that stands up a demo tenant with real forecast bundles, a deployable build with documented secrets, a demo-video storyboard + shot list, and a first-draft Kaggle submission writeup (≤1500 words) with cover image. The user records the final video with the real bakery owner; this plan produces everything else.

**Architecture:** Playwright installed alongside the existing Vitest setup — no conflict (Playwright runs the app via `wrangler dev`, separate from `vitest run`'s Miniflare pool). Connector replay is gated by a `BS_REPLAY_FIXTURES` env var: when set, the `LLMClient.chat()` path reads a fixture JSON keyed by SHA-256 of the canonical request body from a `fixtures/llm/` directory instead of doing a real HTTP call. The seed script is a TypeScript file run with `wrangler dev --test-scheduled` OR invoked via a new `/api/admin/seed-demo` endpoint protected by `OPS_ROTATE_SECRET`. Demo video script is a markdown file with a shot list; actual recording is user's responsibility.

**Tech stack:** Playwright 1.55+, `@playwright/test`, `wrangler dev` for the app-under-test, existing `@cloudflare/vitest-pool-workers` stays for the non-E2E layer. No video-recording tools on our side — Playwright's built-in `trace: on` + `video: on-first-retry` produce screen captures and traces as a byproduct, which the user can use as reference for the final bakery-owner cut.

---

## Spec reference

Implements **§7.2 end-to-end demo journey**, **§7.3 test-friendly markup**, **§11.3 E2E (Playwright)**, **§13.3 seed migrations**, **§15 deployment**. Produces the artifacts for **Week 4** hackathon submission (video, writeup, live URL, cover).

Does NOT: record the final demo video (user does this with a bakery owner), implement Unsloth QLoRA fine-tune (stretch goal), or add social login / email verification (§16 explicit non-goals).

---

## File structure

All paths relative to repo root.

```
bakerysense-web/
├── playwright.config.ts                       create
├── package.json                               modify — add @playwright/test, playwright scripts
├── e2e/
│   ├── fixtures/
│   │   ├── demo-seed.ts                       create — shared Playwright fixtures: pre-seeded tenant, logged-in context
│   │   └── llm/                               create — recorded LLM responses keyed by request hash
│   │       ├── <hash>.json                      one per distinct chat request
│   │       └── README.md                        how to re-record
│   ├── 01-landing.spec.ts                     create
│   ├── 02-signin.spec.ts                      create
│   ├── 03-dashboard.spec.ts                   create
│   ├── 04-sku-detail.spec.ts                  create
│   ├── 05-chat.spec.ts                        create
│   ├── 06-display-case.spec.ts                create
│   └── 07-signout.spec.ts                     create
├── src/
│   ├── lib/
│   │   └── llm/client.ts                      modify — check BS_REPLAY_FIXTURES env, route through replayer
│   ├── app/api/
│   │   └── admin/seed-demo/route.ts           create — signed endpoint to populate D1 + R2
│   └── scripts/
│       └── seed-demo.ts                       create — tenant, users, branches, baseline trees + features upload
├── fixtures/llm/                              (see e2e/fixtures/llm/ — identical content, symlinked or copied at CI time)
└── .github/workflows/
    └── e2e.yml                                create — Playwright CI (smoke only, chat/photo replay on)

scripts/
└── deploy-smoke.sh                            create — post-deploy smoke: curl /, /signin, /api/.well-known/jwks.json

docs/
├── demo/
│   ├── storyboard.md                          create — shot list for the 3-min demo video
│   ├── script.md                              create — word-for-word script aligned to the storyboard
│   ├── writeup.md                             create — ≤1500-word Kaggle submission writeup
│   ├── cover-image-spec.md                    create — what the cover image should look like
│   └── screenshots/                           populated by Playwright trace extraction
├── deploy.md                                  create — wrangler secret setup + deploy checklist
└── architecture.md                            modify — add "Testing + Deployment" section

README.md                                      modify — Week 4 status + live-URL + link to docs/demo/
```

---

## Success criteria

1. `cd bakerysense-web && npm run test:e2e` runs Playwright against `wrangler dev` with `BS_REPLAY_FIXTURES=1` and passes all 7 scenarios in under 3 minutes.
2. `npx playwright test e2e/05-chat.spec.ts` produces deterministic SSE output — no network calls to OpenRouter or any real LLM.
3. `curl -X POST /api/admin/seed-demo -H "x-ops-secret: <sig>"` on a fresh deploy populates tenant `favorita`, the two demo users (`demo@` / `manager@`), 5 branches, a default connector (OpenRouter), and pushes a baseline tree + features bundle to R2. The dashboard at `/t/favorita/dashboard?branch=<brn_id>` renders a non-empty bake plan.
4. `docs/demo/storyboard.md` lists each shot with timing, camera direction, and the line the bakery owner speaks. Total runtime ≤ 3:00.
5. `docs/demo/writeup.md` is ≤ 1500 words, cites Favorita + French Bakery datasets, covers: problem, Gemma 4's role, architecture, results (MASE/WAPE), and the feedback loop.
6. `scripts/deploy-smoke.sh <url>` returns 0 on a successful deploy (checks `/`, `/signin`, `/api/.well-known/jwks.json`, and the `POST /api/admin/seed-demo` happy path).
7. `README.md` has a "Live demo" section linking to the deployed URL and a "Watch the video" link (placeholder the user fills after recording).
8. CI workflow `.github/workflows/e2e.yml` runs Playwright on pull requests — fast enough (< 5 min total) to not bottleneck development.
9. All pre-P5 tests (106 workers + 7 unit = 113) remain green.
10. `docs/deploy.md` documents every wrangler secret + binding with a copy-paste-ready checklist.

---

## Task 1: Playwright install + config

**Files:**
- Modify: `bakerysense-web/package.json`
- Create: `bakerysense-web/playwright.config.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd bakerysense-web
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```

Only Chromium for MVP (demo browser; Firefox/Safari not needed for the hackathon).

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,            // scenarios chain state; run serially
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:8787",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  webServer: {
    command: "BS_REPLAY_FIXTURES=1 npx wrangler dev --env test --port 8787",
    url: "http://localhost:8787",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

**Caveat:** `wrangler dev --env test` uses the `test` env from wrangler.jsonc which has ephemeral D1/KV/R2 bindings. The webServer command may need adjustment if it doesn't work with OpenNext's output layout — in that case, fall back to `npm run dev` (Next.js dev server) + a separate `wrangler dev` for queue/cron. Document the decision in the report.

- [ ] **Step 3: Add package.json scripts**

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:update-fixtures": "BS_RECORD_FIXTURES=1 playwright test",
```

Update `verify` to NOT include e2e (it's slow; keep CI verify fast): leave `verify` as-is.

- [ ] **Step 4: Create `.gitignore` entries**

Add to `bakerysense-web/.gitignore`:
```
/playwright-report/
/test-results/
/e2e/.auth/
```

- [ ] **Step 5: Commit**

```bash
git add bakerysense-web/package.json bakerysense-web/package-lock.json bakerysense-web/playwright.config.ts bakerysense-web/.gitignore
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "chore(e2e): install Playwright + config for 7-scenario demo journey"
```

---

## Task 2: LLM fixture replayer

**Files:**
- Modify: `bakerysense-web/src/lib/llm/client.ts`
- Create: `bakerysense-web/src/lib/llm/replay.ts`
- Create: `bakerysense-web/e2e/fixtures/llm/README.md`
- Create: `bakerysense-web/tests/unit/components/llm-replay.test.ts`

### Step 1: `src/lib/llm/replay.ts`

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils";
import type { ChatMessage, ChatResponse, ToolSchema } from "./client";

export interface ReplayRequest {
  preset: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  temperature: number;
}

function canonicalize(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonicalize).join(",") + "]";
  const keys = Object.keys(o as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((o as Record<string, unknown>)[k])).join(",") + "}";
}

export function requestHash(req: ReplayRequest): string {
  const canon = canonicalize(req);
  return bytesToHex(sha256(new TextEncoder().encode(canon))).slice(0, 16);
}

// When BS_REPLAY_FIXTURES=1, the LLMClient reads fixtures from R2 (bucket `MODELS`
// under prefix `fixtures/llm/<hash>.json`) — seeded by the seed script or a one-off
// `npm run test:e2e:update-fixtures` that POSTs captured responses.
export async function readFixture(env: CloudflareEnv, hash: string): Promise<ChatResponse | null> {
  const obj = await env.MODELS.get(`fixtures/llm/${hash}.json`);
  if (!obj) return null;
  return JSON.parse(await obj.text()) as ChatResponse;
}

export async function writeFixture(env: CloudflareEnv, hash: string, response: ChatResponse): Promise<void> {
  await env.MODELS.put(`fixtures/llm/${hash}.json`, JSON.stringify(response, null, 2));
}
```

### Step 2: Wire `LLMClient.chat()` to the replayer

At the top of `client.ts`:

```ts
import { readFixture, requestHash, writeFixture, type ReplayRequest } from "./replay";
```

In the `chat()` method, before the real `fetch`:

```ts
const env = (globalThis as any).__cloudflare_env__ as CloudflareEnv | undefined;  // see note below

if (env && (env as any).BS_REPLAY_FIXTURES === "1") {
  const reqShape: ReplayRequest = {
    preset: this.opts.preset,
    model: this.opts.model,
    messages,
    tools,
    temperature: this.opts.temperature ?? 0.3,
  };
  const hash = requestHash(reqShape);
  const fixture = await readFixture(env, hash);
  if (fixture) return fixture;
  if ((env as any).BS_RECORD_FIXTURES === "1") {
    // fall through to real fetch; capture below
  } else {
    throw new Error(`llm_replay: no fixture for hash ${hash} (messages=${messages.length})`);
  }
}
```

After the real fetch normalizes the response:

```ts
if (env && (env as any).BS_RECORD_FIXTURES === "1") {
  const hash = requestHash(reqShape);
  await writeFixture(env, hash, normalized);
}
```

**`globalThis.__cloudflare_env__` note:** Getting the env into the LLMClient is awkward because `new LLMClient({...})` doesn't currently take an env. Two options:

**A.** Add an `env: CloudflareEnv` field to `LLMClientOpts`. Update all callers (queue-consumer, photo route) to pass `env`. This is the clean refactor — preferred.

**B.** Use the getCloudflareContext symbol pattern from worker-test.js. Fragile in production.

**Choose A.** The refactor is small: ~4 call sites.

### Step 3: Unit test `tests/unit/components/llm-replay.test.ts`

Tests for `requestHash` determinism and `canonicalize` correctness. Pure-math, no env.

```ts
import { describe, it, expect } from "vitest";
import { requestHash } from "@/lib/llm/replay";

describe("requestHash", () => {
  it("produces identical hash for identical requests", () => {
    const a = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user", content: "hi" }], tools: [], temperature: 0.3 };
    const b = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user", content: "hi" }], tools: [], temperature: 0.3 };
    expect(requestHash(a)).toBe(requestHash(b));
  });
  it("differs on content change", () => {
    const a = { preset: "openrouter", model: "gemma-4-e4b", messages: [{ role: "user", content: "hi" }], tools: [], temperature: 0.3 };
    const b = { ...a, messages: [{ role: "user", content: "bye" }] };
    expect(requestHash(a)).not.toBe(requestHash(b));
  });
  it("order-invariant on object keys", () => {
    const a = { preset: "openrouter", model: "x", messages: [{ role: "user", content: "hi" }], tools: [], temperature: 0.3 };
    const b = { temperature: 0.3, tools: [], messages: [{ role: "user", content: "hi" }], model: "x", preset: "openrouter" };
    expect(requestHash(a)).toBe(requestHash(b));
  });
});
```

### Step 4: `e2e/fixtures/llm/README.md`

Explains how to record fixtures:

```md
# LLM fixtures for E2E

Playwright runs against `wrangler dev` with `BS_REPLAY_FIXTURES=1`. When a chat
request hits the LLMClient, it looks up a fixture by the SHA-256 (first 16 hex chars)
of the canonical request body in R2 under `fixtures/llm/<hash>.json`.

## First-time recording

1. Run `npm run test:e2e:update-fixtures`. This sets both BS_REPLAY_FIXTURES=1 and
   BS_RECORD_FIXTURES=1. Missing fixtures fall through to the real connector
   (needs `OPENROUTER_API_KEY` in .dev.vars), and the response is written to R2.
2. Inspect the recorded fixtures. Commit them via
   `wrangler r2 object get bakerysense-models-dev/fixtures/llm/<hash>.json > e2e/fixtures/llm/<hash>.json`.
3. In CI, `e2e/fixtures/llm/*.json` are uploaded to R2 at test-setup time (see
   `e2e/fixtures/demo-seed.ts`).

## Re-recording after prompt changes

Any change to the system prompt or tool schemas changes the request hash. Delete
the old fixtures and re-record. Add a `git status` check to the PR template so
reviewers notice stale fixtures.
```

### Step 5: Verify + commit

```bash
cd bakerysense-web
npx tsc --noEmit
npm run test
npm run test:unit     # 3 new hash tests → 10 total

cd ..
git add bakerysense-web/src/lib/llm/client.ts bakerysense-web/src/lib/llm/replay.ts bakerysense-web/tests/unit/components/llm-replay.test.ts bakerysense-web/e2e/fixtures/llm/README.md bakerysense-web/src/app/api/chat bakerysense-web/src/app/api/photo bakerysense-web/src/lib/queue-consumer.ts
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "feat(web): LLM fixture replayer for deterministic E2E tests"
```

---

## Task 3: Seed demo endpoint + script

**Files:**
- Create: `bakerysense-web/src/scripts/seed-demo.ts` (Worker-side seeding helper)
- Create: `bakerysense-web/src/app/api/admin/seed-demo/route.ts` (HMAC-signed, same pattern as publish-model)
- Create: Python `scripts/seed_demo_bundle.py` — exports Favorita tree + features JSON for upload
- Modify: `bakerysense-web/worker-test.js` dispatch

### Step 1: `src/scripts/seed-demo.ts`

A function `seedDemo(env): Promise<{ tenantId, userIds, branchIds }>` that:

1. Creates tenant `favorita` with vertical `bakery`
2. Creates user `demo@bakerysense.app` / `Demo2026DemoDemo` with `tenant_admin` membership
3. Creates user `manager@bakerysense.app` / `Manager2026Manager` with `branch_manager` membership on 2 of 5 branches
4. Creates 5 branches: `Quito Centro`, `Quito Norte`, `Guayaquil Urdesa`, `Guayaquil Centro`, `Cuenca Rural`
5. Creates a default connector for the tenant (OpenRouter preset, model `google/gemma-4-e4b-it`, apiKey from env secret `OPENROUTER_API_KEY` encrypted via CONNECTOR_MEK — reuse `upsertConnector` from `src/lib/connector.ts`)
6. Seeds `daily_actuals` and `forecast_snapshots` for the last 30 days so the dashboard's QualityBadge + DriftBanner have signal
7. Is idempotent — safe to call multiple times (check-then-insert)

### Step 2: `POST /api/admin/seed-demo/route.ts`

HMAC-signed via `OPS_ROTATE_SECRET` — same pattern as `/api/internal/publish-model` (canonical JSON + x-ops-secret header). Reads `OPS_ROTATE_SECRET` from env, verifies, then calls `seedDemo(env)` and returns the IDs.

### Step 3: Python helper `scripts/seed_demo_bundle.py`

Wraps `scripts/build_web_bundle.py` to produce `tenant:favorita/trees/latest.json` and `tenant:favorita/features/latest.json` on disk. Operator uploads via `wrangler r2 object put bakerysense-models/tenant:favorita/trees/latest.json --file ...`. Document the upload commands in the script's docstring.

### Step 4: Worker-test.js dispatch

Add `POST /api/admin/seed-demo` — literal.

### Step 5: Verify + commit

```bash
cd bakerysense-web
npx tsc --noEmit
npm run test

cd ..
git add bakerysense-web/src/scripts/seed-demo.ts bakerysense-web/src/app/api/admin/seed-demo bakerysense-web/worker-test.js scripts/seed_demo_bundle.py
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "feat(web): seed-demo endpoint + Python bundle helper for deterministic demo tenant"
```

---

## Task 4: Shared Playwright fixture — pre-seeded tenant + logged-in state

**Files:**
- Create: `bakerysense-web/e2e/fixtures/demo-seed.ts`

Playwright project-level fixture. `test.extend<{ seededUrl: string; authedPage: Page }>({...})` that:

1. Runs once per test project (scope: `"worker"`).
2. POSTs `/api/admin/seed-demo` with a valid HMAC signature. Idempotent, so safe to call repeatedly.
3. Uploads the `e2e/fixtures/llm/*.json` files to R2 under `fixtures/llm/` (using a small `wrangler r2 object put` spawn OR a signed `POST /api/admin/upload-fixtures` endpoint — the signed endpoint is cleaner).
4. Provides a helper `authedPage(role: "admin" | "manager")` that performs a signin via the UI and returns the authenticated Page.

```ts
import { test as base, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";

function canonicalize(o: any): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canonicalize).join(",") + "]";
  const keys = Object.keys(o).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
}

function sign(body: any, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonicalize(body)).digest("hex");
}

const SEEDED = { done: false };

export const test = base.extend<{ seeded: void }>({
  seeded: [async ({ request }, use) => {
    if (!SEEDED.done) {
      const secret = process.env.OPS_ROTATE_SECRET ?? "test-ops-secret";
      const body = { ping: true };
      const res = await request.post("/api/admin/seed-demo", {
        data: body,
        headers: { "x-ops-secret": sign(body, secret) },
      });
      expect(res.ok()).toBeTruthy();
      SEEDED.done = true;
    }
    await use();
  }, { scope: "worker", auto: true }],
});

export async function signIn(page: Page, email: string, password: string, slug: string) {
  await page.goto("/signin");
  await page.fill('[data-testid="signin-email"]', email);
  await page.fill('[data-testid="signin-password"]', password);
  await page.fill('[data-testid="signin-slug"]', slug);
  await page.click('[data-testid="signin-submit"]');
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/`));
}

export const DEMO = {
  slug: "favorita",
  adminEmail: "demo@bakerysense.app",
  adminPassword: "Demo2026DemoDemo",
  managerEmail: "manager@bakerysense.app",
  managerPassword: "Manager2026Manager",
} as const;

export { expect };
```

Note: this requires `data-testid` on the signin form fields. If those don't exist yet, the first few E2E tasks will need to add them. Since the P1 plan established `data-testid` on `branch-selector`, the signin form may be missing — check and add as needed in subsequent tasks.

### Step: Commit

```bash
cd bakerysense-web
git add e2e/fixtures
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): shared Playwright fixture — seed demo tenant + signIn helper"
```

---

## Task 5: E2E Scenario 1 — Landing page

**Files:**
- Create: `bakerysense-web/e2e/01-landing.spec.ts`

```ts
import { test, expect } from "./fixtures/demo-seed";

test.describe("Scenario 1: Landing", () => {
  test("loads hero, stats, sample exchange; CTAs link to signin + signup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /AI production copilot/i })).toBeVisible();

    // STATS grid — assert all four cards render
    await expect(page.getByText(/−27% WAPE/)).toBeVisible();
    await expect(page.getByText(/19 \/ 20/)).toBeVisible();
    await expect(page.getByText(/700 \/ 700/)).toBeVisible();

    // Sample exchange section
    await expect(page.getByText(/Manager:/)).toBeVisible();
    await expect(page.getByText(/BakerySense:/)).toBeVisible();

    // CTA links
    await expect(page.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/signin");
    await expect(page.getByRole("link", { name: /Create a tenant/i })).toHaveAttribute("href", "/signup");
  });
});
```

Run once to confirm the selectors work against the current landing page.

### Step: Commit

```bash
cd bakerysense-web
npx playwright test e2e/01-landing.spec.ts
git add e2e/01-landing.spec.ts
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 1 — landing page loads hero/stats/CTAs"
```

---

## Task 6: E2E Scenario 2 — Signin

**Files:**
- Create: `bakerysense-web/e2e/02-signin.spec.ts`
- Possibly modify: `bakerysense-web/src/app/signin/page.tsx` (add `data-testid` to form fields if absent)

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 2: signin — demo admin lands on dashboard", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await expect(page).toHaveURL(new RegExp(`/t/${DEMO.slug}/dashboard`));
  await expect(page.locator('[data-testid="branch-selector"]')).toBeVisible();
});

test("Scenario 2b: wrong password returns to signin with error banner", async ({ page }) => {
  await page.goto("/signin");
  await page.fill('[data-testid="signin-email"]', DEMO.adminEmail);
  await page.fill('[data-testid="signin-password"]', "wrong-password");
  await page.fill('[data-testid="signin-slug"]', DEMO.slug);
  await page.click('[data-testid="signin-submit"]');
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByText(/invalid credentials/i)).toBeVisible();
});
```

If the signin page currently lacks `data-testid` markers, add:
- `data-testid="signin-email"` on the email input
- `data-testid="signin-password"` on the password input
- `data-testid="signin-slug"` on the tenant-slug input
- `data-testid="signin-submit"` on the submit button

### Step: Commit

```bash
cd bakerysense-web
npx playwright test e2e/02-signin.spec.ts
git add e2e/02-signin.spec.ts bakerysense-web/src/app/signin/page.tsx
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 2 — signin happy path + invalid credentials"
```

---

## Task 7: E2E Scenario 3 — Dashboard

**Files:**
- Create: `bakerysense-web/e2e/03-dashboard.spec.ts`

Assert dashboard renders the bake plan after seed:
- Branch selector is populated (the 5 Favorita branches)
- BakePlanTable shows ≥ 5 SKU rows
- Each row has a SKU name, q0.5, q0.7, ConfidenceBar SVG, bake quantity, "drivers →" link
- QualityBadge is visible on each row (from seeded 30-day actuals+snapshots)
- "Close out today" trigger button in the header is clickable

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 3: dashboard — bake plan renders with quality badges", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);

  // Pick a branch (first option)
  await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
  await expect(page).toHaveURL(/branch=brn_/);

  // Rows
  const rows = page.locator('[data-testid^="row-sku-"]');
  await expect(rows).toHaveCount(await rows.count());  // at least ≥1; adjust to a hard number once seed is stable
  await expect(rows.first()).toBeVisible();

  // ConfidenceBar SVG per row
  await expect(rows.first().locator("svg")).toBeVisible();

  // Close-out trigger
  await expect(page.getByRole("button", { name: /Close out today/i })).toBeVisible();
});
```

### Step: Commit

```bash
git add bakerysense-web/e2e/03-dashboard.spec.ts
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 3 — dashboard bake plan + QualityBadge"
```

---

## Task 8: E2E Scenario 4 — SKU detail

**Files:**
- Create: `bakerysense-web/e2e/04-sku-detail.spec.ts`

Click into a SKU row, assert the detail page renders quantile chart + driver bars + "Ask Gemma why" link pointing to `/chat?prefill=...`.

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 4: SKU detail — quantile chart + driver bars + ask-gemma link", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });

  const firstRow = page.locator('[data-testid^="row-sku-"]').first();
  await firstRow.getByRole("link", { name: /drivers/i }).click();

  await expect(page).toHaveURL(/\/sku\//);
  // Quantile chart
  await expect(page.locator("section").filter({ hasText: /Quantile band/i }).locator("svg")).toBeVisible();
  // Driver bars
  await expect(page.locator("section").filter({ hasText: /Top drivers/i })).toBeVisible();
  // Ask Gemma link
  const ask = page.getByRole("link", { name: /Ask Gemma why/i });
  await expect(ask).toHaveAttribute("href", /\/chat\?.*prefill=/);
});
```

### Step: Commit

```bash
git add bakerysense-web/e2e/04-sku-detail.spec.ts
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 4 — SKU detail renders charts + ask-gemma CTA"
```

---

## Task 9: E2E Scenario 5 — Chat with SSE replay

**Files:**
- Create: `bakerysense-web/e2e/05-chat.spec.ts`
- Create: `bakerysense-web/e2e/fixtures/llm/*.json` — record the fixtures for this scenario

First, run the test with `BS_RECORD_FIXTURES=1` + a real OPENROUTER_API_KEY in `.dev.vars` to capture the actual LLM responses. Then run WITHOUT the real key — replay from disk.

Spec: send "What should I bake tomorrow for TRADITIONAL BAGUETTE?" → expect a `tool_call` bubble for `forecast` + an `answer` bubble with non-empty text.

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 5: chat — SSE delivers tool_call + answer", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
  await page.goto(`/t/${DEMO.slug}/chat?branch=` + new URL(page.url()).searchParams.get("branch"));

  await page.fill('[data-testid="prompt-input"]', "What should I bake tomorrow for TRADITIONAL BAGUETTE?");
  await page.click('[data-testid="prompt-submit"]');

  // Tool trace appears within 30s
  await expect(page.locator("details").filter({ hasText: /forecast/ })).toBeVisible({ timeout: 30_000 });
  // Assistant answer appears
  await expect(page.locator('[data-testid="message-bubble-assistant"]').first()).toBeVisible({ timeout: 30_000 });
});
```

**Fixture recording procedure** (document in task completion):

```bash
# 1. Ensure .dev.vars has OPENROUTER_API_KEY and OPS_ROTATE_SECRET
# 2. Run Playwright in record mode:
cd bakerysense-web
BS_REPLAY_FIXTURES=1 BS_RECORD_FIXTURES=1 npx playwright test e2e/05-chat.spec.ts
# 3. Capture the R2 fixtures:
wrangler r2 bucket object list bakerysense-models-dev --prefix fixtures/llm/
wrangler r2 bucket object get bakerysense-models-dev/fixtures/llm/<hash>.json \
    > e2e/fixtures/llm/<hash>.json
# 4. Commit the JSON files.
```

Also requires `data-testid` on:
- `prompt-input` (PromptInput textarea)
- `prompt-submit` (PromptInput button)
- `message-bubble-assistant` / `message-bubble-user` (MessageBubble)

Add these to the components if missing.

### Step: Commit

```bash
git add bakerysense-web/e2e/05-chat.spec.ts bakerysense-web/e2e/fixtures/llm bakerysense-web/src/components/chat
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 5 — chat SSE with recorded Gemma fixtures"
```

---

## Task 10: E2E Scenario 6 — Display case photo upload

**Files:**
- Create: `bakerysense-web/e2e/06-display-case.spec.ts`
- Create: `bakerysense-web/e2e/fixtures/shelf.jpg` — a small test image (user-provided or a placeholder from wikimedia; ≤50KB)
- Create: fixture for the vision response

Flow:
1. Navigate to `/t/favorita/display-case?branch=brn_xxx`
2. Upload `shelf.jpg`
3. Expect counts table to render within 30s (from replay fixture)
4. Expect markdown suggestions list to render below
5. Click "Chat about this" → lands on `/chat` with prefill

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";
import path from "node:path";

test("Scenario 6: display-case — photo → counts → markdowns", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
  const branch = new URL(page.url()).searchParams.get("branch");
  await page.goto(`/t/${DEMO.slug}/display-case?branch=${branch}`);

  await page.setInputFiles('[data-testid="photo-upload-input"]', path.resolve(__dirname, "fixtures/shelf.jpg"));
  await page.click('[data-testid="photo-upload-submit"]');

  await expect(page.locator('[data-testid="counts-table"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="markdown-list"]')).toBeVisible();
  await expect(page.getByRole("link", { name: /Chat about this/i })).toHaveAttribute("href", /\/chat\?.*prefill=/);
});
```

Add `data-testid` to PhotoUpload / CountsTable / MarkdownList components if missing.

Recording the vision fixture follows the same procedure as Task 9 but for the photo API path.

### Step: Commit

```bash
git add bakerysense-web/e2e/06-display-case.spec.ts bakerysense-web/e2e/fixtures/shelf.jpg bakerysense-web/src/components/display-case
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 6 — display-case photo upload + markdown suggestions"
```

---

## Task 11: E2E Scenario 7 — Sign out

**Files:**
- Create: `bakerysense-web/e2e/07-signout.spec.ts`

```ts
import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 7: sign out returns to /signin and clears session", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.click('[data-testid="user-menu-signout"]');
  await expect(page).toHaveURL(/\/signin/);

  // Attempting to access dashboard now redirects back to /signin
  await page.goto(`/t/${DEMO.slug}/dashboard`);
  await expect(page).toHaveURL(/\/signin/);
});
```

Add `data-testid="user-menu-signout"` to the UserMenu's sign-out button.

### Step: Commit

```bash
git add bakerysense-web/e2e/07-signout.spec.ts bakerysense-web/src/components/shell/UserMenu.tsx
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "test(e2e): scenario 7 — sign out clears session + redirects"
```

---

## Task 12: CI workflow + deployment docs

**Files:**
- Create: `.github/workflows/e2e.yml`
- Create: `docs/deploy.md`
- Create: `scripts/deploy-smoke.sh`

### Step 1: `.github/workflows/e2e.yml`

```yaml
name: E2E
on: [pull_request, workflow_dispatch]
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: bakerysense-web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          OPS_ROTATE_SECRET: test-ops-secret
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: bakerysense-web/playwright-report/
```

### Step 2: `docs/deploy.md`

A copy-paste deployment checklist:
- `wrangler login`
- Create D1 database + copy the uuid into wrangler.jsonc
- Create KV namespaces (main + preview)
- Create R2 buckets (bakerysense-models + bakerysense-models-dev)
- Create Queues (chat-queue, chat-dlq, retrain-queue, retrain-dlq)
- `wrangler secret put` for each secret (list them)
- `npm run deploy`
- `curl -X POST /api/admin/seed-demo -H "x-ops-secret: <sig>"` to populate the demo tenant
- Upload the tree + features bundle to R2
- Smoke test: `./scripts/deploy-smoke.sh https://bakerysense-web.<account>.workers.dev`

### Step 3: `scripts/deploy-smoke.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:?usage: deploy-smoke.sh <base-url>}"
echo "smoke-testing $URL"
curl -fsS "$URL/" > /dev/null && echo "  ✓ landing"
curl -fsS "$URL/signin" > /dev/null && echo "  ✓ signin page"
curl -fsS "$URL/api/.well-known/jwks.json" | python -m json.tool > /dev/null && echo "  ✓ jwks"
echo "all checks passed"
```

### Step 4: Commit

```bash
git add .github/workflows/e2e.yml docs/deploy.md scripts/deploy-smoke.sh
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "chore(ci): Playwright CI workflow + deployment docs + smoke script"
```

---

## Task 13: Demo video storyboard + script

**Files:**
- Create: `docs/demo/storyboard.md`
- Create: `docs/demo/script.md`

No recording — produce text artifacts the bakery owner can rehearse from.

### Step 1: `docs/demo/storyboard.md`

3-minute shot list. Target audience: hackathon judges. Hook must land in first 15 seconds.

Structure:
- **0:00–0:10 — Cold open**: bakery owner at the counter, "Every morning I guess how much to bake. If I'm wrong, I waste food or lose sales."
- **0:10–0:30 — Landing + signin**: voiceover over screen capture of `/` → `/signin` → dashboard landing
- **0:30–1:00 — Dashboard**: QualityBadge + bake plan table + branch selector swap
- **1:00–1:30 — SKU detail**: quantile chart + driver bars, click "Ask Gemma why"
- **1:30–2:10 — Chat**: SSE-streamed tool call + explanation in plain language (French/Malay/Chinese inline to show multilingual potential)
- **2:10–2:30 — Display case**: photo upload → counts → markdown suggestions
- **2:30–2:50 — Feedback loop**: close out today + retrain history page
- **2:50–3:00 — Close**: bakery owner, "By the end of the month, the model knows my bakery better than I do."

Each shot includes:
- Camera direction (hand-held / screen-capture / split)
- On-screen text / data-testid references for determinism
- Bakery owner's line (one sentence)

### Step 2: `docs/demo/script.md`

Word-for-word narration aligned to the storyboard timecodes. Two columns: `[time]` and `[line]`. Target 150 words per minute → ~450 words total.

### Step 3: Commit

```bash
git add docs/demo/storyboard.md docs/demo/script.md
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "docs(demo): 3-minute video storyboard + narration script"
```

---

## Task 14: Kaggle submission writeup + cover image spec

**Files:**
- Create: `docs/demo/writeup.md`
- Create: `docs/demo/cover-image-spec.md`

### Step 1: `docs/demo/writeup.md`

≤1500 words. Structure:

1. **The problem** (150 words) — food waste in independent bakeries, global scale, why existing tools don't fit small merchants
2. **The solution** (200 words) — what BakerySense does, one photo → full daily plan + explanation, numeric work deterministic, semantic work Gemma
3. **Gemma 4's role** (250 words) — multimodal ingestion, tool routing, merchant-facing explanations. Why Gemma 4 specifically (license, on-device path, tool-calling fidelity, multilingual bakery vocabulary)
4. **Architecture** (300 words) — brief diagram, Cloudflare stack, the pure-JS LightGBM walker detail, R2 feature store, Queues-driven agent loop, context compaction
5. **Results** (250 words) — French Bakery Kaggle numbers (MASE 0.73 vs 1.0, WAPE −27%), 19 of 20 SKUs beat baseline, 700/700 JS↔Python parity, feedback loop in place for month-two accuracy gains
6. **Tracks + deployment** (150 words) — Main + Impact (food waste) + Unsloth (QLoRA stretch) + llama.cpp (native runtime) + Ollama (packaging); live URL; open source under CC-BY-4.0
7. **What's next** (100 words) — TimesFM cold-start, tenant QLoRA, POS integrations

### Step 2: `docs/demo/cover-image-spec.md`

Spec for the cover image the user will design:
- 1200×630 (Kaggle + Twitter-card spec)
- Dominant honey-amber brand color
- Screenshot slice of dashboard + one Gemma chat bubble
- Single headline: "AI production copilot for independent bakeries."
- Small tags: Gemma 4 · Cloudflare Workers · Offline-first
- Suggest Canva / Figma template notes

### Step 3: Commit

```bash
git add docs/demo/writeup.md docs/demo/cover-image-spec.md
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "docs(submission): writeup draft (≤1500w) + cover image spec"
```

---

## Task 15: Final verify + README polish + handoff

**Files:**
- Modify: `README.md` — add Live Demo section, link to docs/demo/*
- Modify: `docs/architecture.md` — add Testing + Deployment summary
- Verify: everything is green

- [ ] **Step 1: Run full verify**

```bash
cd bakerysense-web
npm run verify                 # typecheck + lint + 106 workers + 10 unit (3 new llm-replay)
npm run test:e2e               # 7 Playwright scenarios with fixtures
cd ..
pytest tests/ -q               # 49 Python tests
```

- [ ] **Step 2: README updates**

Replace the "(in progress)" line on Week 2 with "complete". Add a Live Demo section near the top (below the badges):

```md
## Live demo

- App: https://bakerysense-web.<account>.workers.dev
- Video: https://www.youtube.com/watch?v=<id>  (replace after recording)
- Writeup: [docs/demo/writeup.md](docs/demo/writeup.md)

Demo credentials:
- `demo@bakerysense.app` / `Demo2026DemoDemo` — tenant_admin, all branches
- `manager@bakerysense.app` / `Manager2026Manager` — branch_manager, 2 branches
```

- [ ] **Step 3: docs/architecture.md updates**

Add "Testing matrix" and "Deployment" subsections summarizing the new pieces from P5.

- [ ] **Step 4: Update test-count badge**

Change the README badge from `tests-49 passing` (stale since P1) to `tests-172 passing` (49 Python + 106 workers + 10 unit + 7 E2E = 172).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture.md
git -c user.email=wmhy.tech@gmail.com -c user.name="BakerySense contributors" commit -m "docs: P5 complete — live-demo links, testing matrix, test-count badge 172"
```

- [ ] **Step 6: Hand off via `superpowers:finishing-a-development-branch`**

---

## Self-review

**Spec coverage:**

- §7.2 E2E journey — 7 scenarios: Tasks 5–11
- §7.3 test-friendly markup — each scenario task adds missing `data-testid` markers as needed
- §11.3 E2E — Playwright config (Task 1) + fixture replayer (Task 2) + shared seed (Task 4) + scenarios (Tasks 5–11) + CI (Task 12)
- §13.3 seed migrations — Task 3 (seed-demo endpoint + Python bundle helper)
- §15 deployment — Task 12 (docs/deploy.md + smoke script + CI)
- Week 4 submission — Task 13 (storyboard + script), Task 14 (writeup + cover), Task 15 (README polish)

**Deliberate scope choices:**

1. Demo video is NOT recorded by this plan — user records with the real bakery owner (per Week 4 status). Plan produces everything else (deployable app, storyboard, narration script, writeup, cover spec).
2. Playwright runs Chromium only. Cross-browser is out of scope for hackathon MVP.
3. `BS_REPLAY_FIXTURES` mechanism caches LLM responses in R2 by request hash. Adds complexity but is the only way to run chat/photo E2E deterministically. Fixtures are committed as JSON files and uploaded to R2 at test setup.
4. Refactor `LLMClient` to accept `env` in options (Task 2 option A) — breaks 3–4 call sites but is clean. Alternative (globalThis hack) is fragile.
5. CI runs E2E on PRs but not on `main` push — fast enough (< 5 min) and catches regressions before merge. `verify` stays separate for faster dev-loop feedback.
6. Deploy is DOCUMENTED, not AUTOMATED. The hackathon submission deploys manually to the user's Cloudflare account; CI-to-Cloudflare wiring is post-hackathon.
7. Cover image is SPEC'd, not GENERATED. The user designs it in Canva/Figma from the spec.
8. The Python `scripts/seed_demo_bundle.py` produces local files; operator uploads them via `wrangler r2 object put`. Not automated — R2 write from Python would require the S3-compat API with credentials, which adds secrets management for one-off upload.

**Placeholder scan:** No TBDs. Every task has real code or precise references. Two deliverables (writeup word counts, storyboard timings) have target numbers; actual word counts may land within ±10% — acceptable.

**Type consistency:**
- `ReplayRequest` defined once in Task 2, consumed by LLMClient refactor
- `DEMO` constant + `signIn()` helper defined in Task 4, consumed by all 7 scenarios
- `data-testid` naming convention consistent: `<component>-<action>` (e.g., `signin-submit`, `user-menu-signout`, `prompt-submit`)

**Dependencies between tasks:**
- Task 1 → all (Playwright install)
- Task 2 → Task 9, Task 10 (chat + photo need replay)
- Task 3 → Task 4 (seed endpoint before seed fixture)
- Task 4 → Tasks 5–11 (shared test helpers)
- Task 12 → Task 15 (CI before final verify)
- Tasks 13–14 independent of code tasks — can run in parallel with E2E tasks, no code dependency

---

## Execution Handoff

**Plan complete.**

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks.

**2. Inline Execution** — batch execution with checkpoints.

Which approach?
