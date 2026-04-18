# OpenNext Starter

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Read the documentation at https://opennext.js.org/cloudflare.

## Develop

Run the Next.js development server:

```bash
npm run dev
# or similar package manager command
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Preview

Preview the application locally on the Cloudflare runtime:

```bash
npm run preview
# or similar package manager command
```

## Deploy

Deploy the application to Cloudflare:

```bash
npm run deploy
# or similar package manager command
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Database (Cloudflare D1 + Drizzle ORM)

BakerySense uses Cloudflare D1 (SQLite-compatible) for persistence, managed via Drizzle ORM.

### Schema (`src/db/schema.ts`)

Six tables:

| Table | Purpose |
|---|---|
| `tenants` | Multi-tenant bakery organisations |
| `users` | User accounts (email + password_hash) |
| `memberships` | User-to-tenant role assignments (`platform_admin`, `tenant_admin`, `branch_manager`, `staff`, `viewer`) |
| `branches` | Physical bakery branch locations per tenant |
| `branch_access` | Many-to-many: which branches a membership can access |
| `audit_log` | Immutable event log per tenant |

### DB Client (`src/db/client.ts`)

```ts
import { getDb } from "@/db/client";
const db = getDb(env); // env.DB is the D1 binding
```

### Migrations (`drizzle/`)

Generated with `drizzle-kit`; applied with `wrangler d1 migrations apply`.

```bash
# Generate a new migration after schema changes
npx drizzle-kit generate --name <description>

# Apply to local Miniflare D1
npx wrangler d1 migrations apply bakerysense --local

# Apply to remote Cloudflare D1
npx wrangler d1 migrations apply bakerysense --remote
```

## Environment & Secrets

### Local Development

Local development uses `.dev.vars` (automatically loaded by `wrangler dev`). This file contains:

- `SESSION_SIGNING_KEY`: Random 32-byte base64 key for JWT session signing
- `JWKS_ENCRYPTION_KEY`: Random 32-byte base64 key for JWKS encryption
- `CONNECTOR_MEK`: Random 32-byte base64 key for connector encryption
- `OPS_ROTATE_SECRET`: Random 32-byte base64 key for operations rotation
- `OPENROUTER_API_KEY`: Placeholder for local testing (update with real key for AI features)
- `OPENROUTER_OAUTH_CLIENT_ID`: Placeholder for local testing

`.dev.vars` is gitignored and should never be committed to version control.

### Production Deployment

Before deploying to production, set all secrets using `wrangler secret put`:

```bash
wrangler secret put SESSION_SIGNING_KEY
wrangler secret put JWKS_ENCRYPTION_KEY
wrangler secret put CONNECTOR_MEK
wrangler secret put OPS_ROTATE_SECRET
wrangler secret put OPENROUTER_API_KEY
wrangler secret put OPENROUTER_OAUTH_CLIENT_ID
```

The same secrets must be available in production for the application to function correctly.

## Authentication

### Password Hashing (`src/lib/auth/argon2.ts`)

BakerySense uses **Argon2id** for password hashing, implemented in pure JavaScript via `@noble/hashes` (no native bindings — fully compatible with Cloudflare Workers).

Parameters (OWASP 2023 minimum):

| Parameter | Value |
|---|---|
| Memory cost (`m`) | 19 MiB (19 × 1024 KiB) |
| Time cost (`t`) | 2 iterations |
| Parallelism (`p`) | 1 |
| Hash length | 32 bytes |
| Salt length | 16 bytes (random per hash) |

Hash format follows the standard PHC string format: `$argon2id$v=19$m=...,t=...,p=...$<base64-salt>$<base64-hash>`

```ts
import { hashPassword, verifyPassword } from "@/lib/auth/argon2";

const hash = await hashPassword("user-password");        // returns PHC string
const ok   = await verifyPassword("user-password", hash); // constant-time compare
```

Dependencies: `@noble/hashes` (argon2id, randomBytes), `@scure/base` (base64 encoding).

### Unit Tests

```bash
npx vitest run tests/unit/argon2.test.ts
```

### JWT Tokens (`src/lib/auth/jwt.ts`)

BakerySense uses **ES256 (ECDSA P-256) JWTs** for stateless access tokens, implemented via the `jose` library (Web Crypto API — fully compatible with Cloudflare Workers).

Key types:

| Export | Description |
|---|---|
| `Role` | Union type: `platform_admin` \| `tenant_admin` \| `branch_manager` \| `staff` \| `viewer` |
| `AccessTokenClaims` | Token payload: `sub`, `tid`, `role`, `branches`, `kid` |
| `KeyPairJwk` | `{ privateJwk, publicJwk }` as `JsonWebKey` |

Core functions:

```ts
import { generateKeyPair, signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";

// Generate an ES256 key pair (for JWKS rotation)
const { privateJwk, publicJwk } = await generateKeyPair();

// Sign an access token (15-minute TTL typical)
const token = await signAccessToken(
  { sub: userId, tid: tenantId, role: "staff", branches: ["b1"], kid: "key-id" },
  { privateJwk, kid: "key-id", ttlSeconds: 900 },
);

// Verify and decode (resolvePublicJwk fetches the right key by kid from JWKS)
const claims = await verifyAccessToken(token, async (kid) => fetchPublicJwk(kid));
```

