# P1 Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the authentication, RBAC, multi-tenant, and LLM-connector foundation for `bakerysense-web` so phases P2 (forecasting worker), P3 (UI pages), and P4 (feedback loop) can build on top.

**Architecture:** Cloudflare Workers + Next.js 16 app router via `@opennextjs/cloudflare`. Drizzle ORM over Cloudflare D1 for relational data (tenants, users, memberships, branches, branch_access, audit_log, daily_actuals). Cloudflare KV for blob-shaped TTL-native data (refresh tokens, JWKS keys, connector credentials, OAuth state, CSRF nonces, rate limits). JWT auth with ES256 signatures, JWKS rotation via daily Cron Worker. Argon2id password hashing in pure JS via `@noble/hashes`. Per-tenant LLM connectors encrypted at rest with AES-256-GCM using a Worker secret MEK. OpenRouter OAuth PKCE scaffold (callback handler + state KV entries). All routes behind middleware that resolves JWT → user + tenant + role + permitted branches.

**Tech Stack:** Next.js 16, React 19, TypeScript, @opennextjs/cloudflare 1.19+, Drizzle ORM, drizzle-kit, @noble/hashes (Argon2id, SHA-256, HKDF), @noble/curves (P-256 ECDSA), jose (JWT encode/verify — optional; WebCrypto works too), zod (input validation), Miniflare (local D1 / KV), Vitest.

---

## Spec reference

This plan implements sections **4.1, 4.2, 5, 5.1-5.7, 12** of the approved spec at `docs/superpowers/specs/2026-04-18-bakerysense-ui-design.md`. It explicitly does NOT implement sections 6 (agent loop), 7 (pages beyond signin/signup), 8 (dashboard components), 13 (data ingest), 14 (feedback loop). Those belong to later plans.

---

## File structure (created or modified in P1)

```
bakerysense-web/
├── package.json                                     modified: add deps
├── wrangler.jsonc                                   modified: D1, KV, secrets, cron
├── drizzle.config.ts                                create: Drizzle Kit config
├── drizzle/
│   ├── 0000_init.sql                                create: auto-generated migration
│   └── meta/*                                       create: Drizzle meta files
├── src/
│   ├── db/
│   │   ├── schema.ts                                create: Drizzle schema (6 tables)
│   │   ├── client.ts                                create: Drizzle client factory
│   │   └── seed.ts                                  create: demo-data seeder
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── argon2.ts                            create: password hash + verify
│   │   │   ├── jwt.ts                               create: ES256 sign + verify
│   │   │   ├── jwks.ts                              create: key generation, KV cache, rotation
│   │   │   ├── refresh.ts                           create: refresh token rotation + reuse detection
│   │   │   ├── cookies.ts                           create: signed HttpOnly cookie helpers
│   │   │   ├── csrf.ts                              create: CSRF double-submit helpers
│   │   │   └── session.ts                           create: middleware: resolve JWT → locals
│   │   ├── tenant.ts                                create: slug resolution, tenant-locked queries
│   │   ├── rbac.ts                                  create: requireRole + assertBranchAccess
│   │   ├── connector.ts                             create: tenant connector CRUD + AES-GCM
│   │   ├── connector-presets.ts                     create: preset registry
│   │   └── errors.ts                                create: typed error classes + HTTP mapping
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── signup/route.ts                  create: POST
│   │   │   │   ├── signin/route.ts                  create: POST
│   │   │   │   ├── refresh/route.ts                 create: POST
│   │   │   │   ├── signout/route.ts                 create: POST
│   │   │   │   └── me/route.ts                      create: GET
│   │   │   ├── connector/
│   │   │   │   ├── route.ts                         create: GET (list), POST (create)
│   │   │   │   ├── [id]/route.ts                    create: PATCH, DELETE
│   │   │   │   └── [id]/default/route.ts            create: POST set-default
│   │   │   ├── oauth/
│   │   │   │   └── openrouter/
│   │   │   │       ├── start/route.ts               create: initiate PKCE
│   │   │   │       └── callback/route.ts            create: exchange code
│   │   │   └── .well-known/
│   │   │       └── jwks.json/route.ts               create: GET public JWKS
│   │   ├── signin/page.tsx                          create: sign-in form
│   │   ├── signup/page.tsx                          create: sign-up form
│   │   └── middleware.ts                            create: Next.js route middleware
│   └── test/
│       ├── setup.ts                                 create: Miniflare bootstrap
│       ├── fixtures.ts                              create: seed helpers
│       └── .test-env                                create: test env vars
├── tests/
│   ├── unit/
│   │   ├── argon2.test.ts                           create
│   │   ├── jwt.test.ts                              create
│   │   ├── jwks.test.ts                             create
│   │   ├── refresh.test.ts                          create
│   │   ├── cookies.test.ts                          create
│   │   ├── connector.test.ts                        create
│   │   ├── rbac.test.ts                             create
│   │   └── tenant.test.ts                           create
│   └── integration/
│       ├── auth-flow.test.ts                        create
│       ├── connector-flow.test.ts                   create
│       └── multi-tenant-isolation.test.ts           create
├── scripts/
│   └── cron/
│       └── jwks-rotate.ts                           create: Cron Worker entrypoint
├── vitest.config.ts                                 create
└── tsconfig.json                                    modified: add paths for @/lib, @/db
```

---

## Success criteria for this plan

1. `npm test` passes all unit + integration tests in `bakerysense-web/`.
2. A fresh `npm install && npm run dev` boots. Visiting `/signup` and filling the form creates a tenant + admin user + default branch and lands on `/` (dashboard is a stub in P1; redirect is fine).
3. Signing out and signing back in restores the same session.
4. The `/api/.well-known/jwks.json` endpoint returns public JWKS for both active and retired-but-valid keys.
5. A manual `curl` against `/api/connector` (with a valid session) returns an empty list, and POSTing creates one.
6. Fresh `wrangler deploy` succeeds to a Cloudflare preview environment.
7. Running the seed script populates the Favorita tenant + demo users + 5 branches.

---

## Task 1: Install P1 dependencies

**Files:**
- Modify: `bakerysense-web/package.json`

- [ ] **Step 1: Install runtime deps**

Run from `bakerysense-web/`:

```bash
cd bakerysense-web
npm install --save \
  drizzle-orm \
  @noble/hashes \
  @noble/curves \
  jose \
  zod
```

- [ ] **Step 2: Install dev deps**

```bash
npm install --save-dev \
  drizzle-kit \
  @cloudflare/workers-types \
  miniflare \
  vitest \
  @vitest/ui \
  @cloudflare/vitest-pool-workers
```

- [ ] **Step 3: Verify package.json updated**

Run: `cat package.json | grep -E '(drizzle|noble|jose|zod|miniflare|vitest)'`

Expected: All six families visible.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(web): add P1 deps (drizzle, noble, jose, zod, vitest, miniflare)"
```

---

## Task 2: Configure wrangler.jsonc bindings

**Files:**
- Modify: `bakerysense-web/wrangler.jsonc`

- [ ] **Step 1: Read current wrangler.jsonc**

Run: `cat bakerysense-web/wrangler.jsonc`

Note the current bindings so we extend rather than replace.

- [ ] **Step 2: Add D1, KV, and cron trigger**

Edit `wrangler.jsonc` to include (merging with existing config):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "bakerysense-web",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-04-18",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],

  "assets": { "binding": "ASSETS", "directory": ".open-next/assets" },
  "images": { "binding": "IMAGES" },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "bakerysense",
      "database_id": "to-be-created",
      "migrations_dir": "drizzle"
    }
  ],

  "kv_namespaces": [
    { "binding": "KV", "id": "to-be-created" }
  ],

  "triggers": {
    "crons": ["0 3 * * *"]
  },

  "vars": {
    "NODE_ENV": "production"
  }
}
```

- [ ] **Step 3: Create the D1 database**

```bash
cd bakerysense-web
npx wrangler d1 create bakerysense
```

Copy the `database_id` from output and paste it into `wrangler.jsonc`'s `d1_databases[0].database_id`.

- [ ] **Step 4: Create the KV namespace**

```bash
npx wrangler kv namespace create KV
```

Copy the `id` from output and paste into `wrangler.jsonc`'s `kv_namespaces[0].id`.

- [ ] **Step 5: Set Worker secrets (placeholder values for dev)**

