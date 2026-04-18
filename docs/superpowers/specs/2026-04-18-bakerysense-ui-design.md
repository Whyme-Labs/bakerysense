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
  a preset registry of OpenAI-compatible endpoints (OpenRouter, Groq,
  Together, Cloudflare Workers AI, etc.) with BYOK + OAuth support

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
- **Provider connectors** via a generic `LLMClient` speaking OpenAI-compatible
  chat completions; OpenRouter is the default preset for Gemma 4
- **Drizzle ORM** for D1 schema + migrations

### 3.2. Compute placement

| Work | Where | Notes |
|---|---|---|
| LLM inference (chat, vision) | Worker → active connector upstream | Tenant's encrypted connector credential unwrapped per-request; `X-BYO-Key` + `X-BYO-BaseURL` header triple overrides for dev / anonymous |
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

connector:tenant:<tid>:<cid>    → { id, label, preset, baseUrl, model,
                                    authMethod, encCredential, createdAt,
                                    lastUsedAt }                   no ttl
connector:tenant:<tid>:index    → { connectorIds: [...], defaultId }
oauth:state:<state>             → { tenantId, connectorId, verifier,
                                    initiatedByUserId, createdAt } ttl=10m

chat:session:<sid>              → full blob (messages, userId, tenantId,
                                  branchId, connectorId,
                                  stateSummary?,                   // from
                                  createdAt, updatedAt)             // context
                                                                   // compaction
                                                                   ttl=7d
chat:user:<uid>:<sid>           → { createdAt }                   ttl=7d
chat:tenant:<tid>:<sid>         → { createdAt }                   ttl=7d
chat:turn:<sid>:<turnId>        → { status, partialEvents[],
                                    finalAnswer, toolRoundsUsed }  ttl=1h

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

### 5.7. LLM connectors and BYOK

BakerySense speaks to any **OpenAI-compatible chat completions endpoint**
via a uniform `LLMClient` abstraction. Configuration is per-tenant — the
tenant pays for the platform and owns the provider keys; staff members
within the tenant consume whichever connector the tenant admin has set as
default. This matches the "who pays for inference" principle and keeps
billing surface coherent.

**Connector record (shape):**

```ts
{
  id: "conn-abc",
  label: "Primary OpenRouter",
  preset: "openrouter" | "groq" | "together" | "cloudflare-ai"
        | "openai" | "anthropic-via-oai" | "ollama-tunnel" | "custom",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "google/gemma-4-e4b-it",
  authMethod: "api_key" | "oauth" | "none",
  encryptedCredential: "...",                // absent when authMethod=="none"
  createdAt, lastUsedAt
}
```

**Preset registry (hard-coded, extensible):**

| Preset | `baseUrl` | Gemma 4? | Auth | Reachable from Worker? |
|---|---|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | Yes (routed to Google) | API key **or** OAuth/PKCE | Yes |
| `groq` | `https://api.groq.com/openai/v1` | If listed | API key | Yes |
| `together` | `https://api.together.xyz/v1` | Usually | API key | Yes |
| `cloudflare-ai` | Workers AI binding | If `@cf/google/gemma-4-*` ships | Cloudflare-native | Yes |
| `openai` | `https://api.openai.com/v1` | No Gemma on OAI | API key | Yes |
| `ollama-tunnel` | user-supplied cloudflared URL | Yes if pulled | API key or none | Yes |
| `custom` | user-supplied | user-supplied | user choice | user-supplied |

**Three-tier selection on each LLM request:**

1. **Ephemeral override** — `X-BYO-Key` + `X-BYO-BaseURL` + `X-BYO-Model`
   headers. For developer testing and anonymous visitors only.
2. **Tenant's default connector** — authenticated users in a tenant use the
   tenant's `defaultId` connector; its encrypted credential is unwrapped by
   the Worker per request and passed to the upstream endpoint.
3. **Shared anonymous fallback** — Worker's `OPENROUTER_API_KEY` secret,
   available only to unauthenticated visitors, rate-limited to 5 turns per
   IP per hour via a KV counter.