Token claims: `sub` (user id), `tid` (tenant id), `role`, `branches` (null = all branches), `iss` (`bakerysense`), `aud` (`bakerysense-web`), `iat`, `exp`, `kid` in protected header.

```bash
npx vitest run tests/unit/jwt.test.ts
```

### JWKS Store (`src/lib/auth/jwks.ts`)

BakerySense uses a **KV-backed JWKS store** where every private JWK is encrypted at rest using AES-256-GCM (AEAD) via `@noble/ciphers`. Key rotation retires the previous key with a 7-day grace window during which tokens signed with the old key remain verifiable.

#### Encryption

Each private JWK is encrypted with a per-entry random 12-byte IV before storage:

```
KV value = base64(IV[12] || AES-256-GCM-ciphertext+tag)
```

The master encryption key (`JWKS_ENCRYPTION_KEY`) is a 32-byte secret stored as a base64-encoded Wrangler secret.

#### KV Key Scheme

| KV key | Value |
|---|---|
| `jwks:active` | Current active `kid` (string) |
| `jwks:<kid>` | JSON `JwksEntry` with public JWK + encrypted private JWK |

#### API

```ts
import { getActivePrivateJwk, getPublicJwkByKid, rotateKeys, listActiveJwks } from "@/lib/auth/jwks";

// Get (or lazily create) the active private JWK for signing
const { kid, jwk } = await getActivePrivateJwk(env);

// Fetch a public JWK for token verification (throws if unknown or past grace)
const publicJwk = await getPublicJwkByKid(env, kid);

// Rotate: marks current key retired, generates a new active key
const { newKid, retiredKid } = await rotateKeys(env);

// List all keys still within the grace window
const keys = await listActiveJwks(env); // [{ kid, publicJwk, status }]
```

#### Rotation Grace Window

Retired keys remain verifiable for **7 days** (`RETIRE_GRACE_MS`). After that, `getPublicJwkByKid` throws `kid retired past grace: <kid>`, rejecting tokens signed with the expired key.

```bash
npx vitest run tests/unit/jwks.test.ts
```

## RBAC (`src/lib/rbac.ts`)

BakerySense enforces role-based access control with two helper functions:

| Function | Description |
|---|---|
| `requireRole(claims, allowed)` | Throws `ForbiddenError` (HTTP 403) if the JWT role is not in `allowed`. `platform_admin` bypasses all checks. |
| `assertBranchAccess(claims, branchId)` | Throws `NotFoundError` (HTTP 404) if the JWT does not permit access to `branchId`. `platform_admin` and `tenant_admin` bypass; `branches: null` means unrestricted within tenant. |

```ts
import { requireRole, assertBranchAccess, ForbiddenError, NotFoundError } from "@/lib/rbac";

// In an API route or middleware:
requireRole(claims, ["tenant_admin", "branch_manager"]);  // throws ForbiddenError if denied
assertBranchAccess(claims, "branch-uuid");                 // throws NotFoundError if denied
```

Error classes carry a `.status` property matching the HTTP status code for easy response mapping.

## LLM Connector Model (`src/lib/connector.ts` + `src/lib/connector-presets.ts`)

BakerySense supports per-tenant LLM connectors — each tenant can configure one or more upstream AI providers (OpenRouter, Groq, Together AI, Cloudflare Workers AI, OpenAI, or a custom OpenAI-compatible endpoint). Connector credentials are **encrypted at rest** with AES-256-GCM before being stored in KV.

### Connector model (`src/lib/connector.ts`)

```ts
import {
  createConnector, listConnectors, deleteConnector,
  getDefaultConnector, setDefaultConnector, resolveUpstreamCredential,
} from "@/lib/connector";

// Create a connector (credential is encrypted before KV write)
const c = await createConnector(env, tenantId, {
  label: "My OpenRouter",
  preset: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "google/gemma-4-e4b-it",
  authMethod: "api_key",
  credential: "sk-or-xxx",
});

// List all connectors for a tenant
const connectors = await listConnectors(env, tenantId);

// Get / change the default connector
const def = await getDefaultConnector(env, tenantId);
await setDefaultConnector(env, tenantId, c.id);

// Delete (default pointer auto-advances to next available)
await deleteConnector(env, tenantId, c.id);

// Decrypt the credential at call-time only
const apiKey = await resolveUpstreamCredential(env, c);
```

### Encryption at rest

Credentials are never stored in plaintext. Each credential is encrypted with a random 12-byte IV before being written to KV:

```
KV value: { ..., encryptedCredential: "v1:<base64(IV[12] || AES-256-GCM-ciphertext+tag)>" }
```

The master encryption key (`CONNECTOR_MEK`) is a 32-byte Wrangler secret (base64-encoded). Decryption happens only when `resolveUpstreamCredential` is called, immediately before an upstream API request.