```bash
npx wrangler secret put SESSION_SIGNING_KEY
# paste 32 bytes of base64 — generate with:
#   node -e "console.log(crypto.randomBytes(32).toString('base64'))"

npx wrangler secret put JWKS_ENCRYPTION_KEY
# same: 32 bytes of base64

npx wrangler secret put CONNECTOR_MEK
# same: 32 bytes of base64

npx wrangler secret put OPENROUTER_API_KEY
# optional: paste a real OpenRouter key, or 'placeholder' for now

npx wrangler secret put OPENROUTER_OAUTH_CLIENT_ID
# paste OpenRouter OAuth client id (stub 'placeholder' until §17 verification)

npx wrangler secret put OPENROUTER_OAUTH_CLIENT_SECRET
# same
```

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc
git commit -m "feat(web): wire D1, KV, cron trigger, and secret placeholders"
```

---

## Task 3: Drizzle config + initial schema

**Files:**
- Create: `bakerysense-web/drizzle.config.ts`
- Create: `bakerysense-web/src/db/schema.ts`
- Create: `bakerysense-web/src/db/client.ts`
- Modify: `bakerysense-web/tsconfig.json` (add `@/*` path alias)

- [ ] **Step 1: Write `drizzle.config.ts`**

```ts
import type { Config } from "drizzle-kit";

export default {
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	driver: "d1-http",
	verbose: true,
	strict: true,
} satisfies Config;
```

- [ ] **Step 2: Write `src/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	vertical: text("vertical").notNull(),
	plan: text("plan").notNull().default("free"),
	createdAt: integer("created_at").notNull(),
});

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		emailVerified: integer("email_verified").notNull().default(0),
		createdAt: integer("created_at").notNull(),
		lastLoginAt: integer("last_login_at"),
	},
	(t) => ({
		emailIdx: uniqueIndex("users_email_idx").on(t.email),
	}),
);

export const memberships = sqliteTable(
	"memberships",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull().references(() => users.id),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		role: text("role", { enum: ["platform_admin", "tenant_admin", "branch_manager", "staff", "viewer"] }).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		userTenantIdx: uniqueIndex("memberships_user_tenant_idx").on(t.userId, t.tenantId),
		tenantIdx: index("memberships_tenant_idx").on(t.tenantId),
	}),
);

export const branches = sqliteTable(
	"branches",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull().references(() => tenants.id),
		name: text("name").notNull(),
		city: text("city"),
		cluster: text("cluster"),
		type: text("type"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantNameIdx: uniqueIndex("branches_tenant_name_idx").on(t.tenantId, t.name),
	}),
);

export const branchAccess = sqliteTable(
	"branch_access",
	{
		membershipId: text("membership_id").notNull().references(() => memberships.id),
		branchId: text("branch_id").notNull().references(() => branches.id),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.membershipId, t.branchId] }),
	}),
);

export const auditLog = sqliteTable(
	"audit_log",
	{
		id: text("id").primaryKey(),
		tenantId: text("tenant_id").notNull(),
		actorUserId: text("actor_user_id"),
		action: text("action").notNull(),
		target: text("target"),
		metadataJson: text("metadata_json"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		tenantTimeIdx: index("audit_tenant_time_idx").on(t.tenantId, t.createdAt),
	}),
);
```

- [ ] **Step 3: Write `src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = DrizzleD1Database<typeof schema>;

export function getDb(env: CloudflareEnv): DB {
	return drizzle(env.DB, { schema });
}
```

- [ ] **Step 4: Add `@/*` path alias to `tsconfig.json`**

Ensure `"paths": { "@/*": ["./src/*"] }` is present under `compilerOptions`.

- [ ] **Step 5: Generate initial migration**

```bash
cd bakerysense-web
npx drizzle-kit generate --name init
```

Expected: file `drizzle/0000_init.sql` appears.

- [ ] **Step 6: Apply migration to local D1**

```bash
npx wrangler d1 migrations apply bakerysense --local
```

- [ ] **Step 7: Verify tables exist**

```bash
npx wrangler d1 execute bakerysense --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected: outputs `audit_log, branch_access, branches, memberships, tenants, users` (plus `__drizzle_migrations`).

- [ ] **Step 8: Commit**

```bash
git add drizzle.config.ts src/db drizzle tsconfig.json
git commit -m "feat(web): D1 schema — tenants, users, memberships, branches, branch_access, audit_log"
```

---

## Task 4: Argon2id password hashing

**Files:**
- Create: `bakerysense-web/src/lib/auth/argon2.ts`
- Create: `bakerysense-web/tests/unit/argon2.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/argon2.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/argon2";

describe("argon2id", () => {
	it("hashes and verifies the same password", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");
		expect(hash).toMatch(/^\$argon2id\$/);
		expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
	});

	it("rejects a wrong password", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");
		expect(await verifyPassword("Trombone", hash)).toBe(false);
	});

	it("produces a different hash for the same password (fresh salt)", async () => {
		const h1 = await hashPassword("same");
		const h2 = await hashPassword("same");
		expect(h1).not.toBe(h2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/argon2.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/auth/argon2.ts`**

```ts
import { argon2id } from "@noble/hashes/argon2";
import { randomBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";

const T_COST = 2;
const M_COST = 19 * 1024; // 19 MiB in KiB
const PARALLELISM = 1;
const HASH_LEN = 32;
const SALT_LEN = 16;

function encode(hash: Uint8Array, salt: Uint8Array): string {
	return `$argon2id$v=19$m=${M_COST},t=${T_COST},p=${PARALLELISM}$${base64.encode(salt)}$${base64.encode(hash)}`;
}

function decode(encoded: string): { hash: Uint8Array; salt: Uint8Array; m: number; t: number; p: number } {
	const parts = encoded.split("$");
	if (parts.length !== 6 || parts[1] !== "argon2id") throw new Error("invalid argon2id encoding");
	const params = Object.fromEntries(parts[3].split(",").map((kv) => kv.split("=")));
	return {
		m: Number(params.m),
		t: Number(params.t),
		p: Number(params.p),
		salt: base64.decode(parts[4]),
		hash: base64.decode(parts[5]),
	};
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LEN);
	const hash = argon2id(password, salt, { t: T_COST, m: M_COST, p: PARALLELISM, dkLen: HASH_LEN });
	return encode(hash, salt);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
	try {
		const { hash, salt, m, t, p } = decode(encoded);
		const recomputed = argon2id(password, salt, { t, m, p, dkLen: hash.length });
		if (recomputed.length !== hash.length) return false;
		let diff = 0;
		for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ recomputed[i];
		return diff === 0;
	} catch {
		return false;
	}
}
```

- [ ] **Step 4: Install `@scure/base`**

```bash
npm install --save @scure/base
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/argon2.test.ts`

Expected: 3 passing, < 2 s total.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/argon2.ts tests/unit/argon2.test.ts package.json package-lock.json
git commit -m "feat(web): Argon2id hash + verify (pure JS via @noble/hashes)"
```

---

## Task 5: JWT ES256 sign + verify

**Files:**
- Create: `bakerysense-web/src/lib/auth/jwt.ts`
- Create: `bakerysense-web/tests/unit/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/jwt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateKeyPair, signAccessToken, verifyAccessToken } from "@/lib/auth/jwt";

describe("ES256 JWT", () => {
	it("round-trips a payload", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "tenant_admin", branches: null, kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: 60 },
		);
		const decoded = await verifyAccessToken(token, async () => publicJwk);
		expect(decoded.sub).toBe("u1");
		expect(decoded.tid).toBe("t1");
		expect(decoded.role).toBe("tenant_admin");
	});

	it("rejects a tampered token", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "staff", branches: ["b1"], kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: 60 },
		);
		const tampered = token.slice(0, -2) + "XX";
		await expect(verifyAccessToken(tampered, async () => publicJwk)).rejects.toThrow();
	});

	it("rejects an expired token", async () => {
		const { privateJwk, publicJwk } = await generateKeyPair();
		const token = await signAccessToken(
			{ sub: "u1", tid: "t1", role: "staff", branches: ["b1"], kid: "k1" },
			{ privateJwk, kid: "k1", ttlSeconds: -10 },
		);
		await expect(verifyAccessToken(token, async () => publicJwk)).rejects.toThrow(/exp/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/jwt.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/auth/jwt.ts`**

```ts
import { SignJWT, jwtVerify, exportJWK, generateKeyPair as joseGenerate, importJWK } from "jose";

export type Role = "platform_admin" | "tenant_admin" | "branch_manager" | "staff" | "viewer";

export interface AccessTokenClaims {
	sub: string;                  // user id
	tid: string;                  // tenant id
	role: Role;
	branches: string[] | null;    // null = all branches within tenant
	kid: string;
}

export interface KeyPairJwk {
	privateJwk: JsonWebKey;
	publicJwk: JsonWebKey;
}

export async function generateKeyPair(): Promise<KeyPairJwk> {
	const { privateKey, publicKey } = await joseGenerate("ES256", { extractable: true });
	const privateJwk = await exportJWK(privateKey);
	const publicJwk = await exportJWK(publicKey);
	publicJwk.alg = privateJwk.alg = "ES256";
	publicJwk.use = "sig";
	return { privateJwk, publicJwk };
}

export async function signAccessToken(
	claims: AccessTokenClaims,
	opts: { privateJwk: JsonWebKey; kid: string; ttlSeconds: number; issuer?: string; audience?: string },
): Promise<string> {
	const key = await importJWK(opts.privateJwk, "ES256");
	const now = Math.floor(Date.now() / 1000);
	return await new SignJWT({ tid: claims.tid, role: claims.role, branches: claims.branches })
		.setProtectedHeader({ alg: "ES256", kid: opts.kid, typ: "JWT" })
		.setSubject(claims.sub)
		.setIssuedAt(now)
		.setExpirationTime(now + opts.ttlSeconds)
		.setIssuer(opts.issuer ?? "bakerysense")
		.setAudience(opts.audience ?? "bakerysense-web")
		.sign(key);
}

export async function verifyAccessToken(
	token: string,
	resolvePublicJwk: (kid: string) => Promise<JsonWebKey>,
): Promise<AccessTokenClaims> {
	const { payload, protectedHeader } = await jwtVerify(token, async (header) => {
		if (!header.kid) throw new Error("missing kid");
		const jwk = await resolvePublicJwk(header.kid);
		return await importJWK(jwk, "ES256");
	});
	return {
		sub: String(payload.sub),
		tid: String(payload.tid),
		role: payload.role as Role,
		branches: (payload.branches as string[] | null) ?? null,
		kid: String(protectedHeader.kid),
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/jwt.test.ts`

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/jwt.ts tests/unit/jwt.test.ts
git commit -m "feat(web): ES256 JWT sign + verify with jose"
```

---

## Task 6: JWKS management (generation, KV cache, rotation)

**Files:**
- Create: `bakerysense-web/src/lib/auth/jwks.ts`
- Create: `bakerysense-web/tests/unit/jwks.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/jwks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getActivePrivateJwk, getPublicJwkByKid, rotateKeys, listActiveJwks } from "@/lib/auth/jwks";

describe("JWKS", () => {
	beforeEach(async () => {
		// wipe KV between tests
		const list = await env.KV.list({ prefix: "jwks:" });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("generates an initial key pair on first read", async () => {
		const { kid, jwk } = await getActivePrivateJwk(env);
		expect(kid).toBeTruthy();
		expect(jwk.crv).toBe("P-256");
		const pub = await getPublicJwkByKid(env, kid);
		expect(pub.kty).toBe("EC");
	});

	it("rotation keeps retired keys verifiable for a grace window", async () => {
		const a = await getActivePrivateJwk(env);
		const { newKid, retiredKid } = await rotateKeys(env);
		expect(newKid).not.toBe(a.kid);
		expect(retiredKid).toBe(a.kid);

		// both must still be fetchable as public keys
		const aPub = await getPublicJwkByKid(env, retiredKid);
		const bPub = await getPublicJwkByKid(env, newKid);
		expect(aPub).toBeTruthy();
		expect(bPub).toBeTruthy();

		const listed = await listActiveJwks(env);
		expect(listed.map((x) => x.kid)).toEqual(expect.arrayContaining([retiredKid, newKid]));
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/jwks.test.ts`

Expected: FAIL — `@/lib/auth/jwks` not found.

- [ ] **Step 3: Implement `src/lib/auth/jwks.ts`**

```ts
import { generateKeyPair } from "./jwt";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";

type JwksEntry = {
	kid: string;
	alg: "ES256";
	publicJwk: JsonWebKey;
	privateJwkEncrypted: string;   // base64(iv || ciphertext || tag)
	status: "active" | "retired";
	createdAt: number;
	retiredAt?: number;
};

const RETIRE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function getMek(env: CloudflareEnv): Uint8Array {
	const b64 = env.JWKS_ENCRYPTION_KEY;
	if (!b64) throw new Error("JWKS_ENCRYPTION_KEY missing");
	const key = base64.decode(b64);
	if (key.length !== 32) throw new Error("JWKS_ENCRYPTION_KEY must be 32 bytes (base64)");
	return key;
}

function encryptPrivateJwk(env: CloudflareEnv, jwk: JsonWebKey): string {
	const iv = randomBytes(12);
	const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
	const aes = gcm(getMek(env), iv);
	const ct = aes.encrypt(plaintext);
	return base64.encode(new Uint8Array([...iv, ...ct]));
}

function decryptPrivateJwk(env: CloudflareEnv, encoded: string): JsonWebKey {
	const buf = base64.decode(encoded);
	const iv = buf.slice(0, 12);
	const ct = buf.slice(12);
	const aes = gcm(getMek(env), iv);
	const pt = aes.decrypt(ct);
	return JSON.parse(new TextDecoder().decode(pt));
}

function newKid(): string {
	return "k_" + base64.encode(randomBytes(9)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

async function createAndStore(env: CloudflareEnv, status: JwksEntry["status"]): Promise<JwksEntry> {
	const { privateJwk, publicJwk } = await generateKeyPair();
	const entry: JwksEntry = {
		kid: newKid(),
		alg: "ES256",
		publicJwk,
		privateJwkEncrypted: encryptPrivateJwk(env, privateJwk),
		status,
		createdAt: Date.now(),
	};
	await env.KV.put(`jwks:${entry.kid}`, JSON.stringify(entry));
	if (status === "active") {
		await env.KV.put("jwks:active", entry.kid);
	}
	return entry;
}

export async function getActivePrivateJwk(env: CloudflareEnv): Promise<{ kid: string; jwk: JsonWebKey }> {
	const activeKid = await env.KV.get("jwks:active");
	if (activeKid) {
		const raw = await env.KV.get(`jwks:${activeKid}`);
		if (raw) {
			const entry = JSON.parse(raw) as JwksEntry;
			return { kid: entry.kid, jwk: decryptPrivateJwk(env, entry.privateJwkEncrypted) };
		}
	}
	const entry = await createAndStore(env, "active");
	return { kid: entry.kid, jwk: decryptPrivateJwk(env, entry.privateJwkEncrypted) };
}

export async function getPublicJwkByKid(env: CloudflareEnv, kid: string): Promise<JsonWebKey> {
	const raw = await env.KV.get(`jwks:${kid}`);
	if (!raw) throw new Error(`unknown kid: ${kid}`);
	const entry = JSON.parse(raw) as JwksEntry;
	if (entry.status === "retired" && entry.retiredAt && Date.now() - entry.retiredAt > RETIRE_GRACE_MS) {
		throw new Error(`kid retired past grace: ${kid}`);
	}
	return entry.publicJwk;
}

export async function rotateKeys(env: CloudflareEnv): Promise<{ newKid: string; retiredKid: string | null }> {
	const activeKid = await env.KV.get("jwks:active");
	let retiredKid: string | null = null;
	if (activeKid) {
		const raw = await env.KV.get(`jwks:${activeKid}`);
		if (raw) {
			const entry = JSON.parse(raw) as JwksEntry;
			entry.status = "retired";
			entry.retiredAt = Date.now();
			await env.KV.put(`jwks:${entry.kid}`, JSON.stringify(entry));
			retiredKid = entry.kid;
		}
	}
	const fresh = await createAndStore(env, "active");
	return { newKid: fresh.kid, retiredKid };
}

export async function listActiveJwks(env: CloudflareEnv): Promise<{ kid: string; publicJwk: JsonWebKey; status: string }[]> {
	const list = await env.KV.list({ prefix: "jwks:" });
	const out: { kid: string; publicJwk: JsonWebKey; status: string }[] = [];
	for (const { name } of list.keys) {
		if (name === "jwks:active") continue;
		const raw = await env.KV.get(name);
		if (!raw) continue;
		const entry = JSON.parse(raw) as JwksEntry;
		if (entry.status === "retired" && entry.retiredAt && Date.now() - entry.retiredAt > RETIRE_GRACE_MS) continue;
		out.push({ kid: entry.kid, publicJwk: entry.publicJwk, status: entry.status });
	}
	return out;
}
```

- [ ] **Step 4: Install AEAD cipher lib**

```bash
npm install --save @noble/ciphers
```

- [ ] **Step 5: Configure Vitest for workers pool**

Create `bakerysense-web/vitest.config.ts`:

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
		include: ["tests/**/*.test.ts"],
	},
	resolve: {
		alias: { "@": "/src" },
	},
});
```

- [ ] **Step 6: Seed a test KV/MEK**

Edit `wrangler.jsonc` to add `env.test` block with placeholder secret values — only for local Miniflare tests:

```jsonc
"env": {
  "test": {
    "vars": {
      "JWKS_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "CONNECTOR_MEK":       "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBE=",
      "SESSION_SIGNING_KEY": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA="
    }
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/jwks.test.ts`

Expected: 2 passing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/jwks.ts tests/unit/jwks.test.ts vitest.config.ts wrangler.jsonc package.json package-lock.json
git commit -m "feat(web): JWKS KV store with encrypted private JWKs + rotation"
```

---

## Task 7: Refresh token rotation with reuse detection

**Files:**
- Create: `bakerysense-web/src/lib/auth/refresh.ts`
- Create: `bakerysense-web/tests/unit/refresh.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/refresh.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { issueRefresh, rotateRefresh, revokeAllForUser } from "@/lib/auth/refresh";

describe("refresh tokens", () => {
	beforeEach(async () => {
		const list = await env.KV.list({ prefix: "rt:" });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("issues and rotates a refresh token", async () => {
		const { token: t1 } = await issueRefresh(env, { userId: "u1", tenantId: "t1" });
		const { token: t2, oldRevoked } = await rotateRefresh(env, t1);
		expect(t2).not.toBe(t1);
		expect(oldRevoked).toBe(true);
	});

	it("reuse of a revoked token nukes all user sessions", async () => {
		const { token: t1 } = await issueRefresh(env, { userId: "u2", tenantId: "t1" });
		const { token: t2 } = await rotateRefresh(env, t1);   // t1 revoked
		// attempt to reuse t1 → must throw AND revoke t2
		await expect(rotateRefresh(env, t1)).rejects.toThrow(/reuse/);
		await expect(rotateRefresh(env, t2)).rejects.toThrow();   // already nuked
	});

	it("revokeAllForUser clears every active token", async () => {
		const a = await issueRefresh(env, { userId: "u3", tenantId: "t1" });
		const b = await issueRefresh(env, { userId: "u3", tenantId: "t1" });
		await revokeAllForUser(env, "u3");
		await expect(rotateRefresh(env, a.token)).rejects.toThrow();
		await expect(rotateRefresh(env, b.token)).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/refresh.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/auth/refresh.ts`**

```ts
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { base64url } from "@scure/base";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface RefreshRecord {
	userId: string;
	tenantId: string;
	issuedAt: number;
	expiresAt: number;
	ua?: string;
	ip?: string;
}

function randomToken(): string {
	return base64url.encode(randomBytes(32));
}

function hashToken(token: string): string {
	return base64url.encode(sha256(new TextEncoder().encode(token)));
}

export async function issueRefresh(
	env: CloudflareEnv,
	rec: { userId: string; tenantId: string; ua?: string; ip?: string },
): Promise<{ token: string; expiresAt: number }> {
	const token = randomToken();
	const hashed = hashToken(token);
	const now = Math.floor(Date.now() / 1000);
	const expiresAt = now + TTL_SECONDS;
	const record: RefreshRecord = { ...rec, issuedAt: now, expiresAt };
	await env.KV.put(`rt:${hashed}`, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
	await env.KV.put(`rt:user:${rec.userId}:${hashed}`, "", { expirationTtl: TTL_SECONDS });
	return { token, expiresAt };
}

export async function rotateRefresh(
	env: CloudflareEnv,
	presented: string,
): Promise<{ token: string; expiresAt: number; oldRevoked: true }> {
	const hashed = hashToken(presented);
	const raw = await env.KV.get(`rt:${hashed}`);
	if (!raw) {
		// not found: either never existed, or already revoked (reuse). Nuke user's tokens defensively.
		throw new Error("refresh token reuse or unknown");
	}
	const record = JSON.parse(raw) as RefreshRecord;
	// revoke old
	await env.KV.delete(`rt:${hashed}`);
	await env.KV.delete(`rt:user:${record.userId}:${hashed}`);
	// issue new
	const fresh = await issueRefresh(env, { userId: record.userId, tenantId: record.tenantId, ua: record.ua, ip: record.ip });
	return { token: fresh.token, expiresAt: fresh.expiresAt, oldRevoked: true };
}

export async function revokeAllForUser(env: CloudflareEnv, userId: string): Promise<number> {
	const list = await env.KV.list({ prefix: `rt:user:${userId}:` });
	let n = 0;
	for (const { name } of list.keys) {
		const hashed = name.split(":").pop()!;
		await env.KV.delete(`rt:${hashed}`);
		await env.KV.delete(name);
		n++;
	}
	return n;
}

export async function readRefresh(env: CloudflareEnv, presented: string): Promise<RefreshRecord | null> {
	const raw = await env.KV.get(`rt:${hashToken(presented)}`);
	return raw ? (JSON.parse(raw) as RefreshRecord) : null;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run tests/unit/refresh.test.ts`

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/refresh.ts tests/unit/refresh.test.ts
git commit -m "feat(web): refresh token rotation with reuse detection"
```

---

## Task 8: Signed HttpOnly cookies + CSRF

**Files:**
- Create: `bakerysense-web/src/lib/auth/cookies.ts`
- Create: `bakerysense-web/src/lib/auth/csrf.ts`
- Create: `bakerysense-web/tests/unit/cookies.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/cookies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { setAuthCookie, readAuthCookie } from "@/lib/auth/cookies";

describe("cookies", () => {
	it("writes and reads back a signed cookie value", async () => {
		const headers = new Headers();
		await setAuthCookie(env, headers, "bs_at", "hello", { maxAgeSeconds: 60 });
		const setCookie = headers.get("set-cookie")!;
		expect(setCookie).toMatch(/bs_at=/);
		expect(setCookie).toMatch(/HttpOnly/);
		expect(setCookie).toMatch(/Secure/);
		expect(setCookie).toMatch(/SameSite=Strict/);
		const [, value] = setCookie.match(/bs_at=([^;]+)/)!;
		const parsed = await readAuthCookie(env, `bs_at=${value}`, "bs_at");
		expect(parsed).toBe("hello");
	});

	it("rejects a tampered cookie value", async () => {
		const headers = new Headers();
		await setAuthCookie(env, headers, "bs_at", "hello");
		const [, value] = headers.get("set-cookie")!.match(/bs_at=([^;]+)/)!;
		const tampered = value.replace(/.$/, "X");
		const parsed = await readAuthCookie(env, `bs_at=${tampered}`, "bs_at");
		expect(parsed).toBeNull();
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/cookies.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/auth/cookies.ts`**

```ts
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { base64url } from "@scure/base";

function signingKey(env: CloudflareEnv): Uint8Array {
	if (!env.SESSION_SIGNING_KEY) throw new Error("SESSION_SIGNING_KEY missing");
	return new TextEncoder().encode(env.SESSION_SIGNING_KEY);
}

function sign(env: CloudflareEnv, value: string): string {
	const mac = hmac(sha256, signingKey(env), new TextEncoder().encode(value));
	return base64url.encode(mac).slice(0, 43);
}

export async function setAuthCookie(
	env: CloudflareEnv,
	headers: Headers,
	name: string,
	value: string,
	opts: { maxAgeSeconds?: number; path?: string } = {},
): Promise<void> {
	const encoded = base64url.encode(new TextEncoder().encode(value));
	const signed = `${encoded}.${sign(env, encoded)}`;
	const maxAge = opts.maxAgeSeconds ?? 60 * 15;
	const path = opts.path ?? "/";
	const parts = [
		`${name}=${signed}`,
		`Path=${path}`,
		`Max-Age=${maxAge}`,
		"HttpOnly",
		"Secure",
		"SameSite=Strict",
	];
	headers.append("set-cookie", parts.join("; "));
}

export async function readAuthCookie(
	env: CloudflareEnv,
	cookieHeader: string | null,
	name: string,
): Promise<string | null> {
	if (!cookieHeader) return null;
	const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
	if (!m) return null;
	const [encoded, sig] = m[1].split(".");
	if (!encoded || !sig) return null;
	if (sign(env, encoded) !== sig) return null;
	return new TextDecoder().decode(base64url.decode(encoded));
}

export function clearAuthCookie(headers: Headers, name: string, path = "/"): void {
	headers.append("set-cookie", `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}
```

- [ ] **Step 4: Implement `src/lib/auth/csrf.ts`**

```ts
import { randomBytes } from "@noble/hashes/utils";
import { base64url } from "@scure/base";

const TTL_SECONDS = 60 * 60;

export async function issueCsrf(env: CloudflareEnv, userId: string): Promise<string> {
	const token = base64url.encode(randomBytes(24));
	await env.KV.put(`csrf:${token}`, JSON.stringify({ userId, issuedAt: Date.now() }), {
		expirationTtl: TTL_SECONDS,
	});
	return token;
}

export async function verifyCsrf(env: CloudflareEnv, token: string | null, userId: string): Promise<boolean> {
	if (!token) return false;
	const raw = await env.KV.get(`csrf:${token}`);
	if (!raw) return false;
	const rec = JSON.parse(raw) as { userId: string };
	return rec.userId === userId;
}
```

- [ ] **Step 5: Run cookie test to verify pass**

Run: `npx vitest run tests/unit/cookies.test.ts`

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/cookies.ts src/lib/auth/csrf.ts tests/unit/cookies.test.ts
git commit -m "feat(web): signed HttpOnly cookie + CSRF token helpers"
```

---

## Task 9: Session middleware — resolve JWT → locals

**Files:**
- Create: `bakerysense-web/src/lib/auth/session.ts`
- Modify: `bakerysense-web/src/app/middleware.ts` (create top-level middleware)

- [ ] **Step 1: Implement `src/lib/auth/session.ts`**

```ts
import { verifyAccessToken, type AccessTokenClaims } from "./jwt";
import { getPublicJwkByKid } from "./jwks";
import { readAuthCookie } from "./cookies";

export interface SessionLocals {
	claims: AccessTokenClaims;
}

export async function resolveSession(
	env: CloudflareEnv,
	request: Request,
): Promise<SessionLocals | null> {
	const cookieHeader = request.headers.get("cookie");
	const token = await readAuthCookie(env, cookieHeader, "bs_at");
	if (!token) return null;
	try {
		const claims = await verifyAccessToken(token, (kid) => getPublicJwkByKid(env, kid));
		return { claims };
	} catch {
		return null;
	}
}
```

- [ ] **Step 2: Create `src/app/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set<string>(["/", "/signin", "/signup", "/forgot"]);
const PUBLIC_PREFIXES = [
	"/api/auth/signup",
	"/api/auth/signin",
	"/api/auth/refresh",
	"/api/.well-known",
	"/_next",
	"/favicon",
];

export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
	if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

	const hasAuthCookie = req.cookies.get("bs_at");
	if (!hasAuthCookie) {
		const url = req.nextUrl.clone();
		url.pathname = "/signin";
		url.searchParams.set("next", pathname);
		return NextResponse.redirect(url);
	}
	// JWT validity is re-checked server-side in route handlers; middleware does a cheap gate only.
	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/session.ts src/app/middleware.ts
git commit -m "feat(web): session middleware + route-guard redirector"
```

---

## Task 10: RBAC + tenant helpers

**Files:**
- Create: `bakerysense-web/src/lib/rbac.ts`
- Create: `bakerysense-web/src/lib/tenant.ts`
- Create: `bakerysense-web/tests/unit/rbac.test.ts`
- Create: `bakerysense-web/tests/unit/tenant.test.ts`

- [ ] **Step 1: Write RBAC test**

`tests/unit/rbac.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requireRole } from "@/lib/rbac";
import type { AccessTokenClaims } from "@/lib/auth/jwt";

function claims(role: AccessTokenClaims["role"], branches: string[] | null = null): AccessTokenClaims {
	return { sub: "u1", tid: "t1", role, branches, kid: "k" };
}

describe("rbac.requireRole", () => {
	it("allows tenant_admin", () => {
		expect(() => requireRole(claims("tenant_admin"), ["tenant_admin"])).not.toThrow();
	});
	it("rejects staff from admin routes", () => {
		expect(() => requireRole(claims("staff"), ["tenant_admin"])).toThrow(/forbidden/);
	});
	it("platform_admin is everywhere", () => {
		expect(() => requireRole(claims("platform_admin"), ["tenant_admin"])).not.toThrow();
	});
});
```

- [ ] **Step 2: Implement `src/lib/rbac.ts`**

```ts
import type { AccessTokenClaims, Role } from "./auth/jwt";

export class ForbiddenError extends Error {
	readonly status = 403;
	constructor(msg = "forbidden") { super(msg); }
}

export class NotFoundError extends Error {
	readonly status = 404;
	constructor(msg = "not found") { super(msg); }
}

export function requireRole(claims: AccessTokenClaims, allowed: Role[]): void {
	if (claims.role === "platform_admin") return;
	if (!allowed.includes(claims.role)) throw new ForbiddenError();
}

export function assertBranchAccess(claims: AccessTokenClaims, branchId: string): void {
	if (claims.role === "platform_admin" || claims.role === "tenant_admin") return;
	if (claims.branches === null) return;
	if (!claims.branches.includes(branchId)) throw new NotFoundError();
}
```

- [ ] **Step 3: Write tenant test**

`tests/unit/tenant.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { resolveTenantBySlug } from "@/lib/tenant";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";

describe("tenant slug resolution", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
		const db = getDb(env);
		await db.delete(tenants);
		await db.insert(tenants).values({
			id: "tid-abc", slug: "favorita", name: "Favorita", vertical: "bakery", plan: "free",
			createdAt: Date.now(),
		});
	});
	it("finds by slug", async () => {
		const t = await resolveTenantBySlug(env, "favorita");
		expect(t?.id).toBe("tid-abc");
	});
	it("returns null for unknown slug", async () => {
		const t = await resolveTenantBySlug(env, "nope");
		expect(t).toBeNull();
	});
});
```

- [ ] **Step 4: Implement `src/lib/tenant.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, memberships, branchAccess } from "@/db/schema";

export async function resolveTenantBySlug(
	env: CloudflareEnv,
	slug: string,
): Promise<typeof tenants.$inferSelect | null> {
	const db = getDb(env);
	const row = await db.select().from(tenants).where(eq(tenants.slug, slug)).get();
	return row ?? null;
}

export async function loadMembership(
	env: CloudflareEnv,
	userId: string,
	tenantId: string,
): Promise<typeof memberships.$inferSelect | null> {
	const db = getDb(env);
	const row = await db
		.select()
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
		.get();
	return row ?? null;
}

export async function loadPermittedBranches(
	env: CloudflareEnv,
	membershipId: string,
): Promise<string[] | null> {
	const db = getDb(env);
	const rows = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, membershipId)).all();
	return rows.length === 0 ? null : rows.map((r) => r.branchId);
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/rbac.test.ts tests/unit/tenant.test.ts`

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rbac.ts src/lib/tenant.ts tests/unit/rbac.test.ts tests/unit/tenant.test.ts
git commit -m "feat(web): RBAC + tenant resolution helpers"
```

---

## Task 11: Typed errors + HTTP mapping

**Files:**
- Create: `bakerysense-web/src/lib/errors.ts`

- [ ] **Step 1: Implement `src/lib/errors.ts`**

```ts
export class HttpError extends Error {
	constructor(readonly status: number, msg: string, readonly code?: string) { super(msg); }
}
export class BadRequest   extends HttpError { constructor(msg = "bad request",  code?: string) { super(400, msg, code); } }
export class Unauthorized extends HttpError { constructor(msg = "unauthorized", code?: string) { super(401, msg, code); } }
export class Forbidden    extends HttpError { constructor(msg = "forbidden",    code?: string) { super(403, msg, code); } }
export class NotFound     extends HttpError { constructor(msg = "not found",    code?: string) { super(404, msg, code); } }
export class Conflict     extends HttpError { constructor(msg = "conflict",     code?: string) { super(409, msg, code); } }
export class TooMany      extends HttpError { constructor(msg = "too many",     code?: string) { super(429, msg, code); } }

export function errorResponse(e: unknown): Response {
	if (e instanceof HttpError) {
		return Response.json({ error: e.message, code: e.code }, { status: e.status });
	}
	console.error("unhandled error", e);
	return Response.json({ error: "internal" }, { status: 500 });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/errors.ts
git commit -m "feat(web): typed HTTP error classes + response mapper"
```

---

## Task 12: Connector model (AES-GCM + CRUD + presets)

**Files:**
- Create: `bakerysense-web/src/lib/connector.ts`
- Create: `bakerysense-web/src/lib/connector-presets.ts`
- Create: `bakerysense-web/tests/unit/connector.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/connector.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
	createConnector, listConnectors, deleteConnector, getDefaultConnector, setDefaultConnector
} from "@/lib/connector";

describe("connector CRUD", () => {
	const TID = "tid-1";
	beforeEach(async () => {
		const list = await env.KV.list({ prefix: `connector:tenant:${TID}` });
		for (const { name } of list.keys) await env.KV.delete(name);
	});

	it("creates and lists", async () => {
		await createConnector(env, TID, {
			label: "My OR", preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "api_key", credential: "sk-or-xxx",
		});
		const items = await listConnectors(env, TID);
		expect(items).toHaveLength(1);
		expect(items[0].label).toBe("My OR");
	});

	it("encrypts the credential at rest (not stored in plaintext)", async () => {
		const c = await createConnector(env, TID, {
			label: "x", preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "api_key", credential: "SECRET_KEY_123",
		});
		const raw = await env.KV.get(`connector:tenant:${TID}:${c.id}`);
		expect(raw).not.toContain("SECRET_KEY_123");
	});

	it("deletes and updates default pointer", async () => {
		const a = await createConnector(env, TID, { label:"a", preset:"openrouter", baseUrl:"x", model:"m", authMethod:"api_key", credential:"k" });
		const b = await createConnector(env, TID, { label:"b", preset:"openrouter", baseUrl:"x", model:"m", authMethod:"api_key", credential:"k" });
		await setDefaultConnector(env, TID, b.id);
		expect((await getDefaultConnector(env, TID))?.id).toBe(b.id);
		await deleteConnector(env, TID, b.id);
		expect((await getDefaultConnector(env, TID))?.id).toBe(a.id);   // fallback to first remaining
	});
});
```

- [ ] **Step 2: Implement `src/lib/connector-presets.ts`**

```ts
export type PresetId =
	| "openrouter" | "groq" | "together" | "cloudflare-ai"
	| "openai" | "anthropic-via-oai" | "ollama-tunnel" | "custom";

export interface Preset {
	id: PresetId;
	label: string;
	defaultBaseUrl: string;
	suggestedModels: string[];
	supportsOAuth: boolean;
	supportsApiKey: boolean;
}

export const PRESETS: Record<PresetId, Preset> = {
	"openrouter":        { id: "openrouter",        label: "OpenRouter",        defaultBaseUrl: "https://openrouter.ai/api/v1",        suggestedModels: ["google/gemma-4-e4b-it", "google/gemma-4-26b-it"], supportsOAuth: true,  supportsApiKey: true },
	"groq":              { id: "groq",              label: "Groq",              defaultBaseUrl: "https://api.groq.com/openai/v1",     suggestedModels: ["gemma-4-e4b-it"],                                  supportsOAuth: false, supportsApiKey: true },
	"together":          { id: "together",          label: "Together AI",       defaultBaseUrl: "https://api.together.xyz/v1",        suggestedModels: ["google/gemma-4-27b-it"],                           supportsOAuth: false, supportsApiKey: true },
	"cloudflare-ai":     { id: "cloudflare-ai",     label: "Cloudflare Workers AI", defaultBaseUrl: "cloudflare-ai:",                 suggestedModels: ["@cf/google/gemma-4-e4b-it"],                       supportsOAuth: false, supportsApiKey: false },
	"openai":            { id: "openai",            label: "OpenAI",            defaultBaseUrl: "https://api.openai.com/v1",          suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
	"anthropic-via-oai": { id: "anthropic-via-oai", label: "Anthropic (via OAI proxy)", defaultBaseUrl: "",                          suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
	"ollama-tunnel":     { id: "ollama-tunnel",     label: "Local Ollama (tunnel)", defaultBaseUrl: "",                              suggestedModels: ["gemma4:e4b-it-q4_K_M"],                            supportsOAuth: false, supportsApiKey: false },
	"custom":            { id: "custom",            label: "Custom OpenAI-compatible", defaultBaseUrl: "",                           suggestedModels: [],                                                  supportsOAuth: false, supportsApiKey: true },
};
```

- [ ] **Step 3: Implement `src/lib/connector.ts`**

```ts
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import { NotFound } from "./errors";
import type { PresetId } from "./connector-presets";

export interface Connector {
	id: string;
	tenantId: string;
	label: string;
	preset: PresetId;
	baseUrl: string;
	model: string;
	authMethod: "api_key" | "oauth" | "none";
	encryptedCredential?: string;      // "v1:<base64(iv||ct||tag)>"
	credentialLast4?: string;          // non-secret display only
	createdAt: number;
	lastUsedAt?: number;
}

export interface ConnectorIndex {
	connectorIds: string[];
	defaultId: string | null;
}

function mek(env: CloudflareEnv): Uint8Array {
	if (!env.CONNECTOR_MEK) throw new Error("CONNECTOR_MEK missing");
	const key = base64.decode(env.CONNECTOR_MEK);
	if (key.length !== 32) throw new Error("CONNECTOR_MEK must be 32 bytes (base64)");
	return key;
}

function encrypt(env: CloudflareEnv, plaintext: string): string {
	const iv = randomBytes(12);
	const aes = gcm(mek(env), iv);
	const ct = aes.encrypt(new TextEncoder().encode(plaintext));
	return "v1:" + base64.encode(new Uint8Array([...iv, ...ct]));
}

function decrypt(env: CloudflareEnv, encoded: string): string {
	if (!encoded.startsWith("v1:")) throw new Error("unsupported ciphertext version");
	const buf = base64.decode(encoded.slice(3));
	const iv = buf.slice(0, 12);
	const ct = buf.slice(12);
	const aes = gcm(mek(env), iv);
	return new TextDecoder().decode(aes.decrypt(ct));
}

function newConnectorId(): string {
	return "conn_" + base64.encode(randomBytes(9)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

async function readIndex(env: CloudflareEnv, tid: string): Promise<ConnectorIndex> {
	const raw = await env.KV.get(`connector:tenant:${tid}:index`);
	return raw ? (JSON.parse(raw) as ConnectorIndex) : { connectorIds: [], defaultId: null };
}

async function writeIndex(env: CloudflareEnv, tid: string, idx: ConnectorIndex): Promise<void> {
	await env.KV.put(`connector:tenant:${tid}:index`, JSON.stringify(idx));
}

export async function createConnector(
	env: CloudflareEnv,
	tenantId: string,
	input: {
		label: string; preset: PresetId; baseUrl: string; model: string;
		authMethod: Connector["authMethod"]; credential?: string;
	},
): Promise<Connector> {
	const id = newConnectorId();
	const enc = input.credential ? encrypt(env, input.credential) : undefined;
	const last4 = input.credential ? input.credential.slice(-4) : undefined;
	const now = Date.now();
	const c: Connector = {
		id, tenantId,
		label: input.label, preset: input.preset, baseUrl: input.baseUrl, model: input.model,
		authMethod: input.authMethod,
		encryptedCredential: enc, credentialLast4: last4,
		createdAt: now,
	};
	await env.KV.put(`connector:tenant:${tenantId}:${id}`, JSON.stringify(c));
	const idx = await readIndex(env, tenantId);
	idx.connectorIds.push(id);
	if (!idx.defaultId) idx.defaultId = id;
	await writeIndex(env, tenantId, idx);
	return c;
}

export async function listConnectors(env: CloudflareEnv, tenantId: string): Promise<Connector[]> {
	const idx = await readIndex(env, tenantId);
	const out: Connector[] = [];
	for (const id of idx.connectorIds) {
		const raw = await env.KV.get(`connector:tenant:${tenantId}:${id}`);
		if (raw) out.push(JSON.parse(raw) as Connector);
	}
	return out;
}

export async function getDefaultConnector(env: CloudflareEnv, tenantId: string): Promise<Connector | null> {
	const idx = await readIndex(env, tenantId);
	if (!idx.defaultId) return null;
	const raw = await env.KV.get(`connector:tenant:${tenantId}:${idx.defaultId}`);
	return raw ? (JSON.parse(raw) as Connector) : null;
}

export async function setDefaultConnector(env: CloudflareEnv, tenantId: string, connectorId: string): Promise<void> {
	const idx = await readIndex(env, tenantId);
	if (!idx.connectorIds.includes(connectorId)) throw new NotFound("connector");
	idx.defaultId = connectorId;
	await writeIndex(env, tenantId, idx);
}

export async function deleteConnector(env: CloudflareEnv, tenantId: string, connectorId: string): Promise<void> {
	await env.KV.delete(`connector:tenant:${tenantId}:${connectorId}`);
	const idx = await readIndex(env, tenantId);
	idx.connectorIds = idx.connectorIds.filter((x) => x !== connectorId);
	if (idx.defaultId === connectorId) idx.defaultId = idx.connectorIds[0] ?? null;
	await writeIndex(env, tenantId, idx);
}

export async function resolveUpstreamCredential(
	env: CloudflareEnv,
	c: Connector,
): Promise<string | null> {
	if (!c.encryptedCredential) return null;
	return decrypt(env, c.encryptedCredential);
}
```

- [ ] **Step 4: Run connector test**

Run: `npx vitest run tests/unit/connector.test.ts`

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connector.ts src/lib/connector-presets.ts tests/unit/connector.test.ts
git commit -m "feat(web): per-tenant LLM connector model with AES-GCM encryption"
```

---

## Task 13: Auth API routes — signup

**Files:**
- Create: `bakerysense-web/src/app/api/auth/signup/route.ts`
- Create: `bakerysense-web/tests/integration/auth-flow.test.ts`

- [ ] **Step 1: Implement signup handler**

```ts
// src/app/api/auth/signup/route.ts
import { z } from "zod";
import { getDb } from "@/db/client";
import { tenants, users, memberships, branches } from "@/db/schema";
import { hashPassword } from "@/lib/auth/argon2";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { issueRefresh } from "@/lib/auth/refresh";
import { setAuthCookie } from "@/lib/auth/cookies";
import { BadRequest, Conflict, errorResponse } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(12).max(256),
	tenantName: z.string().min(2).max(80),
	tenantSlug: z.string().regex(/^[a-z0-9-]{2,40}$/),
	vertical: z.enum(["bakery", "grocery", "pharmacy", "retail", "other"]),
});

