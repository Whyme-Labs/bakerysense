// Records rich, natural-speed Playwright walkthrough clips of the live app
// with a VISIBLE injected cursor, so real interactions (navigating, opening
// menus, clicking Run inspection, approving) read clearly on camera.
//
//   npx tsx e2e-demo/record-walkthrough.ts
//
// Output: video/public/recordings/{plan,input,review,approve}.webm
//
// State flow: caller should reset proposals/skill_versions first so the
// REVIEW clip's "Run inspection" produces a fresh proposal live, and the
// APPROVE clip then approves it. Restore 2 pending proposals afterwards.
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "https://bakerysense.swmengappdev.workers.dev";
const SLUG = "demo";
const EMAIL = "demo@bs.co";
const PASSWORD = "Password2026Password";
const BUKIT = "brn_fXfjy1wpy7y6";
const ON_DATE = "2026-05-29";
const REC = join(__dirname, "video", "public", "recordings");
const SIZE = { width: 1440, height: 900 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Injected on every document: a soft cursor dot that follows the mouse and
// pulses green on click, so Playwright's (cursorless) video shows the action.
const CURSOR_SCRIPT = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;border-radius:50%;background:rgba(224,162,60,0.85);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.5);pointer-events:none;transform:translate(-50%,-50%);transition:width .1s,height .1s,background .1s;left:-100px;top:-100px';
    document.body.appendChild(c);
  };
  if (document.body) mk(); else addEventListener('DOMContentLoaded', mk);
  addEventListener('mousemove', e => { const c=document.getElementById('__cur'); if(c){c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';} }, true);
  addEventListener('mousedown', () => { const c=document.getElementById('__cur'); if(c){c.style.width='34px';c.style.height='34px';c.style.background='rgba(47,158,102,0.9)';} }, true);
  addEventListener('mouseup', () => { const c=document.getElementById('__cur'); if(c){c.style.width='24px';c.style.height='24px';c.style.background='rgba(224,162,60,0.85)';} }, true);
})();
`;

async function glideTo(page: Page, selector: string, steps = 30): Promise<void> {
	const el = page.locator(selector).first();
	await el.scrollIntoViewIfNeeded().catch(() => {});
	const box = await el.boundingBox();
	if (!box) return;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

// Smooth, eased scroll over `ms` so the page glides instead of jumping.
async function smoothScroll(page: Page, deltaY: number, ms = 1600): Promise<void> {
	const frames = Math.max(1, Math.round(ms / 16));
	const step = deltaY / frames;
	for (let i = 0; i < frames; i++) { await page.mouse.wheel(0, step); await sleep(16); }
}

async function clip(browser: Browser, storageState: string, name: string, fn: (p: Page) => Promise<void>): Promise<void> {
	const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, storageState: JSON.parse(storageState), recordVideo: { dir: REC, size: SIZE } });
	await ctx.addInitScript(CURSOR_SCRIPT);
	const page = await ctx.newPage();
	await page.mouse.move(SIZE.width / 2, SIZE.height / 2); // seed cursor
	await fn(page);
	const video = page.video();
	await ctx.close();
	if (video) { renameSync(await video.path(), join(REC, `${name}.webm`)); console.log(`  ✓ ${name}.webm`); }
}

async function main(): Promise<void> {
	rmSync(REC, { recursive: true, force: true });
	mkdirSync(REC, { recursive: true });
	const browser = await chromium.launch();

	const auth = await browser.newContext({ viewport: SIZE });
	const ap = await auth.newPage();
	await ap.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
	await ap.fill("[data-testid='signin-slug']", SLUG);
	await ap.fill("[data-testid='signin-email']", EMAIL);
	await ap.fill("[data-testid='signin-password']", PASSWORD);
	await Promise.all([ap.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {}), ap.click("[data-testid='signin-submit']")]);
	const storageState = JSON.stringify(await auth.storageState());
	await auth.close();

	// PLAN (~18s): dashboard, open branch picker, pick a branch, scroll the plan.
	await clip(browser, storageState, "plan", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/dashboard?branch=${BUKIT}&on_date=${ON_DATE}`, { waitUntil: "networkidle" });
		await p.waitForSelector("[data-testid^='row-sku-']", { timeout: 30000 }).catch(() => {});
		await sleep(1800);
		await glideTo(p, "[data-testid='branch-selector']");
		await sleep(500); await p.click("[data-testid='branch-selector']").catch(() => {});
		await sleep(1600);
		await p.keyboard.press("Escape").catch(() => {});
		await sleep(800);
		await smoothScroll(p, 520, 2600); await sleep(1500);
		await smoothScroll(p, 420, 2200); await sleep(2200);
		await smoothScroll(p, -500, 2000); await sleep(1500);
	});

	// INPUT (~10s): admin -> data screen, scroll.
	await clip(browser, storageState, "input", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/data`, { waitUntil: "networkidle" });
		await sleep(2200);
		await smoothScroll(p, 460, 2600); await sleep(1800);
		await smoothScroll(p, 360, 2200); await sleep(2400);
	});

	// REVIEW (~15s): harness, pick Bukit, click Run inspection, proposal appears.
	await clip(browser, storageState, "review", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
		await sleep(2200);
		// choose Bukit Bintang in the inspection branch <select>
		const sel = p.locator("select").first();
		await glideTo(p, "select");
		await sel.selectOption({ label: "Bukit Bintang" }).catch(() => {});
		await sleep(900);
		await glideTo(p, "[data-testid='harness-inspect-button']");
		await sleep(500);
		await p.click("[data-testid='harness-inspect-button']").catch(() => {});
		// inspection runs server-side, then the page refreshes with the proposal
		await p.waitForSelector("[data-testid='harness-proposal']", { timeout: 40000 }).catch(() => {});
		await sleep(2600);
		await smoothScroll(p, 260, 1800); await sleep(2600);
	});

	// APPROVE (~10s): harness, glide to Approve, click, show success.
	await clip(browser, storageState, "approve", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
		await p.waitForSelector("[data-testid='harness-approve']", { timeout: 30000 });
		await sleep(2400);
		await glideTo(p, "[data-testid='harness-approve']");
		await sleep(700);
		await p.locator("[data-testid='harness-approve']").first().click();
		await sleep(4500); // success state + refresh
	});

	await browser.close();
	console.log("recordings:", readdirSync(REC).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