**OAuth quick-connect (OpenRouter):** clicking "Connect via OAuth" on the
OpenRouter preset starts a PKCE flow (`/auth?response_type=code&...`). The
exchange response (a scoped token) becomes the connector's
`encryptedCredential`. The master API key never touches our storage.
Verification note — see §16 — confirm exact scopes/lifetime of the
OpenRouter OAuth response on day 1 (see §17).

**Encryption at rest:** every connector blob's `encryptedCredential` is
AES-256-GCM with a random IV using a Worker secret `CONNECTOR_MEK`. Ciphertext
is versioned (`v1:<base64>`) so MEK rotation re-encrypts lazily on next read
without downtime. We never log plaintext credentials, never include them in
analytics, never ship them to the browser, never write them to D1/R2 — only
the encrypted blob lives in KV.

**UI:**

- `/t/[slug]/admin/connectors` (tenant_admin only) — list, add, edit, delete,
  set default
- `<ConnectorForm>` with preset picker; OpenRouter preset shows "Connect via
  OAuth" alongside "Paste API key"
- `<ConnectorTest>` validates by calling the preset's `/models` endpoint
  before save
- Status badge in the app header shows the active connector label + preset

**Why this replaces single-vendor BYOK:**

Research on production LLM apps (LibreChat, LobeChat, Cursor) converges on
a generic OpenAI-compatible connector abstraction with preset presets. Locking
the platform to OpenRouter alone would force a painful migration later. The
`LLMClient` abstraction isolates provider-specific concerns from the agent
loop, so Gemma 4 rules (stop sequences, thought stripping, context compaction)
all live in the agent loop, not in any preset.

## 6. Agent loop and tool calling

### 6.0. Gemma 4 design rules (bake into the queue consumer)

These are non-negotiable, derived from Google's Gemma 4 model card + prompt
formatting docs + HuggingFace Gemma 4 blog + Unsloth Gemma 4 guide. The
`LLMClient` abstraction is provider-agnostic; **these rules live in the queue
consumer**, which applies them before/after every upstream call regardless of
which connector is active.

1. **Native `tools=[...]` JSON Schema, not ReAct.** Gemma 4's tool-calling
   accuracy is 86.4 % (vs 6.6 % on Gemma 3); explicit ReAct scaffolding costs
   2–4× the tokens for marginal gain at our scale (5 tools, 1–3 call depth).
   Only introduce ReAct if offline eval shows tool-selection errors.

2. **System prompt structure:** `<|think|>You are …` with thinking mode
   enabled for planning-heavy turns; drop the `<|think|>` marker for simple
   dispatch turns to save latency. Keep system prompt body ≤ ~2 000 tokens
   to stay inside Gemma 4 E4B's always-global attention layers (the model
   uses 512-token sliding-window attention interleaved with global layers).

3. **Explicit stop sequences** on every upstream call:
   `stop: ["<turn|>", "<tool_response>"]`. Defends against the documented
   Gemma runaway-generation failure mode.

4. **Strip prior thought blocks between turns.** Non-negotiable per the
   Gemma 4 docs: "historical model output should only include the final
   response." Our session blob in KV stores only cleaned assistant messages;
   within a single tool-calling turn, thoughts survive between rounds.

5. **Flat tool schemas.** E4B struggles with nested objects. All our tools
   use top-level scalar fields — `sku: string`, `branch_id: string`,
   `on_date: string` — never `filter: { sku, branch }`.

6. **Validate tool-call args with Zod at the queue-consumer boundary.** On
   validation failure, return an error tool_response (`{ error:
   "invalid_args: …" }`) rather than executing — this lets Gemma self-correct
   within the bounded loop.

7. **Handle parallel tool calls AND sequential.** E4B inconsistently emits
   multiple calls per turn; the loop dispatches all calls in a turn,
   collects results, then returns them together on the next round.

8. **Tool results are untrusted data.** The 2026 dominant prompt-injection
   vector is tool output instructing the next tool call. Sanitize result
   strings (escape Gemma's special tokens: `<turn|>`, `<tool_response>`,
   `<|think|>`) before feeding back; never let a tool's output pattern
   itself instruct another tool call.

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
                   2. resolve active connector for this session; instantiate
                      LLMClient; call upstream with messages + TOOL_SCHEMAS
                      + stop=["<turn|>","<tool_response>"]
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