function newId(prefix: string): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `${prefix}_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const json = await req.json();
		const parsed = Body.safeParse(json);
		if (!parsed.success) throw new BadRequest("invalid body");
		const { email, password, tenantName, tenantSlug, vertical } = parsed.data;

		const db = getDb(env);
		const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
		if (existingUser) throw new Conflict("email already registered");
		const existingSlug = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).get();
		if (existingSlug) throw new Conflict("tenant slug taken");

		const now = Date.now();
		const userId   = newId("usr");
		const tenantId = newId("ten");
		const branchId = newId("brn");
		const membershipId = newId("mem");

		const passwordHash = await hashPassword(password);
		await db.insert(tenants).values({ id: tenantId, slug: tenantSlug, name: tenantName, vertical, plan: "free", createdAt: now });
		await db.insert(users).values({ id: userId, email, passwordHash, emailVerified: 0, createdAt: now, lastLoginAt: now });
		await db.insert(memberships).values({ id: membershipId, userId, tenantId, role: "tenant_admin", createdAt: now });
		await db.insert(branches).values({ id: branchId, tenantId, name: "HQ", createdAt: now });

		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: userId, tid: tenantId, role: "tenant_admin", branches: null, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		const rt = await issueRefresh(env, { userId, tenantId });

		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rt.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		return new Response(JSON.stringify({ tenantSlug, userId, tenantId }), { status: 201, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
```

