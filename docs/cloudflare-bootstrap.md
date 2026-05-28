# Cloudflare Bootstrap — bakerysense (UCWS repo)

> **Provisioned 2026-05-28** on account `swmengappdev@gmail.com`
> (`1e0170aaabc90ecf5f466128d1f0466a`). Live at
> **https://bakerysense.swmengappdev.workers.dev**.
> D1 `bakerysense-v2` (`02caf191-…`), KV `bakerysense-kv` (`2b82f5cd…`),
> R2 `bakerysense-models-v2` + `-dev`, queues `bakerysense-{chat,retrain}-queue`
> (+ DLQs). All 9 migrations applied. The 4 runtime secrets
> (`JWKS_ENCRYPTION_KEY`, `CONNECTOR_MEK`, `SESSION_SIGNING_KEY`,
> `OPS_ROTATE_SECRET`) were set to freshly-generated random values — rotate
> with `npx wrangler secret put <NAME>` if needed. The steps below remain the
> reference for re-provisioning from scratch.

This repo deploys to a **separate Cloudflare project** from the Kaggle
`gemma-4-hack` repo. The old repo owns `bakerysense-web` (Worker) + the
D1 database `bakerysense` (id `0f9b74b1-fa75-4ff1-bbfb-87bd0e377890`) +
the existing KV, R2, queues. **None of those resources should be touched
from this repo.**

`bakerysense-web/wrangler.jsonc` is pre-wired with the new resource
*names* and `REPLACE_WITH_NEW_…` placeholders for the *ids* you'll
generate by running the commands below.

## Prerequisites

```bash
cd bakerysense-web
npx wrangler login        # one-time browser auth, only if not already logged in
npx wrangler whoami       # confirm: account 1e0170aaabc90ecf5f466128d1f0466a
```

## 1. Create the new D1 database

```bash
npx wrangler d1 create bakerysense-v2
```

Output looks like:

```
✅ Successfully created DB 'bakerysense-v2' in region <REGION>
[[d1_databases]]
binding = "DB"
database_name = "bakerysense-v2"
database_id = "abcd1234-…"
```

Copy the `database_id` and paste it into `wrangler.jsonc` in **both**
places where `REPLACE_WITH_NEW_D1_ID` appears (production block and the
`env.test` block).

## 2. Create the new KV namespace

```bash
npx wrangler kv namespace create bakerysense-kv
```

Output includes:

```
✅ Success!
{ "binding": "KV", "id": "9999...aaaa" }
```

Paste the `id` into `wrangler.jsonc` for both `REPLACE_WITH_NEW_KV_ID`
locations.

## 3. Create the new R2 bucket

```bash
npx wrangler r2 bucket create bakerysense-models-v2
npx wrangler r2 bucket create bakerysense-models-v2-dev    # test env
```

No id substitution needed — R2 buckets are referenced by name in
`wrangler.jsonc`.

## 4. Create the new queues

```bash
# Main queues
npx wrangler queues create bakerysense-chat-queue
npx wrangler queues create bakerysense-retrain-queue

# Dead-letter queues (consumers refer to these)
npx wrangler queues create bakerysense-chat-dlq
npx wrangler queues create bakerysense-retrain-dlq

# Test-env queues (only if you intend to run `wrangler dev --env test`
# against the cloud, which is unusual; the cloudflare vitest pool uses
# miniflare locally)
npx wrangler queues create bakerysense-chat-queue-test
npx wrangler queues create bakerysense-retrain-queue-test
```

## 5. Apply migrations to the new D1

```bash
# From bakerysense-web/
npx wrangler d1 migrations apply bakerysense-v2 --remote
```

This applies `drizzle/0000_init.sql` through `drizzle/0008_evolution_proposals.sql`
to the new database, including the two new tables `skill_versions` and
`evolution_proposals` that ship with this repo.

## 6. First deploy

```bash
# Still in bakerysense-web/
npx wrangler deploy
```

The Worker will be created at `bakerysense.<your-subdomain>.workers.dev`
(unique to your account, distinct from the Kaggle Worker URL).

## 7. Verify isolation

After deploy:

```bash
# Confirm we never touched the Kaggle D1
npx wrangler d1 info bakerysense           # the OLD database, should be unchanged
npx wrangler d1 info bakerysense-v2        # the new one, should have schema applied
```

## Sanity checklist before deploying

- [ ] `wrangler.jsonc` has no `REPLACE_WITH_…` placeholders left.
- [ ] `database_name` is `bakerysense-v2`, never `bakerysense`.
- [ ] Worker `name` is `bakerysense`, never `bakerysense-web`.
- [ ] `WORKER_SELF_REFERENCE.service` matches the new worker name.
- [ ] No bindings reference the old ids:
  - D1 id `0f9b74b1-fa75-4ff1-bbfb-87bd0e377890` — must NOT appear.
  - KV id `f07f4dea79ce40309aad6e595d0cb214` — must NOT appear.
  - Bucket `bakerysense-models` (no `-v2`) — must NOT appear.

If any of those slip through, abort the deploy — you'll write to the
Kaggle judging demo's live resources.