- `max_tool_rounds_per_turn = 4` — cap for one user question
- `max_tool_rounds_per_session = 15` — cumulative cap across a chat session
  (prevents runaway loops from eating Worker CPU budget)
- Early termination if: (a) same tool called twice with identical args
  within a turn, (b) assistant emits text content without a `tool_calls`
  array (that is the final answer), (c) per-turn or session cap reached.
- On cap breach: emit SSE `{ event: "error", reason: "max_rounds" }` and
  persist a polite fallback answer to KV.

### 6.4. Context compaction

Gemma 4 E4B's context window is 128 K tokens, but quality softens noticeably
around 50–60 % fill because of the sliding-window attention design. E4B's
128K MRCR-v2 score is meaningfully below 26B (44 %) and 31B (66 %). We
compact at **~60 K tokens** for E4B-backed connectors and at **~150 K** for
26B / 31B.

**Token counting.** Use Gemma's SentencePiece tokenizer (262 K vocab) via
`@huggingface/transformers` loaded in a helper Worker. For hot-path budgeting
we approximate with `chars / 3.5`; the exact count runs asynchronously and
triggers compaction when it crosses the threshold.

**Strategy** (hybrid structured-state + summarization):

1. **Always keep verbatim:** system prompt, the most recent 3 user/assistant
   message pairs, the current turn's in-flight messages.
