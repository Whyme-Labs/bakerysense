# BakerySense — Cover Image Spec

For use as the Kaggle submission cover and Twitter/OG card. A designer should be able to execute this in Canva, Figma, or Photoshop in under 30 minutes.

---

## Canvas

- **Primary export:** 1200×630 px (Kaggle cover + Twitter summary card)
- **Retina export:** 2400×1260 px (2× of the same composition, exported separately)
- **Color space:** sRGB
- **Format:** PNG (lossless), saved as `cover-1200x630.png` and `cover-2400x1260.png` under `docs/demo/assets/` (create that directory when exporting)

---

## Color palette

All values pulled directly from `bakerysense-web/src/app/tokens.css`.

| Token | Value | Role |
|---|---|---|
| `--brand-500` | `oklch(0.76 0.14 70)` ≈ `#D4A033` | Honey amber — primary accent, headlines, logo dot |
| `--brand-700` | `oklch(0.52 0.13 60)` ≈ `#8A5C25` | Baked terracotta — secondary text, tag backgrounds |
| `--surface` | `oklch(0.99 0 0)` ≈ `#FCFCFC` | Off-white background |
| `--ink` | `oklch(0.22 0 0)` ≈ `#2A2A2A` | Near-black — body text |
| `--ink-subtle` | `oklch(0.68 0.01 0)` ≈ `#9D9D9D` | Tag text, caption |

Use these exact colors. Do not substitute with generic "gold" or "brown" swatches from a library — the warm bias needs to match the app UI.

---

## Typography

| Use | Font | Weight | Size (1200px canvas) |
|---|---|---|---|
| Headline | Geist Sans | Semibold (600) | 52–58px |
| Subhead / descriptor | Geist Sans | Regular (400) | 20px |
| Logo mark | Geist Sans | Semibold (600) | 18px |
| Bottom tags | Geist Mono | Regular (400) | 14px |

Geist Sans and Geist Mono are free on [vercel.com/font](https://vercel.com/font). If unavailable in your tool, substitute Inter (Sans) and JetBrains Mono (Mono) — do not substitute with system serif fonts.

---

## Composition

```
┌─────────────────────────────────────────────────────────┐
│ [BakerySense ●]                             1200×630 px │
│                                                         │
│  ┌─────────────────┐   ┌────────────────────────────┐  │
│  │                 │   │                            │  │
│  │  HEADLINE       │   │   Dashboard screenshot     │  │
│  │  (left 40%)     │   │   (right 60%, ~3° tilt)    │  │
│  │                 │   │                            │  │
│  │                 │   │   [QualityBadge visible]   │  │
│  └─────────────────┘   └────────────────────────────┘  │
│                                                         │
│  [Gemma 4 · Cloudflare Workers · Offline-first · CC-BY] │
└─────────────────────────────────────────────────────────┘
```

### Logo mark (top-left)

- Text: `BakerySense` in Geist Sans Semibold, 18px, color `--ink`
- Before the text: a filled circle (8×8 px, color `--brand-500`) acting as a honey-dot — no border, no shadow
- Spacing: 6px gap between dot and text
- Position: 32px from left edge, 28px from top edge

### Left zone (x 0–480 px, full height)

Background: `--surface` (off-white). No border separating left from right.

Content (vertically centered, left-padded 40px):

1. **Headline** (Geist Sans Semibold, 52px, color `--ink`, line-height 1.15, max-width 360px):
   ```
   AI production copilot
   for independent
   bakeries.
   ```
   The period at the end is intentional.

2. **Descriptor** (Geist Sans Regular, 20px, color `--ink-subtle`, margin-top 16px, max-width 320px):
   ```
   Forecast tomorrow's bake plan.
   Count today's leftovers.
   Reduce waste. Repeat.
   ```

3. **Accent rule** (optional): a 3px horizontal line in `--brand-500`, 48px wide, positioned between the logo and the headline, margin 24px below logo.

### Right zone (x 480–1200 px, full height)

Background: `--surface`.

Content: a single screenshot slice of the BakePlanTable, positioned as follows:

- **Source:** capture `/t/favorita/dashboard?branch=brn_quito_centro` at 1920×1080, browser zoom 100%, after seeding. Export full-page PNG.
- **Crop rectangle:** approximately 800×500 px showing the first 4 SKU rows of the BakePlanTable. The crop should include the column headers ("Product", "Bake quantity", "WAPE") and at least one QualityBadge dot in amber or green. The "Ask Gemma why →" link column should be partially visible on the right edge of the crop.
- **Placement:** centered in the right zone horizontally, vertically centered with a slight upward offset (top of image at ~10% from top of canvas). Rotate the image **3° clockwise**.
- **Shadow:** a single box-shadow of `0 8px 24px rgba(0,0,0,0.10)`. Do not exceed 8px blur — the spec explicitly prohibits heavy shadows.
- **Rounded corners:** 8px (`--radius`).

The screenshot must show real data from the seeded demo tenant — not a wireframe or mockup.

### Bottom tag bar (full width, bottom 48px)

- Background: none (transparent over `--surface`)
- Content (Geist Mono Regular, 14px, color `--brand-700`, centered horizontally, 32px from bottom edge):
  ```
  Gemma 4 · Cloudflare Workers · Offline-first · CC-BY-4.0
  ```
- Separator: middle-dot `·` (U+00B7) with 12px horizontal padding each side

---

## What NOT to do

- **No stock photography** of artisanal bread, hands kneading dough, or generic "AI brain" imagery
- **No glossy gradients** — flat brand colors only
- **No emoji** anywhere on the canvas
- **No drop-shadows over 8px blur** — the 24px shadow on the screenshot is already at the limit; do not add additional shadows to text or the logo
- **No decorative borders** around the canvas or zones
- **No serif fonts** — Geist Sans is a geometric sans; the warm tone comes from the amber palette, not the typeface
- **No AI-generated imagery** — the cover must show actual product UI

---

## Deliverables

| File | Size | Location |
|---|---|---|
| `cover-1200x630.png` | 1200×630 px | `docs/demo/assets/` |
| `cover-2400x1260.png` | 2400×1260 px | `docs/demo/assets/` |

The `docs/demo/assets/` directory does not exist in the repository — the designer creates it locally when exporting. Do not commit placeholder files.

---

## Checklist before handing off

- [ ] Headline reads "AI production copilot for independent bakeries." (period included)
- [ ] Brand-500 honey amber used for logo dot and accent rule; brand-700 terracotta used for bottom tags
- [ ] Screenshot shows real seeded data, not a wireframe
- [ ] QualityBadge dot visible and readable at 1200px canvas size
- [ ] Screenshot rotated 3° clockwise with 8px corner radius and max 24px shadow
- [ ] No emoji, no gradients, no stock photography
- [ ] Both PNG sizes exported and verified at full resolution
