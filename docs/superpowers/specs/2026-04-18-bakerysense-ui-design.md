# BakerySense UI — Design Spec

Date: 2026-04-18
Target: Gemma 4 Good Hackathon submission (deadline 2026-05-18)
Status: Approved design; ready for writing-plans

## 1. Context and motivation

BakerySense is a perishable-retail decision copilot. The Python half of the
project (LightGBM quantile forecaster, newsvendor decision layer, SHAP
explanation path, Gemma 4 tool-calling agent) already runs end-to-end on the
French Bakery Kaggle dataset with MASE 0.73 and a live scripted demo against
Gemma 4 E4B via Ollama.

This spec covers the **web application** that wraps that engine. It is not a
frontend skin over a Python backend — it is the full platform surface that
judges, a real bakery-chain client, and future verticals will interact with.

The UI must:

- Demonstrate the full product end-to-end for a 3-minute judging video
- Ship with platform-grade plumbing (auth, RBAC, multi-tenant) so we never
  enter migration hell when extending to grocery, pharmacy, or e-commerce
- Run on the Cloudflare suite as the primary deployment target, with browser
  WASM / WebGPU and Python containers as escape hatches
- Treat Gemma 4 as the only required external LLM dependency, routed through
  OpenRouter with BYOK support

Hackathon narrative frame: **multi-tenant retail forecasting platform,
bakery as first wedge, real chain as design partner.** The on-device /
offline claim applies to the forecasting core (inference happens in the
Worker or in the browser, never needs a hosted GPU); the access and
coordination layer is cloud-native Cloudflare.

## 2. Design principle

**Numeric work is deterministic. Semantic work is the LLM. They communicate
through a narrow tool-call surface.**

Gemma picks which tool to call, reads the structured JSON result, and renders
it as merchant-facing language. Gemma never produces forecast numbers.

Compute placement, in priority order:

1. Cloudflare Workers native (Workers, Queues, KV, R2, D1)
2. Browser WASM / WebGPU (when strictly local / offline wins)
3. Cloudflare Containers (when Workers CPU or memory limits bind)
4. Python (only for training, Unsloth fine-tune, and time-series foundation
   models like TimesFM / Timer-XL / Sundial)

At runtime, the BakerySense web application touches categories 1 and 4 — 4
only if a TS foundation-model sidecar is activated post-MVP.

## 3. Runtime architecture

### 3.1. Stack

- **Next.js 16** (React 19, Tailwind 4, TypeScript) via `@opennextjs/cloudflare`
- **Cloudflare Workers** for HTTP handling, middleware, page rendering, and
  the queue consumer
- **Cloudflare Queues** — `chat-queue` decouples the agentic loop from the
  HTTP request/response cycle
- **Cloudflare D1** for relational data (tenants, users, memberships,
  branches, audit_log)
- **Cloudflare KV** for blob-shaped / ephemeral / TTL-native data (refresh
  tokens, JWKS keys, chat sessions, rate limits, caches)
- **Cloudflare R2** for photo blobs (opt-in persistence) and serialized
  LightGBM tree JSON
- **OpenRouter** (external) as the Gemma 4 endpoint; BYOK supported
- **Drizzle ORM** for D1 schema + migrations

### 3.2. Compute placement

| Work | Where | Notes |
|---|---|---|
| LLM inference (chat, vision) | Worker → OpenRouter | OpenRouter API key server-side; `X-BYO-Key` header overrides |
| Tool-calling loop | Queue-consumer Worker | Runs the full Gemma↔tool dance without client round-trips |
| `forecast`, `explain_drivers`, `waste_risk`, `suggest_markdowns`, `list_skus` | Worker (pure-JS LightGBM walker) | ~200 LOC tree walker; serialized trees fetched from R2 and cached in-memory per instance |
| Session state, turn state, keys | KV (with TTL) | No joins, blob-shaped |
| Relational data | D1 (Drizzle) | Tenants, users, memberships, branches, audit |
| Photo blobs (opt-in persist) | R2 | Signed URLs, 30-day retention |
| Live updates to the browser | SSE over the Worker | `/api/chat/stream/:turnId` |
| LightGBM training + ONNX/tree-JSON export | Python (offline) | Artefacts land in R2 at build time |
| Fine-tune (Unsloth), TS foundation models | Python (offline or Container) | Out of scope for MVP |