2. **Compact older turns:** replace each older assistant message with a
   1-sentence summary ("user asked for baguette forecast → bake 135, drivers
   were lag_7, rolling_7"). Drop old `tool_response` JSON bodies entirely;
   keep only a one-line summary of the tool name + key outputs.
3. **Maintain a `session_state` JSON** rebuilt by an `update_state` tool
   that Gemma calls at the end of each substantive turn. The state object
   holds current SKUs discussed, branches in scope, decisions made. Injected
   into the system prompt for every turn — so Gemma has stable context even
   as older prose is summarized away.
4. **LLM-driven summarization** happens in a side channel: when the token
   budget crosses the threshold, a background Worker invocation summarizes
   the drop-eligible turns using a small-model call (or the same Gemma 4
   with a tightly scoped prompt) and writes the compacted session blob back
   to KV.

The `session_state` approach is template-driven, not prose-driven, because
E4B's summarization quality is mediocre. Rebuilding a small JSON object via
a dedicated tool call is more reliable than asking Gemma to summarize itself
in natural language.

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
| `/t/[slug]/admin/connectors` | tenant_admin | LLM connector management (add / edit / default / delete, OAuth flow) |
| `/t/[slug]/admin/audit` | tenant_admin | Audit log table |
| `/account/settings` | authed | Password change, active sessions, personal dev overrides |

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
- `<DevOverridesPanel>` — `/account/settings` only; lets developers set
  `X-BYO-Key` / `X-BYO-BaseURL` / `X-BYO-Model` overrides for the current
  browser session (stored in `localStorage`, scoped to dev/testing)
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
- `<ConnectorList>`, `<ConnectorForm>` (preset picker + OAuth or API-key flow), `<ConnectorTest>` (validates against preset's `/models`)

### 8.6. Server-side modules (Worker code, no UI)

- `src/lib/auth/` — JWT sign/verify, JWKS cache, Argon2id, middleware
- `src/lib/rbac.ts` — `requireRole`, branch-scope checks
- `src/lib/tenant.ts` — slug resolution, tenant-locked query helpers
- `src/lib/llm/client.ts` — provider-agnostic `LLMClient` (chat, stop, tools)
- `src/lib/llm/presets.ts` — preset registry + per-preset request shaping
- `src/lib/llm/oauth/openrouter.ts` — OpenRouter PKCE flow
- `src/lib/llm/tokens.ts` — SentencePiece tokenizer helper + budget approximation
- `src/lib/connector.ts` — tenant connector CRUD (KV) + AES-GCM encryption
- `src/lib/compactor.ts` — context-compaction policy + state-extraction prompt
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
| Malformed tool-call args from Gemma | Zod validation fails → return `tool_response: { error: "invalid_args: <field> expected <type>" }` so Gemma self-corrects within the bounded loop |
| Tool-output prompt injection attempt | Result strings sanitized before feed-back (Gemma special tokens escaped); agent loop never lets a tool's output directly instruct another tool call |
| Connector misconfigured (wrong baseUrl, expired OAuth token) | Upstream returns 401/404; queue consumer catches, marks turn `failed` with `reason: "connector_auth"`, audit_log `connector.auth_failed`, prompts tenant_admin to re-validate in the connector admin page |
| Connector unreachable (network / CF egress block) | Upstream ECONNREFUSED / timeout; same failure flow as above with `reason: "connector_unreachable"` |
| Upstream provider 5xx | Consumer catches, marks turn `failed`, SSE `error` event, browser toast + retry |
| Upstream provider 429 | Exponential backoff up to 3 tries inside consumer; Queues retry further |
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
| Gemma round (active connector upstream) | 2000–8000 ms |
| Tool execution (in-Worker) | 5–20 ms |
| SSE chunk delivery | < 100 ms |
| **End-to-end chat turn (2 Gemma rounds, 1 tool call)** | **5–15 s typical** |

## 11. Testing strategy

### 11.1. Unit (Vitest, CI)

- `gbm-walker.ts` — parity with Python booster on 100 random feature vectors (abs error < 1e-4)
- `newsvendor.ts` — exact match with Python reference on a table of (cu, co, quantiles) cases
- `features.ts` — round-trip load + lookup
- `llm/client.ts` — mocked fetch against each preset's request shape (OpenAI-compatible + preset-specific quirks)
- `llm/tokens.ts` — SentencePiece token count vs Gemma's reference for 50 sample strings
- `compactor.ts` — context-compaction determinism: same session blob + threshold → same compacted output
- `connector.ts` — AES-GCM encrypt/decrypt round-trip, version-migration on MEK rotation
- `tools/*.ts` — happy path + error shapes per tool, Zod validation on malformed Gemma args, mocked feature store
- `auth/*` — JWT ES256 sign+verify round-trip, Argon2id timing guard, JWKS rotation (old kid still verifies while retired)

### 11.2. Integration (Vitest + Miniflare, CI)

- Signup → signin → refresh → signout against Miniflare D1 + KV
- `/api/chat` → queue → consumer → KV final state (mocked connector upstream fixtures, one per preset)
- Branch switch resets chat
- RBAC matrix: generated from `src/lib/rbac/permissions.ts` — every (role × route × scope) × {allow, deny} assertion
- Multi-tenant isolation: user in tenant A attempts every tenant-B resource, expects 404 on all

### 11.3. E2E (Playwright via e2e-demo skill)

- 7 scenarios from Section 7.2
- Data-testid selectors everywhere; no static sleeps
- Runs against `npm run dev` + `wrangler dev` + connector-replay fixtures (default preset = OpenRouter with recorded responses)
- Produces the demo video + user manual as a byproduct of the test run

### 11.4. Python side

The existing 39 pytest tests continue to guard the training pipeline
(`src/bakerysense/` in the repo root).

## 12. Security

- **Worker's default (shared anonymous) OpenRouter API key**: stored as
  `OPENROUTER_API_KEY` Worker secret; used only for unauthenticated visitors,
  rate-limited 5 turns / IP / hour
- **Tenant connector credentials**: stored as `encryptedCredential` in KV,
  AES-256-GCM with a Worker-secret `CONNECTOR_MEK`; versioned ciphertext
  for lazy re-encryption on MEK rotation; never logged, never in analytics,
  never shipped to the browser after save, never written to D1/R2
- **OpenRouter OAuth path**: the scoped token returned by OpenRouter's PKCE
  flow becomes the connector's `encryptedCredential`; the user's master
  OpenRouter API key never touches our infrastructure
- **Ephemeral `X-BYO-Key` header path**: useful for developer testing and
  anonymous visitors; key is in memory during the handler scope only; never
  persisted; `authMethod` variants accept `X-BYO-BaseURL` and `X-BYO-Model`
  to fully override the connector per-request
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

## 14. Feedback loop and retraining

### 14.1. Principle

BakerySense is only valuable to a merchant if its forecasts get better with
their own sales history. The initial shipped model trains on Favorita data
— public, real, but not this bakery's. The platform must capture what
actually happened each day and periodically retrain on the accumulated
tenant-specific actuals. Without this, the product is a static calculator.

True online learning (per-sample gradient updates) doesn't fit LightGBM
tree ensembles, and no production retail forecaster does it per-sample.
The industry pattern — **weekly batch retrain on accumulated actuals** —
is what we implement. The language "online learning" in retail-forecasting
usage means this closed feedback loop, not strict online algorithms.

### 14.2. Actuals capture

A tenant-scoped D1 table accumulates one row per (branch, family, date)
triple with the merchant's own ground truth:

```
daily_actuals
  id text pk,
  tenant_id text not null references tenants(id),
  branch_id text not null references branches(id),
  family text not null,                          -- SKU / product family
  date text not null,                            -- ISO YYYY-MM-DD
  recommended_bake integer,                      -- what our model said
  actual_bake integer,                           -- what they baked
  actual_sales integer,                          -- what they sold
  waste_units integer,                           -- unsold at end of day
  source text not null check(source in
    ('manual','close_out_photo','pos_import')),
  captured_by_user_id text references users(id),
  captured_at integer not null,
  unique(tenant_id, branch_id, family, date)
```

**Entry points** (in priority order by realism):

1. **"Close out day" form** on the dashboard — one row per SKU-branch, the
   merchant enters `actual_bake` + `actual_sales` at end of day. 30-second
   operation for a small bakery; skippable per SKU.
2. **Close-out photo path** — extends `/t/[slug]/display-case` into a
   bookend pattern: start-of-day photo (optional, captures batch size) and
   end-of-day photo (derives waste = start_count + bakes − end_count).
   Pre-fills the form, merchant just confirms.
3. **CSV import** via a drag-drop on `/t/[slug]/admin/retraining` — for
   bakeries with existing sales records to backfill history. Maps CSV
   columns to the schema; audit-logged.
4. **POS integration** (stub for MVP; documented extension point) — a
   webhook endpoint that accepts structured sales from Square, Toast,
   Lightspeed, etc. Post-hackathon.

Every capture writes an audit_log entry (`actuals.recorded`) and, if the
forecast for that (branch, family, date) exists, computes and stores the
per-row absolute error for immediate quality surfacing.

### 14.3. Retraining pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ Cloudflare Cron Worker  (weekly: Sun 02:00 UTC per tenant)    │
│   ├─ enumerate tenants with >= 30 days of daily_actuals       │
│   └─ enqueue retraining jobs on retrain-queue (one per tenant)│
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
          retrain-queue  →  Cloudflare Container  (Python)
                              ├─ pull daily_actuals + feature snapshot
                              │   for this tenant from D1 / R2
                              ├─ run training (same scripts that built
                              │   the initial model: LightGBM × 7
                              │   quantiles, identical hyperparameters)
                              ├─ validate: rolling MAE on the last
                              │   14 days must not regress by > 10 %
                              ├─ export trees JSON + features JSON
                              │   to R2 under
                              │   models/tenant:<tid>/v<n>/...
                              └─ write KV pointer
                                 model:active:<tid>  →  { version:<n>,
                                                          treesR2Key,
                                                          featuresR2Key,
                                                          trainedAt,
                                                          rollingMae }
```

- **KV pointer** gets read on Worker cold-start and on an explicit
  cache-bust after retrain completes. Workers invalidate their in-memory
  tree cache when they see a bumped version.
- **Rollback**: if the new version regresses validation by > 10 %,
  container aborts before publishing and logs to the tenant's audit log;
  old version remains active.
- **Cadence**: weekly for MVP (captures weekly seasonality), nightly if
  operational budget permits (Cloudflare Container cost is per-invocation).
- **Why a Container, not a Worker?** LightGBM is a compiled C++ library;
  Python retraining runs in CPython; neither fits in a Worker. This is
  exactly the compute-placement rule from §2: Python escape hatch for
  training; the runtime inference path stays in the Worker with the pure-JS
  tree walker.

### 14.4. Quality surfacing

- **Rolling metrics card on the dashboard** — per-SKU rolling WAPE over
  the last 7 / 28 days, computed from `daily_actuals` joined with saved
  forecasts. Shows trend arrow (improving / flat / regressing).
- **Drift alert** — if the rolling 14-day WAPE for a SKU exceeds 1.5× the
  holdout baseline established at training time, surface a banner on the
  SKU detail page: "Model accuracy has drifted for this product. Consider
  retraining or adding more recent actuals." Emits audit_log
  `drift.detected`.
- **"Forecast was wrong" button** on each dashboard row → opens a small
  form to capture the real number → writes a `daily_actuals` row and
  tags it `source=manual, priority=true` so the next retrain weights it
  extra.
- **Per-tenant retrain history** on `/t/[slug]/admin/retraining` —
  timeline of model versions with rolling MAE at training time, ability
  to manually trigger a retrain, ability to view which SKUs improved /
  regressed between versions.

### 14.5. Schema and KV additions (summary)

New D1 table: `daily_actuals` (above).

New KV keys:

```
model:active:<tenantId>       → { version, treesR2Key, featuresR2Key,
                                  trainedAt, rollingMae }
model:versions:<tenantId>     → [{ version, trainedAt, metrics }, ...]
retrain:last:<tenantId>       → { status, startedAt, finishedAt,
                                  outcome:'published'|'aborted', reason? }
```

New R2 layout:

```
bakerysense-models/
  tenant:<tid>/v<n>/trees/q*.json
  tenant:<tid>/v<n>/features/latest.json
  tenant:<tid>/versions.json
```

### 14.6. New page + components

- `/t/[slug]/admin/retraining` (tenant_admin)
- `<RetrainingHistory>` — version timeline + metrics
- `<TriggerRetrainButton>` — manual retrain dispatch
- `<CloseOutDayDialog>` — the merchant close-out form, invoked from the
  dashboard header
- `<QualityBadge>` — rolling-WAPE indicator on the dashboard and SKU detail
- `<DriftBanner>` — surfaced on SKU detail when thresholds are crossed
- `<ReportWrongForecastButton>` — inline on each dashboard row

### 14.7. What this unlocks post-MVP

- Tenant-specific model variants (each tenant's model diverges as their
  actuals accumulate — material quality gain after ~3 months of data)
- TS foundation model fine-tune (TimesFM / Timer-XL / Sundial) on
  tenant-specific data in the same Container pipeline
- Active learning — the "forecast was wrong" button feeds a priority queue
  the next retrain weights more heavily
- Federated / privacy-preserving training where tenant data never leaves
  the Container (post-hackathon; listed in scope boundaries)

## 15. Deployment

- **Dev:** `cd bakerysense-web && npm run dev` alongside `wrangler dev` for
  API + Queues simulation. Local D1 via Miniflare.
- **Staging:** `git push` → Cloudflare Workers preview URL
- **Production:** `npm run deploy` → `bakerysense-web.<account>.workers.dev`
  (custom domain if we buy one for the demo)
- **Secrets:** `OPENROUTER_API_KEY`, `SESSION_SIGNING_KEY`,
  `JWKS_ENCRYPTION_KEY`
- **Cron:** one cron Worker for JWKS rotation (daily 03:00 UTC)

## 16. Scope boundaries (explicit non-goals for MVP)

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
| Per-user personal connectors | Connectors are per-tenant in MVP | Post-hackathon when staff want personal quotas |
| Tenant-level cost dashboard / billing page | Analytics Engine exposes raw metrics; no UI | Commercial tier |
| Envelope encryption with password-derived DEK | Research shows rare outside password managers; blocks recovery on password reset | Enterprise tier if required |
| Local Ollama / LM Studio first-class connector (browser → localhost bypass of Worker) | Doubles code paths | Post-MVP; `ollama-tunnel` preset with cloudflared is the MVP workaround |

## 17. Open verification items (to confirm on day 1 of implementation)

1. **OpenRouter lists Gemma 4 today** under a stable model id (e.g.,
   `google/gemma-4-e4b-it`). If not, temporary fallback preset with a TODO
   to swap. Verified by one curl on `/api/v1/models`.
2. **Tool calling works via OpenRouter with Gemma 4.** One-shot curl on
   `/v1/chat/completions` with a dummy tool schema. Specifically confirm
   (a) `tools` parameter is respected, (b) stop sequences `<turn|>` and
   `<tool_response>` are recognized, (c) multiple tool calls per turn are
   emitted correctly when prompted.
3. **OpenRouter OAuth/PKCE flow** — confirm exact scopes, token lifetime,
   refresh support. If the flow is instant-one-shot (no refresh), document
   as such; still preferable to the user pasting their master API key.
4. **Cloudflare Queues requires Workers Paid ($5/mo).** Accepted cost.
5. **Pure-JS LightGBM walker numeric parity with Python booster.** Proven
   by unit test before any UI work proceeds (< 1e-4 abs error on 100 random
   feature vectors).
6. **Argon2id via `@noble/hashes` runs within Workers CPU budget.**
   Benchmark: one signup should take ~400 ms (intentional cost).
7. **SSE survives Cloudflare Workers `waitUntil` budget.** Confirmed by
   timing a 30-second stream.
8. **Gemma SentencePiece tokenizer loads in a Worker.** Benchmark: single
   token count on a 60 K-character session blob completes in < 500 ms.
9. **Context compaction round-trips preserve forecast accuracy.** A chat
   that reaches 60 K tokens, compacts, and then asks a new forecast
   question produces the same numeric output it would have without
   compaction (tool results are deterministic).

## 18. Success criteria

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

## 19. Change log

- **2026-04-18** — initial design, approved in brainstorming session
- **2026-04-18** — revision: generalized from single-vendor BYOK to
  OpenAI-compatible `LLMClient` + per-tenant connector model with preset
  registry (OpenRouter, Groq, Together, Cloudflare Workers AI, OpenAI,
  Ollama tunnel, custom); added OpenRouter OAuth/PKCE as preferred auth
  method on the OpenRouter preset
- **2026-04-18** — revision: added Section 6.0 (Gemma 4 design rules) with
  8 non-negotiable implementation guardrails derived from Gemma 4 docs +
  HF blog + Unsloth guide; added Section 6.4 (context compaction) with a
  hybrid structured-state + summarization strategy
- **2026-04-18** — revision: added Section 14 (Feedback loop and retraining)
  — daily_actuals capture, weekly batch retrain via Cloudflare Cron +
  Cloudflare Container, model versioning in R2/KV, quality surfacing and
  drift alerts, admin/retraining page. Shifted phasing note to 5 plans
  (added P4 Feedback loop). Renumbered subsequent sections.

## 20. References

- Python-side design: `docs/architecture.md` (forecaster / decision / agent
  layers) and `src/bakerysense/` source
- Hackathon rules: <https://www.kaggle.com/competitions/gemma-4-good-hackathon/rules>
- OpenRouter docs: <https://openrouter.ai/docs>
- Cloudflare Workers platform: <https://developers.cloudflare.com/workers/>
- Cloudflare Queues: <https://developers.cloudflare.com/queues/>
- @opennextjs/cloudflare adapter: <https://opennext.js.org/cloudflare>
- Favorita dataset: <https://www.kaggle.com/competitions/store-sales-time-series-forecasting>

## 21. Implementation phasing note

This spec describes the full target. The writing-plans skill (next step
after this spec is approved) will decompose it into phased plans — likely
five: **P1 Foundation** (D1 schema, Drizzle, auth, RBAC, multi-tenant
middleware, JWKS rotation, connector model), **P2 Forecasting Worker path**
(GBM walker, feature store, tool registry, queue consumer, SSE stream),
**P3 UI pages** (public + authenticated + admin incl. connectors),
**P4 Feedback loop** (actuals capture, retrain pipeline via Cloudflare
Container, quality surfacing, admin/retraining page), **P5 E2E + video
production**. P1 must finish before any of P2–P4; P2, P3, and P4 can
proceed in parallel; P5 depends on P2+P3 landing.
