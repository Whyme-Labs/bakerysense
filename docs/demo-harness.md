# Self-Evolving Harness — Demo Guide

Live: **https://bakerysense.swmengappdev.workers.dev**

## Demo login

| Field | Value |
|---|---|
| Email | `demo@bs.co` |
| Password | `Password2026Password` |
| Tenant slug | `demo` |

(Throwaway demo tenant — credentials are intentionally non-secret.)

## The story

Two branches of the same bakery, both over-baking croissants — but on
**different days**. The harness independently detects each branch's own
systematic bias and proposes a branch-specific correction.

- **Bukit Bintang** — croissant forecast runs ~25% high every **Wednesday**.
- **Subang Jaya** — croissant forecast runs ~30% high every **Sunday**.

Everything else is well-forecast, so the harness leaves it alone. This is
the "each branch evolves its own skill set" thesis made concrete.

## Walkthrough

1. Sign in and open **`/t/demo/admin/harness`** (Harness evolution).
2. Two pending proposals are listed, each with its diagnosis, the rules
   diff (`CROISSANT on Wed: 1.0 → 0.8`), and the before/after holdout WAPE.
3. **Approve** Bukit Bintang's — a new branch skill version activates; the
   next forecast for a Wednesday applies the 0.8 multiplier (other days
   untouched, and the *other* branch is unaffected).
4. Note the divergence: Subang's pending item targets **Sunday**, not
   Wednesday — a different learned correction for a different branch.
5. (Optional) Hit **Run inspection** to re-run the loop on demand.

## Re-seeding the demo data

The dataset is synthetic with a deliberately injected bias (a demo needs a
crisp, reproducible systematic error; real sales carry no controllable
forecast residual). Regenerate + reload:

```bash
cd bakerysense-web
TENANT_ID=ten_Eqtip9cMX BUKIT_ID=brn_fXfjy1wpy7y6 SUBANG_ID=brn_demo_subang1 \
  node scripts/seed-harness-demo.mjs > /tmp/seed-harness.sql
npx wrangler d1 execute bakerysense-v2 --remote --file=/tmp/seed-harness.sql

# Reset proposals/skill versions for a clean both-pending state, then
# re-run inspection per branch (via the UI "Run inspection" button, or the
# POST /api/harness/inspect endpoint).
npx wrangler d1 execute bakerysense-v2 --remote \
  --command "DELETE FROM evolution_proposals WHERE tenant_id='ten_Eqtip9cMX'; DELETE FROM skill_versions WHERE tenant_id='ten_Eqtip9cMX';"
```

The generator (`scripts/seed-harness-demo.mjs`) writes 16 weeks of
`daily_actuals` for two branches with realistic weekly seasonality plus the
injected per-branch bias. Edit the `BRANCHES` config at the top to change
the pattern.