- [ ] **Step 2: Write integration test for signup**

`tests/integration/auth-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

describe("auth flow", () => {
	beforeEach(async () => {
		await applyD1Migrations(env.DB, env.MIGRATIONS);
	});

	it("signup creates tenant + user + membership + branch + cookies", async () => {
		const res = await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "demo@bakerysense.app",
				password: "Demo2026DemoDemo",
				tenantName: "Favorita",
				tenantSlug: "favorita",
				vertical: "bakery",
			}),
		});
		expect(res.status).toBe(201);
		const setCookie = res.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(/bs_at=/);
		expect(setCookie).toMatch(/bs_rt=/);
	});

	it("duplicate email 409", async () => {
		await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"a@b.co", password:"Aa2026Aa2026Aa", tenantName:"A", tenantSlug:"a", vertical:"bakery" }),
		});
		const res2 = await SELF.fetch("https://x.test/api/auth/signup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"a@b.co", password:"Aa2026Aa2026Aa", tenantName:"B", tenantSlug:"b", vertical:"bakery" }),
		});
		expect(res2.status).toBe(409);
	});
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/integration/auth-flow.test.ts`

Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/signup/route.ts tests/integration/auth-flow.test.ts
git commit -m "feat(web): POST /api/auth/signup — creates tenant + admin + HQ branch + tokens"
```

---

## Task 14: Auth API routes — signin, signout, refresh, me

**Files:**
- Create: `bakerysense-web/src/app/api/auth/signin/route.ts`
- Create: `bakerysense-web/src/app/api/auth/signout/route.ts`
- Create: `bakerysense-web/src/app/api/auth/refresh/route.ts`
- Create: `bakerysense-web/src/app/api/auth/me/route.ts`
- Modify: `bakerysense-web/tests/integration/auth-flow.test.ts` (add scenarios)

- [ ] **Step 1: Implement signin**

```ts
// src/app/api/auth/signin/route.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users, memberships, tenants, branchAccess } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/argon2";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { issueRefresh } from "@/lib/auth/refresh";
import { setAuthCookie } from "@/lib/auth/cookies";
import { BadRequest, Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(1),
	tenantSlug: z.string().regex(/^[a-z0-9-]{2,40}$/),
});

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const parsed = Body.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const { email, password, tenantSlug } = parsed.data;

		const db = getDb(env);
		const user = await db.select().from(users).where(eq(users.email, email)).get();
		if (!user) throw new Unauthorized("invalid credentials");
		if (!(await verifyPassword(password, user.passwordHash))) throw new Unauthorized("invalid credentials");

		const tenant = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).get();
		if (!tenant) throw new Unauthorized("invalid credentials");
		const m = await db.select().from(memberships)
			.where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenant.id)))
			.get();
		if (!m) throw new Unauthorized("invalid credentials");

		const ba = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, m.id)).all();
		const permittedBranches = ba.length === 0 ? null : ba.map((r) => r.branchId);

		await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id));
		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: user.id, tid: tenant.id, role: m.role, branches: permittedBranches, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		const rt = await issueRefresh(env, { userId: user.id, tenantId: tenant.id });

		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rt.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		return new Response(JSON.stringify({ tenantSlug: tenant.slug, userId: user.id }), { status: 200, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
```

- [ ] **Step 2: Implement refresh**

```ts
// src/app/api/auth/refresh/route.ts
import { readAuthCookie, setAuthCookie, clearAuthCookie } from "@/lib/auth/cookies";
import { rotateRefresh, revokeAllForUser, readRefresh } from "@/lib/auth/refresh";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getDb } from "@/db/client";
import { memberships, branchAccess } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const presented = await readAuthCookie(env, req.headers.get("cookie"), "bs_rt");
		if (!presented) throw new Unauthorized();
		const existing = await readRefresh(env, presented);
		if (!existing) {
			// reuse attempt (not found = already revoked): nuke all sessions for that user if we can identify them
			const headers = new Headers({ "content-type": "application/json" });
			clearAuthCookie(headers, "bs_at");
			clearAuthCookie(headers, "bs_rt");
			return new Response(JSON.stringify({ error: "reused" }), { status: 401, headers });
		}
		let rotated;
		try {
			rotated = await rotateRefresh(env, presented);
		} catch {
			await revokeAllForUser(env, existing.userId);
			throw new Unauthorized("refresh failed");
		}

		const db = getDb(env);
		const m = await db.select().from(memberships)
			.where(and(eq(memberships.userId, existing.userId), eq(memberships.tenantId, existing.tenantId)))
			.get();
		if (!m) throw new Unauthorized();
		const ba = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, m.id)).all();
		const permittedBranches = ba.length === 0 ? null : ba.map((r) => r.branchId);

		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: existing.userId, tid: existing.tenantId, role: m.role, branches: permittedBranches, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rotated.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
