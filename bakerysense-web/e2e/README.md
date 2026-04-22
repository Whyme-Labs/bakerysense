# e2e — Playwright test suite

Production test coverage of the 7-scenario demo journey. Runs in CI via `.github/workflows/e2e.yml`.

For the demo-video pipeline (separate tooling), see [`../e2e-demo/`](../e2e-demo/README.md).

## Run

```bash
# Against a local wrangler dev (config spawns it automatically)
npm run test:e2e

# Against the deployed URL
PLAYWRIGHT_BASE_URL=https://bakerysense-web.swmengappdev.workers.dev \
OPS_ROTATE_SECRET=<prod-secret> \
  npm run test:e2e

# Interactive UI
npm run test:e2e:ui
```

## Scenarios

| # | File | Description |
|---|------|-------------|
| 1 | `01-landing.spec.ts` | Landing page loads, CTAs link to /signin + /signup |
| 2 | `02-signin.spec.ts` | Demo admin signs in (happy path + wrong-password) |
| 3 | `03-dashboard.spec.ts` | Bake plan renders, branch selector works, close-out button visible |
| 4 | `04-sku-detail.spec.ts` | Quantile chart + driver bars + Ask-Gemma CTA |
| 5 | `05-chat.spec.ts` | Real Gemma 4 turn (tool call + answer via SSE, ~60s) |
| 6 | `06-display-case.spec.ts` | Photo upload → counts → markdowns (fixme pending fixture) |
| 7 | `07-signout.spec.ts` | Sign-out clears session + blocks dashboard access |

## Shared fixture

`fixtures/demo-seed.ts` provides:
- **`seeded`** — worker-scoped auto-fixture that POSTs `/api/admin/seed-demo` once per Playwright worker with an HMAC signature, ensuring the `favorita` tenant is provisioned before any test runs
- **`signIn(page, email, password, slug)`** — hydration-safe signin helper that waits for the POST to complete before asserting URL change
- **`DEMO`** — constant with the demo credentials

Every spec imports `test`, `expect`, `DEMO`, and `signIn` from this file.