### 3.3. URL structure

```
Public (no auth)            Authenticated (/t/<slug>/*)
────────────────            ──────────────────────────────
/                           /t/[slug]/dashboard
/signin                     /t/[slug]/chat
/signup                     /t/[slug]/sku/[family]
/forgot                     /t/[slug]/display-case
                            /t/[slug]/admin/users        (tenant_admin)
                            /t/[slug]/admin/branches     (tenant_admin)
                            /t/[slug]/admin/audit        (tenant_admin)
                            /account/settings
```

Tenant slug is required on every authenticated route. Middleware resolves
slug → tenant_id, verifies membership, attaches `{ userId, tenantId, role,
permittedBranchIds }` to `request.locals`.

## 4. Data layer

### 4.1. D1 tables (Drizzle schema)

```
tenants
  id text pk, slug text unique not null, name text not null,
  vertical text not null, plan text not null default 'free',
  created_at integer not null

users
  id text pk, email text unique not null,
  password_hash text not null,         -- Argon2id
  email_verified integer not null default 0,
  created_at integer not null, last_login_at integer

memberships
  id text pk,
  user_id text not null references users(id),
  tenant_id text not null references tenants(id),
  role text not null check(role in
    ('platform_admin','tenant_admin','branch_manager','staff','viewer')),
  created_at integer not null,
  unique(user_id, tenant_id)

branch_access
  membership_id text not null references memberships(id),
  branch_id text not null references branches(id),
  primary key(membership_id, branch_id)
  -- absence of any row = "all branches in the tenant"

branches
  id text pk, tenant_id text not null references tenants(id),
  name text not null, city text, cluster text, type text,
  created_at integer not null,
  unique(tenant_id, name)

audit_log
  id text pk, tenant_id text not null,
  actor_user_id text, action text not null,
  target text, metadata_json text, created_at integer not null
```

### 4.2. KV keyspaces

```
rt:<hashedToken>                → { userId, tenantId, issuedAt, expiresAt,
                                    ip, ua }                       ttl=30d
rt:user:<userId>:<hashed>       → {}                               ttl=30d
                                  (secondary index for listing a user's
                                   sessions + mass-revoke)

jwks:<kid>                      → { alg:'ES256', publicJwk,
                                    privateJwkEnc, status, createdAt,
                                    retiredAt }
jwks:active                     → <kid>

chat:session:<sid>              → full blob (messages, userId, tenantId,
                                  branchId, createdAt, updatedAt) ttl=7d
chat:user:<uid>:<sid>           → { createdAt }                   ttl=7d
chat:tenant:<tid>:<sid>         → { createdAt }                   ttl=7d
chat:turn:<sid>:<turnId>        → { status, partialEvents[],
                                    finalAnswer }                  ttl=1h

rate:<type>:<key>               → <counter>                        ttl=window
byok:valid:<keyHash>            → { ok:true, label }               ttl=5m
csrf:<token>                    → { userId, expiresAt }            ttl=1h
```

### 4.3. R2 buckets

```
bakerysense-models/
  trees/q01.json              serialized LightGBM trees for each quantile
  trees/q03.json              (fetched by Worker cold-start, in-memory cached)
  ...
  features/latest.json        last-28-day feature window per (tenant, branch, family)

bakerysense-photos/
  <tenantId>/<sessionId>/<timestamp>.jpg   opt-in persist, 30-day retention
```

### 4.4. Queues

```
chat-queue
  producer: POST /api/chat (Worker handler)
  consumer: queue-consumer Worker (runs the agent loop)
  max_retries: 3; dead-letter queue: chat-dlq
```

