# Deployment

BakerySense deploys as a single Cloudflare Worker via `@opennextjs/cloudflare`.
This document is a copy-paste checklist for a fresh deploy.

## One-time setup

### 1. Prerequisites

- Cloudflare account on Workers Paid plan (Queues require paid)
- `wrangler` CLI: `npm install -g wrangler` (v4.x+)
- `wrangler login`

### 2. Create bindings

From the repo root:

```bash
cd bakerysense-web

# D1 database
wrangler d1 create bakerysense
# Copy the printed database_id into wrangler.jsonc's d1_databases[0].database_id

# KV namespace
wrangler kv namespace create KV
# Copy the printed id into wrangler.jsonc's kv_namespaces[0].id

# R2 buckets
wrangler r2 bucket create bakerysense-models
wrangler r2 bucket create bakerysense-models-dev

# Queues
wrangler queues create chat-queue
wrangler queues create chat-dlq
wrangler queues create retrain-queue
wrangler queues create retrain-dlq
```

### 3. Set secrets

```bash
wrangler secret put SESSION_SIGNING_KEY   # 32 random bytes, base64
wrangler secret put JWKS_ENCRYPTION_KEY   # 32 random bytes, base64
wrangler secret put CONNECTOR_MEK         # 32 random bytes, base64
wrangler secret put OPS_ROTATE_SECRET     # anything long + random
wrangler secret put OPENROUTER_API_KEY            # optional, tenant admins can set via UI
wrangler secret put OPENROUTER_OAUTH_CLIENT_ID    # optional
wrangler secret put OPENROUTER_OAUTH_CLIENT_SECRET # optional
```

Generate 32 random bytes base64 on macOS/Linux:
```bash
openssl rand -base64 32
```

### 4. Run migrations

```bash
wrangler d1 migrations apply bakerysense --remote
```

## Deploy

```bash
cd bakerysense-web
npm run deploy   # runs opennextjs-cloudflare build + deploy
```

Note the deployed URL (something like `https://bakerysense-web.<account>.workers.dev`).

## Seed the demo tenant

One-time setup of the demo tenant after first deploy. Compute the HMAC
signature with your `OPS_ROTATE_SECRET`:

```bash
BODY='{}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$OPS_ROTATE_SECRET" -hex | awk '{print $2}')
curl -X POST "https://<your-deploy-url>/api/admin/seed-demo" \
  -H "content-type: application/json" \
  -H "x-ops-secret: $SIG" \
  -d "$BODY"
```

Response includes `tenantId`. Use it to upload the tree + features bundle:

```bash
# From the repo root
python scripts/seed_demo_bundle.py --tenant-id <tenantId>
# ... then run the wrangler r2 object put commands it prints
```

## Smoke test

```bash
./scripts/deploy-smoke.sh https://<your-deploy-url>
```

Expected output:

```
smoke-testing https://...
  ✓ landing [200]
  ✓ signin page [200]
  ✓ signup page [200]
  ✓ jwks [200]
  ✓ me (unauth=401) [401]
all checks passed
```

## Demo credentials

- `demo@bakerysense.app` / `Demo2026DemoDemo` — tenant_admin, all 5 branches
- `manager@bakerysense.app` / `Manager2026Manager` — branch_manager, 2 branches

## Rotations (optional)

### JWKS rotation

The main Worker exposes `POST /api/internal/rotate-jwks` guarded by
`OPS_ROTATE_SECRET`. Automated weekly rotation requires a separate
cron Worker — see `bakerysense-web/scripts/cron/jwks-rotate.ts` (disabled
in wrangler.jsonc per P1 decision).

### Tenant retrain

Weekly retrain cron stub at `bakerysense-web/src/scripts/cron/retrain-cron.ts`
— also disabled. Manually trigger via `POST /api/admin/retrain` as
`tenant_admin`, then run `python scripts/retrain_tenant.py` locally
against the exported training CSV. See `docs/architecture.md` §Feedback loop.