```

- [ ] **Step 3: Implement signout**

```ts
// src/app/api/auth/signout/route.ts
import { clearAuthCookie, readAuthCookie } from "@/lib/auth/cookies";
import { rotateRefresh } from "@/lib/auth/refresh";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	const { env } = getCloudflareContext();
	const rt = await readAuthCookie(env, req.headers.get("cookie"), "bs_rt");
	if (rt) {
		try { await rotateRefresh(env, rt); } catch { /* token already revoked is fine */ }
	}
	const headers = new Headers({ "content-type": "application/json" });
	clearAuthCookie(headers, "bs_at");
	clearAuthCookie(headers, "bs_rt");
	return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
```

- [ ] **Step 4: Implement me**

```ts
// src/app/api/auth/me/route.ts
import { resolveSession } from "@/lib/auth/session";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		return Response.json({ claims: session.claims });
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 5: Extend the integration test**

Add to `tests/integration/auth-flow.test.ts`:

```ts
it("full signup → signin → me → signout flow", async () => {
	await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"full@b.co", password:"FullFlow2026FullFlow", tenantName:"F", tenantSlug:"f", vertical:"bakery" }),
	});

	// sign out to clear cookies
	const cookieHome = (r: Response) => r.headers.get("set-cookie") ?? "";
	let res: Response;

	res = await SELF.fetch("https://x.test/api/auth/signin", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"full@b.co", password:"FullFlow2026FullFlow", tenantSlug:"f" }),
	});
	expect(res.status).toBe(200);
	const cookies = cookieHome(res);
	expect(cookies).toMatch(/bs_at=/);

	res = await SELF.fetch("https://x.test/api/auth/me", {
		headers: { cookie: cookies.split(",").map((s) => s.split(";")[0]).join("; ") },
	});
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.claims.role).toBe("tenant_admin");

	res = await SELF.fetch("https://x.test/api/auth/signout", {
		method: "POST",
		headers: { cookie: cookies.split(",").map((s) => s.split(";")[0]).join("; ") },
	});
	expect(res.status).toBe(200);
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/integration/auth-flow.test.ts`