### 4.5. Consistency tradeoff

KV is eventually consistent globally (~60 s worst case). Accepted for
refresh-token revocation because access tokens are short-lived (15 min) and
a Durable-Object-per-user upgrade path exists if strong revocation becomes
necessary later. Not in MVP.

## 5. Auth, RBAC, multi-tenant

### 5.1. Tokens

- **Access token** — JWT signed ES256, 15 min TTL, carries
  `{ sub, tid, role, branches[], kid, iat, exp }`; delivered as HTTP-only
  `Secure` `SameSite=Strict` cookie named `bs_at`
- **Refresh token** — opaque 32-byte random, delivered as HTTP-only cookie
  `bs_rt`; stored hashed (SHA-256) in KV under `rt:<hashed>`; 30-day
  sliding expiry; rotated on every use; reuse of a revoked refresh nukes
  every session for that user

### 5.2. Password hashing

Argon2id via `@noble/hashes` (pure-JS, Worker-compatible). Parameters
`t=2, m=19 MiB, p=1` — OWASP 2024 baseline.

### 5.3. JWKS rotation

- Cron-triggered Worker runs daily at 03:00 UTC
- Generates a new P-256 keypair, stores private half encrypted at rest in
  KV (AEAD with a Worker-bound secret key), public half as JWK
- Sets new kid as `jwks:active`; old active marked `status=retired`
- Retired keys remain readable for **7 days** (verification grace); then
  deleted
- Public `/.well-known/jwks.json` exposes all current + retired public keys
- Worker instance memory caches JWKS; cache invalidates on miss or after 5
  minutes

### 5.4. RBAC

Roles, coarse-grained:

| Role | Scope | Authority |
|---|---|---|
| `platform_admin` | Global | Everything (support access) |
| `tenant_admin` | One tenant | Manage members, branches, all data within tenant |
| `branch_manager` | Listed branches | Full CRUD on their branches' forecasts, photos, chat |
| `staff` | Listed branches | Use forecasts, upload photos, chat; no admin |
| `viewer` | Listed branches | Read-only |

Permissions derive from role + branch scope. No separate permissions table
in MVP. Two enforcement points:

1. **Route middleware** — `requireRole(allowedRoles)` rejects requests whose
   access token does not carry one of the allowed roles. Mounted on every
   admin route and on mutating endpoints.
2. **Branch-scope check** — every handler that takes a `branch_id` argument
   (dashboard load, chat tool call, admin branch edit) calls
   `assertBranchAccess(tenantId, userId, role, branchId)`. For
   `tenant_admin` and `platform_admin` this is a no-op; for
   `branch_manager`, `staff`, and `viewer` it requires a matching
   `branch_access` row or returns 404.

The queue consumer re-checks branch scope on every tool invocation — an
access token is not enough, because tools take `branch_id` as an explicit
argument from Gemma. The system prompt tells Gemma which branches the user
can reach, but we do not trust the prompt; we assert at the tool boundary.

### 5.5. Multi-tenant

Every tenant-scoped query goes through a middleware that constrains queries
by `tenant_id`. No raw SQL in route handlers; Drizzle ORM enforces at compile
time. Cross-tenant attempts surface as 404 (not 403) to avoid enumerating
tenants.

### 5.6. Auth flows

- **Signup** — creates user, tenant, initial membership (tenant_admin), one
  default branch; issues tokens; audit_log `tenant.created`
- **Signin** — verifies password + tenant slug; issues tokens; audit_log
  `user.signed_in`
- **Refresh** — rotates pair; reuse-detection triggers revocation of all
  sessions for the user
- **Signout** — revokes current refresh; clears cookies
- **Password change** — requires current password; revokes all other
  sessions

Email verification and password reset are stubbed for MVP (tenant_admin
must DM new members with temporary passwords).

### 5.7. BYOK

OpenRouter key stored in browser `localStorage` under
`bakerysense.openrouter.key`. Transport via `X-BYO-Key` header on every
LLM-routed request. Worker key selection:

