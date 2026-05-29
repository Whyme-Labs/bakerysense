# UCWS "Submit Project" — paste-ready field copy

Maps 1:1 to the platform's submit form. Copy each block into the matching field.

---

### Project Name  (≤100)
```
BakerySense
```

### Tagline  (≤200 · this is 164)
```
A self-evolving operations harness for bakeries and perishable SMEs — it learns each shop's quirks and proposes validated forecast fixes for one-tap owner approval.
```

### Description  (≤2000 · this is 1777)
```
Independent bakeries throw out 30–40% of what they bake. The waste isn't ignorance — it's uncertainty: forecasts are never perfectly calibrated, every branch behaves differently, and no busy owner notices that croissants quietly run 25% high every Wednesday at one shop and every Sunday at another.

BakerySense turns sales history into tomorrow's bake plan — three options per SKU (conservative / balanced / aggressive) with expected waste, stockout risk and units sold, picked by newsvendor math from a quantile forecast under each shop's own cost ratio.

Then it does what static AI products don't: it learns from its own decisions. Every night the harness replays its execution traces, diagnoses where it systematically missed — separating genuine forecast faults from stockout-censored data, operator overrides and one-off events — proposes a bounded correction to a version-controlled skill artifact, and validates it on a strictly held-out window. All before a human sees it. The owner approves in one tap. The model stays frozen; the skills evolve.

The result: each branch evolves its own playbook. In the live demo, two branches of one brand independently learned different corrections — one for Wednesdays, one for Sundays. Branch skills are sparse overrides on brand defaults, so a chain becomes a federation of self-evolving shops that share what works — only learned rule diffs propagate, never raw sales, preserving each shop's data privacy.

It's real, not a mockup: a working loop on live Cloudflare infrastructure, 285 passing tests, deterministic numbers (LightGBM + newsvendor) with Gemma 4 as the narration layer. Any perishable, recurring-decision SME fits — cafés, grocers, florists, cloud kitchens.

Try it: sign in to the demo and open Admin → Harness.
```

### Demo URL
```
https://bakerysense.swmengappdev.workers.dev
```
> Reviewer login: `demo@bs.co` / `Password2026Password` (tenant slug `demo`). Put these in the Description or a screenshot caption if there's nowhere else — reviewers need them to see the harness.

### Repo URL  (GitHub only)
```
https://github.com/Whyme-Labs/bakerysense
```

### Track  (select up to 2)
**Skill** (primary) + **Application** (secondary).
- *Skill* is the core thesis: skills as external, version-controlled, self-evolving artifacts.
- *Application* reflects that it's a complete, live product. Two tracks = two shots at a track prize.

### Tech Stack  (comma-separated)
```
TypeScript, Next.js, Cloudflare Workers, D1, LightGBM, Gemma 4, Remotion
```

### Project Screenshots  (up to 3 · JPEG/PNG/WebP/GIF · ≤5MB · 200–4096px)
Upload these, in this order, from `docs/submission/upload/`:
1. `01-cover.png` — branded cover (lead/thumbnail): name, tagline, skill-version lineage
2. `02-dashboard-bakeplan.png` — the real daily bake plan (product)
3. `03-harness-evolution.png` — the real self-inspection / approval page (the differentiator)

All three are 200–4096px and well under 5MB.

---

## If there's also a video / Drive field (below the fold)
- Video file: `bakerysense-demo.mp4` (~2 min). If a **URL** is required, upload to YouTube/Drive first and paste the link.
- If a Drive folder is requested, use `DRIVE-CONTENTS.md` for the bundle layout.