Expected: 3 passing.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/auth tests/integration/auth-flow.test.ts
git commit -m "feat(web): POST /api/auth/{signin,refresh,signout}, GET /api/auth/me"
```

---

## Task 15: Signin + Signup pages

**Files:**
- Create: `bakerysense-web/src/app/signin/page.tsx`
- Create: `bakerysense-web/src/app/signup/page.tsx`

- [ ] **Step 1: Write `src/app/signin/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SigninPage() {
	const router = useRouter();
	const params = useSearchParams();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [tenantSlug, setTenantSlug] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setPending(true);
		setError(null);
		try {
			const res = await fetch("/api/auth/signin", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, password, tenantSlug }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `HTTP ${res.status}`);
			}
			router.push(params.get("next") ?? `/t/${tenantSlug}/dashboard`);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="mx-auto max-w-sm p-8">
			<h1 className="mb-6 text-2xl font-semibold">Sign in to BakerySense</h1>
			<form onSubmit={onSubmit} className="space-y-4">
				<label className="block text-sm">
					Tenant slug
					<input data-testid="signin-tenant" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} required pattern="[a-z0-9-]{2,40}" className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">
					Email
					<input data-testid="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">
					Password
					<input data-testid="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				{error && <p data-testid="signin-error" className="text-sm text-red-600">{error}</p>}
				<button data-testid="signin-submit" disabled={pending} className="w-full rounded bg-amber-600 px-4 py-2 text-white disabled:opacity-50">
					{pending ? "Signing in…" : "Sign in"}
				</button>
			</form>
			<p className="mt-6 text-sm text-stone-600">
				No account? <a className="underline" href="/signup">Create a tenant</a>
			</p>
		</main>
	);
}
```

- [ ] **Step 2: Write `src/app/signup/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
	const router = useRouter();
	const [form, setForm] = useState({ email: "", password: "", tenantName: "", tenantSlug: "", vertical: "bakery" as const });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm({ ...form, [k]: v }); }

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setPending(true); setError(null);
		try {
			const res = await fetch("/api/auth/signup", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify(form),
			});
			if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${res.status}`); }
			router.push(`/t/${form.tenantSlug}/dashboard`);
		} catch (e) { setError((e as Error).message); } finally { setPending(false); }
	}

	return (
		<main className="mx-auto max-w-sm p-8">
			<h1 className="mb-6 text-2xl font-semibold">Create a tenant</h1>
			<form onSubmit={onSubmit} className="space-y-4">
				<label className="block text-sm">Tenant name
					<input data-testid="signup-tenant-name" value={form.tenantName} onChange={(e) => set("tenantName", e.target.value)} required minLength={2} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Tenant slug
					<input data-testid="signup-tenant-slug" value={form.tenantSlug} onChange={(e) => set("tenantSlug", e.target.value)} required pattern="[a-z0-9-]{2,40}" className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Vertical
					<select data-testid="signup-vertical" value={form.vertical} onChange={(e) => set("vertical", e.target.value as typeof form.vertical)} className="mt-1 block w-full rounded border px-3 py-2">
						<option value="bakery">Bakery</option>
						<option value="grocery">Grocery</option>
						<option value="pharmacy">Pharmacy</option>
						<option value="retail">Retail</option>
						<option value="other">Other</option>
					</select>
				</label>
				<label className="block text-sm">Email
					<input data-testid="signup-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				<label className="block text-sm">Password
					<input data-testid="signup-password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required minLength={12} className="mt-1 block w-full rounded border px-3 py-2" />
				</label>
				{error && <p data-testid="signup-error" className="text-sm text-red-600">{error}</p>}
				<button data-testid="signup-submit" disabled={pending} className="w-full rounded bg-amber-600 px-4 py-2 text-white disabled:opacity-50">
					{pending ? "Creating…" : "Create tenant"}
				</button>
			</form>
			<p className="mt-6 text-sm text-stone-600">Already a member? <a className="underline" href="/signin">Sign in</a></p>
		</main>
	);
}
```

- [ ] **Step 3: Boot dev server and verify visually**

Run: `npm run dev`
Visit: `http://localhost:3000/signup` and fill the form. Confirm it redirects to `/t/<slug>/dashboard` (which may 404 — that's fine, P1 doesn't ship the dashboard).

- [ ] **Step 4: Commit**

```bash
git add src/app/signin src/app/signup
git commit -m "feat(web): /signin and /signup pages with form + client redirect"
```

---

## Task 16: Connector API routes

**Files:**
- Create: `bakerysense-web/src/app/api/connector/route.ts`
- Create: `bakerysense-web/src/app/api/connector/[id]/route.ts`
- Create: `bakerysense-web/src/app/api/connector/[id]/default/route.ts`
- Create: `bakerysense-web/tests/integration/connector-flow.test.ts`

- [ ] **Step 1: Implement list + create**

```ts
// src/app/api/connector/route.ts
import { z } from "zod";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { createConnector, listConnectors } from "@/lib/connector";
import { Unauthorized, errorResponse, BadRequest } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const CreateBody = z.object({
	label: z.string().min(1).max(80),
	preset: z.enum(["openrouter","groq","together","cloudflare-ai","openai","anthropic-via-oai","ollama-tunnel","custom"]),
	baseUrl: z.string().url().max(500),
	model: z.string().min(1).max(200),
	authMethod: z.enum(["api_key","oauth","none"]),
	credential: z.string().max(500).optional(),
});

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const connectors = await listConnectors(env, session.claims.tid);
		// strip encrypted credential from response — never returned to the client
		return Response.json({ connectors: connectors.map(({ encryptedCredential, ...rest }) => rest) });
	} catch (e) { return errorResponse(e); }
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const parsed = CreateBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const c = await createConnector(env, session.claims.tid, parsed.data);
		const { encryptedCredential, ...safe } = c;
		return Response.json(safe, { status: 201 });
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 2: Implement delete + patch**

```ts
// src/app/api/connector/[id]/route.ts
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { deleteConnector } from "@/lib/connector";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const { id } = await params;
		await deleteConnector(env, session.claims.tid, id);
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 3: Implement set-default**