```ts
const key = request.headers.get('X-BYO-Key') ?? env.OPENROUTER_API_KEY
if (!key) return new Response('no key available', { status: 402 })
```

Validation endpoint `/api/key/validate` makes a cheap `/v1/models` probe.
UI shows key source in the status badge ("Key: yours" / "Key: shared").

## 6. Agent loop and tool calling

### 6.1. Sequence (one chat turn)

```
browser ─ POST /api/chat ─► Worker
                              ├─ validate, assign turnId
                              ├─ KV write chat:turn:<sid>:<turnId> = {queued}
                              └─ enqueue chat-queue
                             ── 202 { turnId, streamUrl }

browser ─ GET /api/chat/stream/:turnId (SSE) ─► Worker
                                                  └─ tails chat:turn KV entry,
                                                     emits events as they land

chat-queue ─► queue-consumer
                 loop:
                   1. load session from chat:session:<sid>
                   2. call OpenRouter with messages + TOOL_SCHEMAS
                   3. if tool_call: execute in-Worker, append tool result,
                      write partial event to chat:turn, goto 2
                   4. final answer: append assistant message, write final
                      event to chat:turn, save session
```

### 6.2. Tools

Each tool is a TS file under `src/lib/tools/*.ts` exporting
`{ schema: JSONSchema, handler: async (args, ctx) => result }`. The queue
consumer owns a static `TOOL_REGISTRY` map. All tools receive
`{ userId, tenantId, permittedBranchIds, featureStore }` via `ctx` and must
reject calls with a `branch_id` the user can't access.

Initial tools mirror the Python agent's surface exactly:

- `list_skus({ branch })`
- `forecast({ sku, on_date, branch })`
- `explain_drivers({ sku, on_date, branch, top_k? })`
- `waste_risk({ sku, on_date, branch, threshold_pct? })`
- `suggest_markdowns({ inventory, as_of?, branch })`

Result shapes identical to the Python versions so we can reuse the existing
fixtures in tests.

### 6.3. Bounded loop

`max_tool_rounds = 4`. On exceeding: emit `{ event: "error", reason:
"max_rounds" }` and persist a helpful fallback answer.

## 7. Pages and user journey

### 7.1. Page inventory

| Route | Auth | Purpose |
|---|---|---|
| `/` | public | Landing — pitch, stats, sample exchange |
| `/signin` | public | Email + password + tenant slug |
| `/signup` | public | Creates user + tenant + default branch |
| `/forgot` | public | Stub page, "email your admin" for MVP |
| `/t/[slug]/dashboard` | authed | Today's bake plan (20 rows, per-branch) |
| `/t/[slug]/sku/[family]` | authed | Per-product deep dive — quantile chart, SHAP bars, trend |
| `/t/[slug]/chat` | authed | Gemma conversation with tool-call trace |
| `/t/[slug]/display-case` | authed | Upload photo → counts → markdown list |
| `/t/[slug]/admin/users` | tenant_admin | Member table, invite/remove, role edit |
| `/t/[slug]/admin/branches` | tenant_admin | Branch CRUD |
| `/t/[slug]/admin/audit` | tenant_admin | Audit log table |
| `/account/settings` | authed | Password change, BYOK dialog, active sessions |

### 7.2. End-to-end demo journey (maps to Playwright scenarios)

```
Scenario 1  /                              click "Start demo" CTA
Scenario 2  /signin                        fill demo creds, submit
Scenario 3  /t/favorita/dashboard          see 5-branch × 10-family table,
                                           pick TRADITIONAL BAGUETTE row
Scenario 4  /t/favorita/sku/bread-bakery   see quantile chart + SHAP bars,
                                           click "Ask Why"
Scenario 5  /t/favorita/chat?prefill=...   Gemma calls forecast + explain,
                                           streams answer via SSE
Scenario 6  /t/favorita/display-case       upload shelf.jpg, see counts,
                                           click "what to mark down?"
Scenario 7  (via user menu) sign out       back to /
```

