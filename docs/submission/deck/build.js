// BakerySense — UCWS 2026 pitch deck. Theme matched to the demo video.
// Run: node build.js  → ../bakerysense-ucws-deck.pptx
const pptxgen = require("pptxgenjs");
const path = require("path");

const SHOTS = path.join(__dirname, "..", "screenshots");
const img = (name) => path.join(SHOTS, name);

// ---- palette (hex, matched to the HarnessStory video) ----
const INK = "1E1A12";       // dark warm charcoal
const PANEL = "2A2418";     // raised dark panel
const AMBER = "E0A23C";
const AMBER_SOFT = "F5E6C8";
const GREEN = "2F9E66";
const CREAM = "FBF7EF";
const RED = "C8472E";
const MUTED = "8A8270";
const INKTEXT = "2A2418";
const WHITE = "FFFFFF";
const CREAMTEXT = "EFE7D6";

const HFONT = "Trebuchet MS";
const BFONT = "Calibri";
const MONO = "Consolas";

const W = 13.333, H = 7.5, M = 0.6;

const p = new pptxgen();
p.defineLayout({ name: "W16x9", width: W, height: H });
p.layout = "W16x9";

// Helpers ------------------------------------------------------------------
function bg(slide, color) { slide.background = { color }; }
function chip(slide, x, y, text, fill, txt) {
	slide.addText(text, {
		x, y, w: 4.2, h: 0.42, align: "left", valign: "middle",
		fontFace: MONO, fontSize: 12, color: txt, bold: true,
		fill: { color: fill }, rectRadius: 0.21, shape: p.ShapeType.roundRect,
		margin: 8, charSpacing: 1,
	});
}
function dot(slide, x, y, color) {
	slide.addShape(p.ShapeType.ellipse, { x, y, w: 0.14, h: 0.14, fill: { color } });
}
function framed(slide, file, x, y, w, h) {
	// subtle border frame behind the screenshot
	slide.addShape(p.ShapeType.roundRect, { x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, fill: { color: WHITE }, line: { color: AMBER, width: 1.5 }, rectRadius: 0.08, shadow: { type: "outer", color: "000000", opacity: 0.18, blur: 12, offset: 4, angle: 90 } });
	slide.addImage({ path: file, x, y, w, h });
}

// ===== Slide 1 — Title (dark) =====
let s = p.addSlide(); bg(s, INK);
dot(s, M, M + 0.04, AMBER);
s.addText("UCWS SINGAPORE 2026  ·  SKILLS TRACK", { x: M + 0.28, y: M - 0.06, w: 8, h: 0.4, fontFace: MONO, fontSize: 12, color: AMBER, bold: true, charSpacing: 2 });
s.addText("BakerySense", { x: M, y: 2.2, w: 11, h: 1.4, fontFace: HFONT, fontSize: 72, bold: true, color: WHITE });
s.addText([
	{ text: "A self-evolving operations harness", options: { color: CREAMTEXT } },
	{ text: " for bakeries and perishable SMEs.", options: { color: AMBER } },
], { x: M, y: 3.7, w: 11.2, h: 0.8, fontFace: HFONT, fontSize: 28 });
s.addText("It turns sales history into tomorrow's bake plan — then learns from its own decisions, evolving a different playbook for every shop, under one-tap human approval.", { x: M, y: 4.7, w: 10.8, h: 1.0, fontFace: BFONT, fontSize: 16, color: MUTED, lineSpacingMultiple: 1.2 });
s.addText("bakerysense.swmengappdev.workers.dev   ·   github.com/Whyme-Labs/bakerysense", { x: M, y: 6.6, w: 12, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER });

// ===== Slide 2 — Problem (light) =====
s = p.addSlide(); bg(s, CREAM);
s.addText("THE PROBLEM", { x: M, y: M, w: 6, h: 0.4, fontFace: MONO, fontSize: 13, color: RED, bold: true, charSpacing: 2 });
s.addText("30–40%", { x: M, y: 1.65, w: 6.4, h: 1.5, fontFace: HFONT, fontSize: 96, bold: true, color: RED, valign: "top", margin: 0 });
s.addText("of everything an independent bakery bakes is thrown out.", { x: M, y: 3.35, w: 5.9, h: 1.3, fontFace: HFONT, fontSize: 23, bold: true, color: INKTEXT, valign: "top" });
s.addText([
	{ text: "The waste isn't ignorance — it's uncertainty.\n", options: { bold: true, color: INKTEXT } },
	{ text: "Forecasts are never perfectly calibrated. Every branch behaves differently. No busy owner notices that croissants quietly run 25% high every Wednesday at one shop, and every Sunday at another. That blind spot is pure margin on the floor.", options: { color: "5A5341" } },
], { x: 7.0, y: 2.2, w: 5.7, h: 3.2, fontFace: BFONT, fontSize: 18, lineSpacingMultiple: 1.25 });

// ===== Slide 3 — The daily decision (light, dashboard shot) =====
s = p.addSlide(); bg(s, CREAM);
s.addText("WHAT IT DOES", { x: M, y: M, w: 6, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("Tomorrow's bake plan, as a decision — not a chatbot", { x: M, y: M + 0.32, w: 12, h: 0.7, fontFace: HFONT, fontSize: 30, bold: true, color: INKTEXT });
framed(s, img("dashboard-bakeplan.png"), M, 1.75, 8.2, 5.13);
s.addText([
	{ text: "Three plans per SKU.\n", options: { bold: true, color: INKTEXT, fontSize: 19 } },
	{ text: "Conservative · Balanced · Aggressive — each with expected waste, stockout chance, and units sold, picked by newsvendor math from a quantile forecast under the shop's own cost ratio. One tap commits the call.", options: { color: "5A5341", fontSize: 15 } },
], { x: 9.1, y: 2.1, w: 3.6, h: 3.4, fontFace: BFONT, lineSpacingMultiple: 1.2 });

// ===== Slide 4 — The differentiator (dark, loop) =====
s = p.addSlide(); bg(s, INK);
s.addText("THE DIFFERENTIATOR  ·  WHY SKILLS TRACK", { x: M, y: M, w: 9, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("It learns from its own decisions", { x: M, y: M + 0.32, w: 12, h: 0.8, fontFace: HFONT, fontSize: 34, bold: true, color: WHITE });
const steps = [
	["1 · diagnose", "Classify every miss. Stockout-censored, operator override, one-off event, or a genuine skill fault — only the last one is learnable."],
	["2 · propose", "Emit a bounded, learning-rate-capped correction to a version-controlled skill artifact (not the model)."],
	["3 · validate", "Re-score on a strictly held-out window. The edit must measurably cut error before anyone sees it."],
	["4 · approve", "The owner approves in one tap. Controlled autonomy — every edit is validated and auditable."],
];
let cx = M;
const cardW = 2.85, gap = 0.28;
steps.forEach((st, i) => {
	const x = M + i * (cardW + gap);
	s.addShape(p.ShapeType.roundRect, { x, y: 2.0, w: cardW, h: 3.7, fill: { color: PANEL }, line: { color: "4A4230", width: 1 }, rectRadius: 0.1 });
	s.addShape(p.ShapeType.ellipse, { x: x + 0.25, y: 2.3, w: 0.5, h: 0.5, fill: { color: AMBER } });
	s.addText(String(i + 1), { x: x + 0.25, y: 2.3, w: 0.5, h: 0.5, align: "center", valign: "middle", fontFace: HFONT, fontSize: 22, bold: true, color: INK });
	s.addText(st[0].split("·")[1].trim(), { x: x + 0.25, y: 3.0, w: cardW - 0.5, h: 0.5, fontFace: HFONT, fontSize: 19, bold: true, color: AMBER });
	s.addText(st[1], { x: x + 0.25, y: 3.55, w: cardW - 0.5, h: 2.0, fontFace: BFONT, fontSize: 13.5, color: CREAMTEXT, lineSpacingMultiple: 1.18 });
});
s.addText("The forecasting model stays frozen. The skills evolve.", { x: M, y: 6.05, w: 12, h: 0.5, fontFace: HFONT, fontSize: 18, italic: true, color: AMBER });

// ===== Slide 5 — Self-inspection in action (light, harness-full) =====
s = p.addSlide(); bg(s, CREAM);
s.addText("SELF-INSPECTION IN ACTION", { x: M, y: M, w: 8, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("Corrections it taught itself, waiting for review", { x: M, y: M + 0.32, w: 12, h: 0.7, fontFace: HFONT, fontSize: 30, bold: true, color: INKTEXT });
framed(s, img("harness-full.png"), M, 1.8, 8.0, 5.0);
s.addText([
	{ text: "Every night, the harness replays its traces and proposes validated fixes.\n\n", options: { bold: true, color: INKTEXT, fontSize: 16 } },
	{ text: "Bukit Bintang: croissants +25% on Wednesdays.\n", options: { color: "5A5341", fontSize: 15 } },
	{ text: "Held-out WAPE 3.0% → 2.0%.\n\n", options: { color: GREEN, bold: true, fontSize: 15 } },
	{ text: "CROISSANT · Wed   1.00 → 0.80", options: { fontFace: MONO, color: INKTEXT, fontSize: 14 } },
], { x: 8.9, y: 2.1, w: 3.85, h: 4.0, fontFace: BFONT, lineSpacingMultiple: 1.2 });

// ===== Slide 6 — Divergence (dark, two cards) =====
s = p.addSlide(); bg(s, INK);
s.addText("THE WOW  ·  PER-BRANCH EVOLUTION", { x: M, y: M, w: 9, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("Same brand, same model — different playbooks", { x: M, y: M + 0.32, w: 12, h: 0.8, fontFace: HFONT, fontSize: 32, bold: true, color: WHITE });
s.addText("Bukit Bintang", { x: M, y: 1.9, w: 5.7, h: 0.5, align: "center", fontFace: HFONT, fontSize: 20, bold: true, color: CREAMTEXT });
framed(s, img("harness-card-2.png"), M + 0.45, 2.42, 4.8, 1.78);
s.addText("CROISSANT · Wed → 0.80", { x: M, y: 4.42, w: 5.7, h: 0.45, align: "center", fontFace: MONO, fontSize: 20, bold: true, color: AMBER });
s.addText("learned Wednesdays on its own", { x: M, y: 4.86, w: 5.7, h: 0.35, align: "center", fontFace: BFONT, fontSize: 13, color: MUTED });
s.addText("Subang Jaya", { x: 7.0, y: 1.9, w: 5.7, h: 0.5, align: "center", fontFace: HFONT, fontSize: 20, bold: true, color: CREAMTEXT });
framed(s, img("harness-card-1.png"), 7.45, 2.42, 4.8, 1.78);
s.addText("CROISSANT · Sun → 0.80", { x: 7.0, y: 4.42, w: 5.7, h: 0.45, align: "center", fontFace: MONO, fontSize: 20, bold: true, color: AMBER });
s.addText("learned Sundays on its own", { x: 7.0, y: 4.86, w: 5.7, h: 0.35, align: "center", fontFace: BFONT, fontSize: 13, color: MUTED });
s.addText("Each shop becomes its own agent with its own skill set — branch skills are sparse overrides on brand defaults. A federation of self-evolving shops.", { x: M, y: 5.55, w: 12.1, h: 1.0, align: "center", fontFace: BFONT, fontSize: 16, color: CREAMTEXT, lineSpacingMultiple: 1.2 });

// ===== Slide 7 — Why it's real (light) =====
s = p.addSlide(); bg(s, CREAM);
s.addText("EXECUTION OVER POLISH", { x: M, y: M, w: 8, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("A working loop on live infrastructure — not a mockup", { x: M, y: M + 0.32, w: 12, h: 0.7, fontFace: HFONT, fontSize: 28, bold: true, color: INKTEXT });
const stats = [["285", "tests passing"], ["100%", "deterministic numbers"], ["Live", "on Cloudflare D1"]];
stats.forEach((st, i) => {
	const x = M + i * 2.55;
	s.addText(st[0], { x, y: 1.75, w: 2.4, h: 0.9, fontFace: HFONT, fontSize: 46, bold: true, color: GREEN });
	s.addText(st[1], { x, y: 2.65, w: 2.4, h: 0.4, fontFace: BFONT, fontSize: 13, color: "5A5341" });
});
framed(s, img("model-lineage.png"), M, 3.35, 7.6, 3.4);
s.addText([
	{ text: "Deterministic numbers, semantic Gemma.\n", options: { bold: true, color: INKTEXT, fontSize: 17 } },
	{ text: "Quantities come from a LightGBM quantile forecaster + newsvendor — never hallucinated. Gemma 4 is the narration and explanation layer. That split is what makes recommendations trustworthy to a real operator — and it's what gets the harness's edits past validation instead of vibes.", options: { color: "5A5341", fontSize: 14.5 } },
], { x: 8.45, y: 3.5, w: 4.3, h: 3.2, fontFace: BFONT, lineSpacingMultiple: 1.22 });

// ===== Slide 8 — Scalability (dark) =====
s = p.addSlide(); bg(s, INK);
s.addText("GLOBAL SCALABILITY", { x: M, y: M, w: 8, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("One harness, every perishable business", { x: M, y: M + 0.32, w: 12, h: 0.8, fontFace: HFONT, fontSize: 32, bold: true, color: WHITE });
const verticals = ["Bakeries", "Cafés", "Grocers", "Florists", "Cloud kitchens", "Central kitchens"];
verticals.forEach((v, i) => {
	const col = i % 3, row = Math.floor(i / 3);
	const x = M + col * 4.0, y = 2.1 + row * 1.0;
	s.addShape(p.ShapeType.roundRect, { x, y, w: 3.7, h: 0.8, fill: { color: PANEL }, line: { color: "4A4230", width: 1 }, rectRadius: 0.1 });
	s.addShape(p.ShapeType.ellipse, { x: x + 0.22, y: y + 0.28, w: 0.24, h: 0.24, fill: { color: AMBER } });
	s.addText(v, { x: x + 0.65, y, w: 2.9, h: 0.8, valign: "middle", fontFace: HFONT, fontSize: 18, bold: true, color: CREAMTEXT });
});
s.addText([
	{ text: "The brand→branch skill hierarchy scales to chains. Only ", options: { color: CREAMTEXT } },
	{ text: "learned rule diffs", options: { color: AMBER, bold: true } },
	{ text: " propagate — not raw sales — so it preserves each shop's data privacy while sharing what works.", options: { color: CREAMTEXT } },
], { x: M, y: 4.6, w: 12, h: 1.2, fontFace: BFONT, fontSize: 18, lineSpacingMultiple: 1.25 });
s.addText("Real product value · execution quality · global scalability.", { x: M, y: 6.2, w: 12, h: 0.5, fontFace: HFONT, fontSize: 18, italic: true, color: MUTED });

// ===== Slide 9 — Close (dark) =====
s = p.addSlide(); bg(s, INK);
s.addText("GET STARTED", { x: M, y: 1.55, w: 6, h: 0.4, fontFace: MONO, fontSize: 13, color: AMBER, bold: true, charSpacing: 2 });
s.addText("Try it in 30 seconds", { x: M, y: 1.95, w: 11.5, h: 1.0, fontFace: HFONT, fontSize: 48, bold: true, color: WHITE });
s.addText([
	{ text: "Live demo   ", options: { color: AMBER, bold: true } },
	{ text: "bakerysense.swmengappdev.workers.dev", options: { color: CREAMTEXT } },
	{ text: "\nSign in    demo@bs.co  /  Password2026Password   (slug: demo)", options: { color: CREAMTEXT } },
	{ text: "\nMoney shot  Admin → Harness — two branches, two different learned fixes, awaiting approval.", options: { color: CREAMTEXT } },
	{ text: "\n\nRepo       ", options: { color: AMBER, bold: true } },
	{ text: "github.com/Whyme-Labs/bakerysense", options: { color: CREAMTEXT } },
], { x: M, y: 3.45, w: 12.1, h: 2.6, fontFace: MONO, fontSize: 15, lineSpacingMultiple: 1.5 });
s.addText("BakerySense · Whyme Labs · UCWS Singapore 2026 · Skills track", { x: M, y: 6.7, w: 12, h: 0.4, fontFace: BFONT, fontSize: 13, color: CREAMTEXT });

p.writeFile({ fileName: path.join(__dirname, "..", "bakerysense-ucws-deck.pptx") }).then((f) => console.log("wrote", f));