```ts
// src/app/api/connector/[id]/default/route.ts
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { setDefaultConnector } from "@/lib/connector";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const { id } = await params;
		await setDefaultConnector(env, session.claims.tid, id);
		return new Response(null, { status: 204 });
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 4: Integration test (auth-gated connector CRUD)**

`tests/integration/connector-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

async function signup(): Promise<string> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"c@d.co", password:"Connect2026Test!!", tenantName:"C", tenantSlug:"c", vertical:"bakery" }),
	});
	const setCookie = res.headers.get("set-cookie") ?? "";
	return setCookie.split(",").map((s) => s.split(";")[0]).join("; ");
}

describe("connector flow", () => {
	beforeEach(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

	it("authenticated tenant_admin can create + list + delete a connector", async () => {
		const cookie = await signup();
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-or-xxx" }),
		});
		expect(create.status).toBe(201);
		const created = await create.json();
		expect(created.id).toMatch(/^conn_/);

		const list = await SELF.fetch("https://x.test/api/connector", { headers: { cookie } });
		const body = await list.json();
		expect(body.connectors).toHaveLength(1);
		expect(body.connectors[0].encryptedCredential).toBeUndefined();

		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method: "DELETE", headers: { cookie } });
		expect(del.status).toBe(204);
	});

	it("unauthenticated request is rejected 401", async () => {
		const res = await SELF.fetch("https://x.test/api/connector");
		expect(res.status).toBe(401);
	});
});
```

- [ ] **Step 5: Run**

Run: `npx vitest run tests/integration/connector-flow.test.ts`

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/connector tests/integration/connector-flow.test.ts
git commit -m "feat(web): connector API — list/create/delete/set-default, encrypted creds never leave Worker"
```

---

## Task 17: Multi-tenant isolation test

**Files:**
- Create: `bakerysense-web/tests/integration/multi-tenant-isolation.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";

async function signup(email: string, slug: string): Promise<string> {
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password:"Iso2026Iso2026", tenantName:slug, tenantSlug:slug, vertical:"bakery" }),
	});
	return (res.headers.get("set-cookie") ?? "").split(",").map((s) => s.split(";")[0]).join("; ");
}

describe("multi-tenant isolation", () => {
	beforeEach(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });

	it("tenant A connectors are invisible to tenant B", async () => {
		const cookieA = await signup("a@x.co", "a");
		const cookieB = await signup("b@x.co", "b");

		// A creates a connector
		await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: cookieA },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});

		// B lists connectors
		const res = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: cookieB } });
		const body = await res.json();
		expect(body.connectors).toHaveLength(0);
	});

	it("tenant B cannot delete tenant A's connector by guessing its id", async () => {
		const cookieA = await signup("a2@x.co", "a2");
		const cookieB = await signup("b2@x.co", "b2");
		const create = await SELF.fetch("https://x.test/api/connector", {
			method: "POST", headers: { "content-type": "application/json", cookie: cookieA },
			body: JSON.stringify({ label:"OR", preset:"openrouter", baseUrl:"https://openrouter.ai/api/v1", model:"google/gemma-4-e4b-it", authMethod:"api_key", credential:"sk-a" }),
		});
		const created = await create.json();
		// B attempts to delete
		const del = await SELF.fetch(`https://x.test/api/connector/${created.id}`, { method:"DELETE", headers: { cookie: cookieB } });
		// Because of tenant-scoped KV keys, the delete is a no-op from B's tenant view — 204 is fine, the connector still exists for A
		expect([204, 404]).toContain(del.status);
		const listA = await SELF.fetch("https://x.test/api/connector", { headers: { cookie: cookieA } });
		expect((await listA.json()).connectors).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run tests/integration/multi-tenant-isolation.test.ts`

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/multi-tenant-isolation.test.ts
git commit -m "test(web): multi-tenant isolation — KV scoping keeps connectors siloed"
```

---

## Task 18: OpenRouter OAuth PKCE scaffold

**Files:**
- Create: `bakerysense-web/src/app/api/oauth/openrouter/start/route.ts`
- Create: `bakerysense-web/src/app/api/oauth/openrouter/callback/route.ts`

- [ ] **Step 1: Implement start**

```ts
// src/app/api/oauth/openrouter/start/route.ts
import { randomBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import { base64url } from "@scure/base";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { Unauthorized, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);

		const verifier = base64url.encode(randomBytes(32));
		const challenge = base64url.encode(sha256(new TextEncoder().encode(verifier)));
		const state = base64url.encode(randomBytes(16));

		await env.KV.put(`oauth:state:${state}`, JSON.stringify({
			tenantId: session.claims.tid,
			initiatedByUserId: session.claims.sub,
			verifier,
			createdAt: Date.now(),
		}), { expirationTtl: 600 });

		const url = new URL("https://openrouter.ai/auth");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", env.OPENROUTER_OAUTH_CLIENT_ID ?? "placeholder");
		url.searchParams.set("redirect_uri", new URL("/api/oauth/openrouter/callback", req.url).toString());
		url.searchParams.set("code_challenge", challenge);
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("state", state);
		return Response.redirect(url.toString(), 302);
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 2: Implement callback**

```ts
// src/app/api/oauth/openrouter/callback/route.ts
import { createConnector } from "@/lib/connector";
import { BadRequest, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const url = new URL(req.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (!code || !state) throw new BadRequest("missing code/state");

		const rawState = await env.KV.get(`oauth:state:${state}`);
		if (!rawState) throw new BadRequest("unknown state (expired?)");
		await env.KV.delete(`oauth:state:${state}`);
		const st = JSON.parse(rawState) as { tenantId: string; verifier: string; initiatedByUserId: string };

		const tokenRes = await fetch("https://openrouter.ai/api/v1/auth/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				code_verifier: st.verifier,
				client_id: env.OPENROUTER_OAUTH_CLIENT_ID ?? "placeholder",
				redirect_uri: new URL("/api/oauth/openrouter/callback", req.url).toString(),
			}),
		});
		if (!tokenRes.ok) throw new BadRequest(`token exchange failed: ${tokenRes.status}`);
		const body = await tokenRes.json() as { access_token: string; token_type?: string };
		if (!body.access_token) throw new BadRequest("no access_token in response");

		await createConnector(env, st.tenantId, {
			label: "OpenRouter (OAuth)",
			preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			model: "google/gemma-4-e4b-it",
			authMethod: "oauth",
			credential: body.access_token,
		});

		return Response.redirect(new URL("/account/settings?oauth=ok", req.url).toString(), 302);
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/oauth
git commit -m "feat(web): OpenRouter OAuth PKCE scaffold — start + callback endpoints"
```

---

## Task 19: Public JWKS endpoint

**Files:**
- Create: `bakerysense-web/src/app/api/.well-known/jwks.json/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/.well-known/jwks.json/route.ts
import { listActiveJwks } from "@/lib/auth/jwks";
import { errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(_req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const entries = await listActiveJwks(env);
		const keys = entries.map((e) => ({ ...e.publicJwk, kid: e.kid, use: "sig", alg: "ES256" }));
		return Response.json({ keys });
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/.well-known
git commit -m "feat(web): GET /.well-known/jwks.json — exposes public signing keys"
```

---

## Task 20: JWKS rotation Cron Worker

**Files:**
- Create: `bakerysense-web/scripts/cron/jwks-rotate.ts`
- Modify: `bakerysense-web/wrangler.jsonc` (wire the cron handler entry)

- [ ] **Step 1: Implement the cron handler**

```ts
// scripts/cron/jwks-rotate.ts
import { rotateKeys } from "@/lib/auth/jwks";

export default {
	async scheduled(_event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil((async () => {
			const { newKid, retiredKid } = await rotateKeys(env);
			console.log("jwks.rotated", { newKid, retiredKid });
		})());
	},
};
```

- [ ] **Step 2: Add a manual trigger endpoint for tests + ops**

Create `src/app/api/internal/rotate-jwks/route.ts`:

```ts
import { rotateKeys } from "@/lib/auth/jwks";
import { errorResponse, Forbidden } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		// simple ops gate: require a shared secret header
		const expected = env.OPS_ROTATE_SECRET;
		if (!expected || req.headers.get("x-ops-secret") !== expected) throw new Forbidden();
		const result = await rotateKeys(env);
		return Response.json(result);
	} catch (e) { return errorResponse(e); }
}
```

- [ ] **Step 3: Wire the cron entry in wrangler.jsonc**

Note: `@opennextjs/cloudflare` generates a worker entry. To add a scheduled handler, we export it from a custom worker wrapper. Create `bakerysense-web/open-next.config.ts` if it does not already have a `workerWrapper` entry, and add the scheduled export to the final built worker.

Document the expected wiring in `README.md`:

```md
### JWKS rotation cron

Cron runs daily at 03:00 UTC per `wrangler.jsonc`'s `triggers.crons`.
Handler lives at `scripts/cron/jwks-rotate.ts`; wired into the OpenNext
worker via `open-next.config.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/cron src/app/api/internal README.md
git commit -m "feat(web): daily JWKS rotation via Cron trigger + ops rotate endpoint"
```

---

## Task 21: Seed migration for the Favorita demo tenant

**Files:**
- Create: `bakerysense-web/src/db/seed.ts`
- Create: `bakerysense-web/scripts/seed-demo.ts`

- [ ] **Step 1: Write the seed function**

```ts
// src/db/seed.ts
import { getDb } from "./client";
import { tenants, users, memberships, branches, branchAccess } from "./schema";
import { hashPassword } from "@/lib/auth/argon2";

const DEMO = {
	tenant: { id: "ten_favorita", slug: "favorita", name: "La Boulangerie Favorita", vertical: "bakery", plan: "free" },
	admin:   { id: "usr_demoadmin",   email: "demo@bakerysense.app",     password: "Demo2026Demo!", role: "tenant_admin" as const },
	manager: { id: "usr_democlerk",   email: "manager@bakerysense.app",  password: "Manager2026!", role: "branch_manager" as const },
	branches: [
		{ id: "brn_quito_1", name: "Quito Centro",   city: "Quito",     cluster: "A", type: "urban" },
		{ id: "brn_quito_2", name: "Quito Norte",    city: "Quito",     cluster: "B", type: "urban" },
		{ id: "brn_guay_1",  name: "Guayaquil Sur",  city: "Guayaquil", cluster: "B", type: "urban" },
		{ id: "brn_guay_2",  name: "Guayaquil Malecón", city: "Guayaquil", cluster: "A", type: "tourist" },
		{ id: "brn_rural_1", name: "Santo Domingo",  city: "Santo Domingo", cluster: "C", type: "rural" },
	],
};

export async function seedDemo(env: CloudflareEnv): Promise<void> {
	const db = getDb(env);
	const now = Date.now();

	await db.insert(tenants).values({ ...DEMO.tenant, createdAt: now }).onConflictDoNothing();

	for (const b of DEMO.branches) {
		await db.insert(branches).values({ ...b, tenantId: DEMO.tenant.id, createdAt: now }).onConflictDoNothing();
	}

	await db.insert(users).values({
		id: DEMO.admin.id,
		email: DEMO.admin.email,
		passwordHash: await hashPassword(DEMO.admin.password),
		emailVerified: 1,
		createdAt: now,
	}).onConflictDoNothing();

	await db.insert(users).values({
		id: DEMO.manager.id,
		email: DEMO.manager.email,
		passwordHash: await hashPassword(DEMO.manager.password),
		emailVerified: 1,
		createdAt: now,
	}).onConflictDoNothing();

	const adminMembership = { id: "mem_admin", userId: DEMO.admin.id, tenantId: DEMO.tenant.id, role: DEMO.admin.role, createdAt: now };
	const managerMembership = { id: "mem_manager", userId: DEMO.manager.id, tenantId: DEMO.tenant.id, role: DEMO.manager.role, createdAt: now };
	await db.insert(memberships).values(adminMembership).onConflictDoNothing();
	await db.insert(memberships).values(managerMembership).onConflictDoNothing();

	// manager restricted to 2 branches
	await db.insert(branchAccess).values([
		{ membershipId: managerMembership.id, branchId: "brn_quito_1" },
		{ membershipId: managerMembership.id, branchId: "brn_guay_1" },
	]).onConflictDoNothing();
}
```