Each scenario is independent (Playwright can run them standalone) but they
chain naturally for the demo video as one continuous story.

### 7.3. Test-friendly markup

- Every interactive element has a stable `data-testid`
- Loading signals expose `data-state="loading|ready|error"` for
  DOM-based waits (no sleeps)
- Forecasts render from `features-latest.json` at a fixed `last_data_date`
  so runs are deterministic
- Gemma answers are non-deterministic; tests assert on tool-call shape and
  numeric result, not on prose

## 8. Components

### 8.1. Shared

- `<Nav>` — top bar with tenant header, branch selector, user menu, settings gear
- `<BranchSelector>` — dropdown; persists to KV session; rewrites system prompt on change
- `<UserMenu>` — account settings, sign out
- `<ApiKeyDialog>` — BYOK input + validate button
- `<StatusBadge>` — model label, data freshness, key source, branch
- `<ErrorBoundary>` — route-level fallback
- `<TenantHeader>` — tenant name, vertical tag

### 8.2. Forecast views

- `<BakePlanTable>` — dashboard table
- `<ConfidenceBar>` — horizontal quantile band with newsvendor marker
- `<QuantileChart>` — hand-rolled SVG; band for tomorrow, actual-vs-predicted sparkline for last 28 days
- `<DriverBars>` — horizontal signed-SHAP bars, top-k
- `<TrendLine>` — 90-day sparkline

### 8.3. Chat

- `<ChatThread>` — subscribes to SSE for active turn; renders messages as they arrive
- `<MessageBubble>` — variants: user, assistant, tool (collapsed by default)
- `<ToolTrace>` — expandable card with tool name, args, result JSON
- `<PromptInput>` — textarea + submit; disabled while streaming; reads `?prefill`
- `<TurnStatus>` — "Calling Gemma…" / "Running forecast…" / "Done"

### 8.4. Display case

- `<PhotoUpload>` — file input + drag-drop; preview; posts to `/api/photo`
- `<CountsTable>` — editable; user can correct miscounts before handoff to `suggest_markdowns`
- `<MarkdownList>` — per-SKU recommendation card with dismiss
- `<ChatAboutPhoto>` — forwards counts + question to `/chat`

### 8.5. Admin

- `<MemberTable>`, `<InviteDialog>`, `<BranchTable>`, `<BranchEditor>`, `<AuditLogTable>`

### 8.6. Server-side modules (Worker code, no UI)

- `src/lib/auth/` — JWT sign/verify, JWKS cache, Argon2id, middleware
- `src/lib/rbac.ts` — `requireRole`, branch-scope checks
- `src/lib/tenant.ts` — slug resolution, tenant-locked query helpers
- `src/lib/openrouter.ts` — typed chat completion wrapper
- `src/lib/gbm-walker.ts` — pure-JS LightGBM inferencer + SHAP
- `src/lib/features.ts` — feature-store loader from R2
- `src/lib/newsvendor.ts` — order-quantity math, byte-for-byte parity with Python
- `src/lib/session.ts` — KV chat session CRUD
- `src/lib/queue-consumer.ts` — entry point for chat-queue consumer
- `src/lib/tools/` — one file per tool

### 8.7. What we are NOT pulling in

- No charting library (hand-rolled SVG for all charts)
- No form library (native `<form>`)
- No state-management library (per-page local state + server fetches)
- No component kit (Tailwind primitives only)

## 9. Visual identity

One Tailwind tokens layer with CSS custom properties so the entire UI
recolors via one file rename:

```css
/* bakery.tokens.css */
:root {
  --brand-50:  oklch(0.98 0.02 70);
  --brand-500: oklch(0.76 0.14 70);     /* honey amber */
  --brand-700: oklch(0.52 0.13 60);     /* baked terracotta */
  --surface:   oklch(0.99 0 0);
  --surface-muted: oklch(0.97 0.01 80);
  --ink:       oklch(0.22 0 0);
  --ink-muted: oklch(0.50 0.01 0);
  --accent-warn: oklch(0.72 0.16 40);
  --accent-good: oklch(0.68 0.14 155);
}
```