### KV key scheme

| KV key | Value |
|---|---|
| `connector:tenant:<tid>:index` | JSON `ConnectorIndex` — ordered `connectorIds[]` + `defaultId` |
| `connector:tenant:<tid>:<connId>` | JSON `Connector` (credential already encrypted) |

### Presets (`src/lib/connector-presets.ts`)

Eight built-in presets with default base URLs and suggested models:

| Preset ID | Label | OAuth | API key |
|---|---|---|---|
| `openrouter` | OpenRouter | yes | yes |
| `groq` | Groq | no | yes |
| `together` | Together AI | no | yes |
| `cloudflare-ai` | Cloudflare Workers AI | no | no |
| `openai` | OpenAI | no | yes |
| `anthropic-via-oai` | Anthropic (via OAI proxy) | no | yes |
| `ollama-tunnel` | Local Ollama (tunnel) | no | no |
| `custom` | Custom OpenAI-compatible | no | yes |

```bash
npx vitest run tests/unit/connector.test.ts
```

## Auth API Routes

### POST /api/auth/signup (`src/app/api/auth/signup/route.ts`)

Registers a new tenant + admin user in one atomic sequence.

**Request body:**

```json
{
  "email": "admin@example.com",
  "password": "AtLeast12chars",
  "tenantName": "My Bakery",
  "tenantSlug": "my-bakery",
  "vertical": "bakery"
}
```

`vertical` must be one of: `bakery`, `grocery`, `pharmacy`, `retail`, `other`.

**On success (201):**

- Inserts `tenants`, `users`, `memberships` (role `tenant_admin`), and a default `branches` row (`name: "HQ"`)
- Issues a 15-minute ES256 JWT access token (`bs_at` cookie, HttpOnly, Secure, SameSite=Strict)
- Issues a 30-day refresh token stored in KV (`bs_rt` cookie, same security attributes)
- Returns `{ tenantSlug, userId, tenantId }`

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Zod validation failure (bad email, password < 12 chars, invalid slug/vertical) |
| 409 | Email already registered or tenant slug already taken |

**Implementation notes:**

- `getCloudflareContext()` from `@opennextjs/cloudflare` provides the `env` binding inside the Next.js route handler
- Password is hashed with Argon2id before any DB write; plaintext never persists
- IDs use `crypto.getRandomValues` (globally available in Workers) with a `prefix_base64` format

## Tenant Helpers (`src/lib/tenant.ts`)

Three database helpers for resolving tenant context from JWT claims:

| Function | Description |
|---|---|
| `resolveTenantBySlug(env, slug)` | Looks up a tenant by URL slug. Returns `null` if not found. |
| `loadMembership(env, userId, tenantId)` | Fetches the membership row for a (user, tenant) pair. Returns `null` if the user has no membership in that tenant. |
| `loadPermittedBranches(env, membershipId)` | Returns the list of branch IDs the membership can access, or `null` if access is unrestricted (no `branch_access` rows for that membership). |

```ts
import { resolveTenantBySlug, loadMembership, loadPermittedBranches } from "@/lib/tenant";

const tenant = await resolveTenantBySlug(env, "favorita"); // { id, slug, name, ... } | null
const membership = await loadMembership(env, userId, tenant.id);
const branches = await loadPermittedBranches(env, membership.id); // string[] | null
```

## Testing

All unit tests run inside the Cloudflare Workers sandbox via `@cloudflare/vitest-pool-workers`. The vitest config (`vitest.config.mts`) uses the `cloudflareTest` plugin with `wrangler.jsonc` (`env.test` environment) providing placeholder secrets and KV/D1 bindings for Miniflare.

D1 migration fixtures are loaded via a Vitest `globalSetup` (`tests/globalSetup.ts`) that reads the `drizzle/` SQL files using `readD1Migrations` and injects them into the Worker context through `tests/vitestSetup.ts`, making `env.MIGRATIONS` available to `applyD1Migrations` calls in tests.

Integration tests (`tests/integration/`) use `SELF.fetch` from `cloudflare:test` to dispatch HTTP requests through the worker entrypoint. For the test environment, `wrangler.jsonc` `env.test.main` points to `worker-test.js` — a thin dispatcher that sets the `getCloudflareContext()` global symbol and routes requests to the relevant Next.js route handler modules. This avoids a full `opennextjs-cloudflare build` for every test run.

```bash
# Run all tests (23 total)
npx vitest run

# Run individual suites
npx vitest run tests/unit/argon2.test.ts
npx vitest run tests/unit/jwt.test.ts
npx vitest run tests/unit/jwks.test.ts
npx vitest run tests/unit/rbac.test.ts
npx vitest run tests/unit/tenant.test.ts
npx vitest run tests/unit/connector.test.ts
npx vitest run tests/integration/auth-flow.test.ts
```

Note: Argon2 tests are CPU-intensive and require the 30-second `testTimeout` set in `vitest.config.mts`.