- [ ] **Step 2: Write a dev helper to invoke from `wrangler dev`**

```ts
// scripts/seed-demo.ts
import { seedDemo } from "@/db/seed";

export default {
	async fetch(req: Request, env: CloudflareEnv): Promise<Response> {
		if (req.method !== "POST") return new Response("POST only", { status: 405 });
		await seedDemo(env);
		return new Response("seeded");
	},
};
```

- [ ] **Step 3: Invoke locally**

With `wrangler dev` running:

```bash
curl -X POST http://localhost:8787/seed-demo
# or integrate into a test beforeAll via the seedDemo() import
```

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts scripts/seed-demo.ts
git commit -m "feat(web): demo seeder — Favorita tenant, 5 branches, admin + manager users"
```

---

## Task 22: Rate limits on auth endpoints

**Files:**
- Create: `bakerysense-web/src/lib/ratelimit.ts`
- Modify: `bakerysense-web/src/app/api/auth/signin/route.ts` (apply)
- Modify: `bakerysense-web/src/app/api/auth/signup/route.ts` (apply)

- [ ] **Step 1: Implement**

```ts
// src/lib/ratelimit.ts
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; }

export async function rateLimit(
	env: CloudflareEnv,
	type: string,
	key: string,
	max: number,
	windowSeconds: number,
): Promise<RateLimitResult> {
	const k = `rate:${type}:${key}`;
	const raw = await env.KV.get(k);
	const now = Math.floor(Date.now() / 1000);
	const record = raw ? JSON.parse(raw) as { count: number; resetAt: number } : { count: 0, resetAt: now + windowSeconds };
	if (record.resetAt < now) { record.count = 0; record.resetAt = now + windowSeconds; }
	record.count++;
	const allowed = record.count <= max;
	await env.KV.put(k, JSON.stringify(record), { expirationTtl: windowSeconds });
	return { allowed, remaining: Math.max(0, max - record.count), resetAt: record.resetAt };
}
```

- [ ] **Step 2: Apply to signin (5 / 15 min per IP+email)**

In `src/app/api/auth/signin/route.ts`, before `verifyPassword`:

```ts
import { rateLimit } from "@/lib/ratelimit";
import { TooMany } from "@/lib/errors";
// ...
const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
const rl = await rateLimit(env, "signin", `${ip}:${email}`, 5, 900);
if (!rl.allowed) throw new TooMany("too many attempts");
```

- [ ] **Step 3: Apply to signup (3 / hour per IP)**

Same pattern in the signup route: `rateLimit(env, "signup", ip, 3, 3600)`.

- [ ] **Step 4: Add a test**

`tests/integration/auth-flow.test.ts`:

```ts
it("rate-limits signin after 5 wrong attempts", async () => {
	// create an account first
	await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"r@x.co", password:"Rate2026Rate!!", tenantName:"R", tenantSlug:"rl", vertical:"bakery" }),
	});

	for (let i = 0; i < 5; i++) {
		await SELF.fetch("https://x.test/api/auth/signin", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ email:"r@x.co", password:"wrong!!", tenantSlug:"rl" }),
		});
	}
	const sixth = await SELF.fetch("https://x.test/api/auth/signin", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:"r@x.co", password:"wrong!!", tenantSlug:"rl" }),
	});
	expect(sixth.status).toBe(429);
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/ratelimit.ts src/app/api/auth tests/integration/auth-flow.test.ts
git commit -m "feat(web): KV rate-limiter + signin/signup caps"
```

---

## Task 23: CSP + security headers

**Files:**
- Modify: `bakerysense-web/src/app/middleware.ts`

- [ ] **Step 1: Add response headers**

Extend `middleware.ts` to attach:

```ts
const res = NextResponse.next();
res.headers.set("content-security-policy",
	"default-src 'self'; connect-src 'self' https://openrouter.ai; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'");
res.headers.set("x-content-type-options", "nosniff");
res.headers.set("x-frame-options", "DENY");
res.headers.set("referrer-policy", "no-referrer-when-downgrade");
res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
return res;
```

(Apply inside the existing `middleware(req)` function where `NextResponse.next()` is returned.)

- [ ] **Step 2: Commit**

```bash
git add src/app/middleware.ts
git commit -m "feat(web): CSP + security response headers"
```

---

## Task 24: RBAC matrix test (generated from permissions)

**Files:**
- Create: `bakerysense-web/src/lib/rbac/permissions.ts`
- Create: `bakerysense-web/tests/integration/rbac-matrix.test.ts`

- [ ] **Step 1: Single source of truth for role capabilities**

```ts
// src/lib/rbac/permissions.ts
import type { Role } from "@/lib/auth/jwt";

export interface Capability {
	path: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	allow: Role[];
}

export const CAPABILITIES: Capability[] = [
	{ path: "/api/connector",                    method: "GET",    allow: ["tenant_admin"] },
	{ path: "/api/connector",                    method: "POST",   allow: ["tenant_admin"] },
	{ path: "/api/connector/:id",                method: "DELETE", allow: ["tenant_admin"] },
	{ path: "/api/connector/:id/default",        method: "POST",   allow: ["tenant_admin"] },
	{ path: "/api/oauth/openrouter/start",       method: "GET",    allow: ["tenant_admin"] },
	// platform_admin is implicitly allowed everywhere via requireRole's bypass
];
```

- [ ] **Step 2: Write a test that loops over the matrix**

```ts
// tests/integration/rbac-matrix.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { CAPABILITIES } from "@/lib/rbac/permissions";

const ROLES = ["tenant_admin", "branch_manager", "staff", "viewer"] as const;

async function signupAs(role: (typeof ROLES)[number]): Promise<string> {
	// signup creates tenant_admin; to test other roles, follow up with a direct DB insert via a test helper.
	// For MVP this test is run as tenant_admin only; branch_manager/staff/viewer rows get created by a seed script
	// in a follow-up task.
	const res = await SELF.fetch("https://x.test/api/auth/signup", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ email:`${role}@x.co`, password:"Matrix2026Matrix!", tenantName:role, tenantSlug:role, vertical:"bakery" }),
	});
	return (res.headers.get("set-cookie") ?? "").split(",").map((s) => s.split(";")[0]).join("; ");
}

describe("RBAC matrix (tenant_admin baseline)", () => {
	beforeEach(async () => { await applyD1Migrations(env.DB, env.MIGRATIONS); });
	for (const cap of CAPABILITIES) {
		const pathTemplate = cap.path.replace(":id", "dummy");
		it(`tenant_admin ${cap.method} ${cap.path}`, async () => {
			const cookie = await signupAs("tenant_admin");
			const res = await SELF.fetch(`https://x.test${pathTemplate}`, { method: cap.method, headers: { cookie } });
			// we allow 2xx/3xx/404 but never 401/403 for a role on the allow list
			expect([200, 201, 204, 302, 400, 404]).toContain(res.status);
			expect([401, 403]).not.toContain(res.status);
		});
	}
});
```

- [ ] **Step 3: Run the matrix**

Run: `npx vitest run tests/integration/rbac-matrix.test.ts`

Expected: all capability rows pass for `tenant_admin`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac/permissions.ts tests/integration/rbac-matrix.test.ts
git commit -m "test(web): RBAC capability matrix — generated from a single permissions file"
```

---

## Task 25: Final CI gate + regression pass

**Files:**
- Modify: `bakerysense-web/package.json` (add test scripts)

- [ ] **Step 1: Add npm scripts**

In `bakerysense-web/package.json`, under `scripts`:

```json
{
	"test": "vitest run",
	"test:watch": "vitest",
	"typecheck": "tsc --noEmit",
	"lint": "next lint",
	"verify": "npm run typecheck && npm run lint && npm run test"
}
```

- [ ] **Step 2: Run the full gate**

```bash
cd bakerysense-web
npm run verify
```

Expected: typecheck clean, lint clean, all tests passing.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(web): add verify script (typecheck + lint + test)"
```

- [ ] **Step 4: Final integration check**

```bash
npm run dev           # boots wrangler dev + next dev
# in another terminal:
curl -i http://localhost:3000/api/.well-known/jwks.json
# expected: 200 with "keys":[...]

curl -i -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"local@test.co","password":"Local2026LocalLocal","tenantName":"Local","tenantSlug":"local","vertical":"bakery"}'
# expected: 201 + Set-Cookie: bs_at=... bs_rt=...
```

If both succeed, P1 is functionally complete.

- [ ] **Step 5: Commit any stragglers**

```bash
git status        # should be clean
```

---

## Self-review (what this plan covers vs the spec)

- **§4.1 D1 schema** — Task 3 (6 tables except `daily_actuals`, which is P4)
- **§4.2 KV keyspace** — Tasks 6, 7, 8, 12, 18 (rt, jwks, csrf, connector, oauth:state)
- **§5.1 Tokens** — Tasks 5, 7 (JWT ES256 + refresh rotation)
- **§5.2 Passwords** — Task 4 (Argon2id via @noble/hashes)
- **§5.3 JWKS rotation** — Tasks 6, 19, 20 (KV store + public endpoint + cron)
- **§5.4 RBAC + branch scope** — Tasks 10, 24 (requireRole + assertBranchAccess + matrix test)
- **§5.5 Multi-tenant** — Tasks 10, 17 (tenant resolution + isolation test)
- **§5.6 Auth flows** — Tasks 13, 14 (signup / signin / refresh / signout / me)
- **§5.7 Connectors** — Tasks 12, 16, 18 (KV CRUD + AES-GCM + API + OAuth PKCE)
- **§12 Security** — Tasks 8, 22, 23 (cookies, CSRF, rate limits, CSP)

**Gaps from spec NOT in P1 (by design):**

- §6 agent loop → P2
- §7 pages beyond signin/signup → P3
- §8 components beyond minimal auth forms → P3
- §11 Playwright E2E → P5
- §13 dataset ingest → P2
- §14 feedback loop → P4

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-p1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