Swap to `grocery.tokens.css` (greens) or `pharmacy.tokens.css` (blues) to
demonstrate vertical extensibility in the video's closing beat.

Type: Geist Sans (scaffold default) + Geist Mono for numeric tabular content.
Numbers always `tabular-nums`. Motion is minimal: 150 ms hover tweens,
200 ms SSE-chunk enter, no spinners — skeletons and typing-dot pulses only.
Density is generous (16 px base, 1.5 line-height).

## 10. Error handling and observability

### 10.1. Error categories

| Category | Handling |
|---|---|
| Forecaster miss (unknown SKU for this tenant's feature store) | Tool returns `{ error: "Unknown SKU for branch <id>" }`; Gemma retries or reports |
| Branch specified in tool call that user cannot access | Tool returns `{ error: "Branch not found" }` (404-equivalent, no enumeration); audit_log `branch.access.denied` |
| OpenRouter 5xx | Consumer catches, marks turn `failed`, SSE `error` event, browser toast + retry |
| OpenRouter 429 | Exponential backoff up to 3 tries inside consumer; Queues retry further |
| Photo too large / unsupported | Worker 400 at `/api/photo`; no queue message enqueued |
| Gemma returns malformed tool args | Tool dispatch returns error; Gemma sees + retries; bounded at 4 rounds |
| KV eventual-consistency read miss | Retry once after 250 ms; then assume fresh session |
| Browser SSE disconnect | Queue consumer runs to completion; on reconnect browser polls `/api/chat/turn/:id` for final state |
| Cross-tenant access attempt | Return 404; audit_log `tenant.access.denied` |
| Revoked refresh reuse | Nuke all user sessions; audit_log `token.reuse_detected` |

### 10.2. Observability

- Workers Analytics Engine for per-turn metrics (latency, tool count, token usage, error rate, `key_source: byo|default`)
- `wrangler tail` for live dev logs
- Dead-letter queue `chat-dlq` replayable by admin
- Audit log (D1) for tenant-admin visibility

### 10.3. Latency budget (for dashboard rendering + a typical chat turn)

| Step | Expected |
|---|---|
| Auth middleware (JWT verify, KV cache hit) | 1–5 ms |
| D1 tenant + membership lookup | 10–30 ms |
| Dashboard Worker → all-branches batch forecast | 50–150 ms |
| Chat `POST /api/chat` → 202 | 30–80 ms |
| Queue dispatch delay | 200–800 ms |
| Gemma round (OpenRouter) | 2000–8000 ms |
| Tool execution (in-Worker) | 5–20 ms |
| SSE chunk delivery | < 100 ms |
| **End-to-end chat turn (2 Gemma rounds, 1 tool call)** | **5–15 s typical** |

## 11. Testing strategy

### 11.1. Unit (Vitest, CI)

- `gbm-walker.ts` — parity with Python booster on 100 random feature vectors (abs error < 1e-4)
- `newsvendor.ts` — exact match with Python reference on a table of (cu, co, quantiles) cases
- `features.ts` — round-trip load + lookup
- `openrouter.ts` — mocked fetch, tool-call response shape
- `tools/*.ts` — happy path + error shapes per tool, mocked feature store
- `auth/*` — JWT ES256 sign+verify round-trip, Argon2id timing guard, JWKS rotation (old kid still verifies while retired)

### 11.2. Integration (Vitest + Miniflare, CI)

- Signup → signin → refresh → signout against Miniflare D1 + KV
- `/api/chat` → queue → consumer → KV final state (mocked OpenRouter fixtures)
- Branch switch resets chat
- RBAC matrix: generated from `src/lib/rbac/permissions.ts` — every (role × route × scope) × {allow, deny} assertion
- Multi-tenant isolation: user in tenant A attempts every tenant-B resource, expects 404 on all

### 11.3. E2E (Playwright via e2e-demo skill)

- 7 scenarios from Section 7.2
- Data-testid selectors everywhere; no static sleeps
- Runs against `npm run dev` + `wrangler dev` + OpenRouter-replay fixtures
- Produces the demo video + user manual as a byproduct of the test run

### 11.4. Python side

The existing 39 pytest tests continue to guard the training pipeline
(`src/bakerysense/` in the repo root).

## 12. Security

- **Worker's default OpenRouter API key**: stored as `OPENROUTER_API_KEY`
  Worker secret; never in the browser bundle; used when the request carries
  no `X-BYO-Key` header
- **Visitor's BYOK OpenRouter key**: lives only in the visitor's browser
  `localStorage` (`bakerysense.openrouter.key`); transmitted per-request as
  the `X-BYO-Key` header over TLS; never persisted server-side; never logged.
  The Worker does not write this value to KV, D1, R2, Analytics Engine, or
  any log stream
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Strict`, signed with HMAC key from Worker secret
- CSRF protection: double-submit cookie pattern on all mutating requests
- Photo upload: 5 MB limit, MIME-validated, EXIF stripped before R2 write
- CSP header: `default-src 'self'; connect-src 'self' https://openrouter.ai; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'`
- Rate limits:
  - `/api/auth/signin` — 5 attempts / 15 min / IP+email
  - `/api/auth/signup` — 3 / hour / IP
  - `/api/chat` — 60 turns / hour / user
  - `/api/photo` — 20 / hour / user
- Password policy: ≥ 12 chars, not in HIBP top-10k (stubbed in MVP; HIBP check is post-MVP)

## 13. Dataset and demo seeds

### 13.1. Primary dataset

Kaggle **"Store Sales — Time Series Forecasting"** (Corporación Favorita
successor, 2021 permanent). 54 stores × 33 families × 4.5 years. Filtered
in the offline pipeline to:

- 5 stores, chosen to span city, cluster, and type — e.g., 2 Quito + 2 Guayaquil + 1 rural
- ~8–10 product families, `BREAD/BAKERY` foregrounded in the video

### 13.2. Fallback dataset

French Bakery Kaggle set (single branch, our current data). Preserved as
a secondary test fixture so offline CI can always run without fetching
Favorita.

### 13.3. Seed migrations

Migrations create a demo tenant:

- Tenant slug `favorita`, vertical `bakery`, 5 branches matching the
  Favorita stores we selected
- User `demo@bakerysense.app` / `Demo2026Demo!`, role `tenant_admin`, all 5
  branches
- User `manager@bakerysense.app` / `Manager2026!`, role `branch_manager`,
  2 branches — used in the video to show RBAC

### 13.4. Data licensing notes

Favorita is Kaggle-competition data (non-commercial research/demo). We do
not redistribute the raw CSV; only derived aggregates (trees, feature
JSON) ship with the app. Writeup cites the source. Own-code is CC-BY-4.0
per hackathon Rules §2.5.

## 14. Deployment

- **Dev:** `cd bakerysense-web && npm run dev` alongside `wrangler dev` for
  API + Queues simulation. Local D1 via Miniflare.
- **Staging:** `git push` → Cloudflare Workers preview URL
- **Production:** `npm run deploy` → `bakerysense-web.<account>.workers.dev`
  (custom domain if we buy one for the demo)
- **Secrets:** `OPENROUTER_API_KEY`, `SESSION_SIGNING_KEY`,
  `JWKS_ENCRYPTION_KEY`
- **Cron:** one cron Worker for JWKS rotation (daily 03:00 UTC)

## 15. Scope boundaries (explicit non-goals for MVP)

| Out of scope | Why | Reintroduce when |
|---|---|---|
| Social login (Google, GitHub) | Adds auth-library integration; email+password is enough for tests | Commercial beta |
| Email verification flow | Stubbed; accounts work without verification | After demo video |
| Password reset by email | Stubbed; "email your admin" | Commercial beta |
| 2FA / TOTP | Post-hackathon | Commercial beta |
| SSO / SAML / OIDC | Out of scope | Enterprise tier |
| Billing / plans | Hackathon, no commercial flow | Commercial launch |
| Platform-admin UI | SSH into D1 for now | After hackathon |
| Real-time collaboration / Durable Objects | KV + SSE suffice for single-user chat | When two managers demo together |
| Multi-language UI | English for the video | Post-hackathon |
| Mobile-first layout | Demo shot on desktop | If we film from a tablet |
| Push notifications | Not in a browser demo | Post-hackathon |
| In-browser training UI | Training stays Python CLI | Never in this project |
| Unsloth fine-tune integration | Stretch post-video | After demo is shot |
| TS foundation model sidecar (TimesFM / Timer-XL / Sundial) | Stretch post-MVP | After cold-start SKUs appear |

## 16. Open verification items (to confirm on day 1 of implementation)

1. **OpenRouter lists Gemma 4 today.** If not, temporary fallback to Gemma 3 with a TODO to swap. Verified by one curl on `/api/v1/models`.
2. **Tool calling works via OpenRouter with Gemma 4.** One-shot curl test on `/v1/chat/completions` with a dummy tool schema.
3. **Cloudflare Queues requires Workers Paid ($5/mo).** Accepted cost.
4. **Pure-JS LightGBM walker numeric parity with Python booster.** Proven by unit test before any UI work proceeds.
5. **Argon2id via `@noble/hashes` runs within Workers CPU budget.** Benchmark: one signup should take ~400 ms (intentional cost).
6. **SSE survives Cloudflare Workers `waitUntil` budget.** Confirmed by timing a 30-second stream.

## 17. Success criteria

The spec is a success if, by 2026-05-18 at 23:59 UTC, we can:

1. Hit a public Cloudflare Workers URL with no login and reach `/signin`
2. Sign in as `demo@bakerysense.app` and land on `/t/favorita/dashboard`
3. See a 5-branch × ~10-family bake-plan table populated from live browser
   (or Worker) inference against the serialized LightGBM trees
4. Click through to `/sku/bread-bakery` and see the quantile chart +
   SHAP drivers
5. Ask a question on `/chat`, watch the SSE-streamed tool call + answer
6. Upload a display-case photo on `/display-case` and see counts +
   markdown suggestions
7. Sign out and sign back in as `manager@bakerysense.app` to verify RBAC
   restricts visible branches
8. `npm test` passes the unit + integration suite; `npx playwright test`
   runs the 7-scenario demo flow cleanly; both in CI
9. Repo carries `LICENSE` (CC-BY-4.0), `README.md` with reproducibility
   instructions, and a design doc (this file)

Anything less and the submission is weaker than the plan.

## 18. Change log

- **2026-04-18** — initial design, approved in brainstorming session

## 19. References

- Python-side design: `docs/architecture.md` (forecaster / decision / agent
  layers) and `src/bakerysense/` source
- Hackathon rules: <https://www.kaggle.com/competitions/gemma-4-good-hackathon/rules>
- OpenRouter docs: <https://openrouter.ai/docs>
- Cloudflare Workers platform: <https://developers.cloudflare.com/workers/>
- Cloudflare Queues: <https://developers.cloudflare.com/queues/>
- @opennextjs/cloudflare adapter: <https://opennext.js.org/cloudflare>
- Favorita dataset: <https://www.kaggle.com/competitions/store-sales-time-series-forecasting>

## 20. Implementation phasing note

This spec describes the full target. The writing-plans skill (next step
after this spec is approved) will decompose it into phased plans — likely
four: **P1 Foundation** (D1 schema, Drizzle, auth, RBAC, multi-tenant
middleware, JWKS rotation), **P2 Forecasting Worker path** (GBM walker,
feature store, tool registry, queue consumer, SSE stream), **P3 UI pages**
(public + authenticated + admin), **P4 E2E + video production**. Each phase
has its own success criteria and test bar; P1 must finish before P2 and P3
can proceed in parallel.
