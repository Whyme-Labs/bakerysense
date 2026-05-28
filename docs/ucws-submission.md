# BakerySense — UCWS Singapore Hackathon 2026 submission

**Track:** Skills (self-evolving, version-controlled agent skills). **Live:** https://bakerysense.swmengappdev.workers.dev · **Repo:** https://github.com/Whyme-Labs/bakerysense

---

## One-liner

**BakerySense is a self-evolving operations harness for bakeries and perishable SMEs.** It turns sales history into tomorrow's bake plan — and then *learns from its own decisions*, evolving a different playbook for every shop, under one-tap human approval.

## The problem (real money, not a concept)

Independent bakeries throw out **30–40% of what they bake**. The waste isn't ignorance — it's uncertainty. Forecasts are never perfectly calibrated, every branch behaves differently, and a busy owner will never notice that croissants quietly run 25% high *every Wednesday* at one location and *every Sunday* at another. That blind spot is pure margin on the floor.

## What it does

A daily operating loop, not a chatbot:

1. **Forecast** tomorrow's demand per SKU per branch (deterministic LightGBM quantiles in a Cloudflare Worker).
2. **Plan** production with newsvendor math tuned to the shop's own waste-vs-stockout cost.
3. **Learn** — every night the harness replays its own execution traces, finds where it *systematically* missed, proposes a correction, validates it on a held-out window, and surfaces it for approval.

## The differentiator: a self-evolving harness (why Skills track)

Most "AI for SMEs" is a static model behind a chat box. BakerySense treats **skills as external, version-controlled, training-free artifacts** that improve with use:

- **Diagnose → Propose → Validate → Approve.** A 7-cause classifier separates a genuine forecast fault from stockout-censored data, operator overrides, and one-off events — so the system never learns from noise. It proposes a *bounded* edit (a learning-rate-capped multiplier), then **validates it on a strictly held-out window** before a human ever sees it.
- **Per-branch divergence.** Same brand, same model — yet each shop evolves its *own* skill set. In our live demo, Bukit Bintang independently learned a Wednesday croissant correction; Subang learned a Sunday one. Branch skills are sparse overrides on top of brand defaults.
- **Controlled autonomy.** The harness proposes; the owner approves. Every edit is validated and auditable. The forecasting model stays frozen — only the **skills** evolve. (Approach grounded in recent work: SkillOpt arXiv:2605.23904, EmbodiSkill arXiv:2605.10332.)

## Why it's real (execution over polish)

- **It works end-to-end on live infrastructure**, not a mockup: seeded 16 weeks of data → the harness diagnosed both branches → produced validated proposals → approval activated a new skill version that the next forecast applies. Verified over HTTP against the live Cloudflare D1.
- **285 passing tests** (unit + integration), clean TypeScript, full migrations, reproducible deploy.
- **Deterministic numbers, semantic Gemma.** Quantities come from the forecaster + newsvendor — never hallucinated; Gemma 4 is the narration/explanation layer. This is what makes the recommendations trustworthy to a real operator.

## Global scalability

The harness is vertical-agnostic. Any perishable, recurring-decision SME fits: cafés, grocers, florists, cloud kitchens, central kitchens. The brand→branch skill hierarchy scales to chains, and because only *learned rule diffs* (not raw sales) propagate, it preserves data privacy while still sharing what works — a federation of self-evolving shops.

## Try it

- **Live app:** https://bakerysense.swmengappdev.workers.dev — sign in `demo@bs.co` / `Password2026Password`, tenant slug `demo`.
- **The money shot:** Admin → **Harness** (`/t/demo/admin/harness`) — two branches with *different* learned corrections, each with before/after held-out WAPE, waiting for approval.
- **Architecture:** [`docs/architecture/self-evolving-harness.md`](architecture/self-evolving-harness.md) · **Demo guide:** [`docs/demo-harness.md`](demo-harness.md)

## Team

Whyme Labs.
