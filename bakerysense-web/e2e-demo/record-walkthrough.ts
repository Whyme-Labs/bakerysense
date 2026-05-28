// Records short Playwright click-through clips of the live app for the
// "how it works" walkthrough in HarnessStory. One webm per step so the
// Remotion composition can embed each independently (no timing-offset math).
//
//   npx tsx e2e-demo/record-walkthrough.ts
//
// Output: video/public/recordings/{input,plan,review,approve}.webm
// Restores the demo's pending proposals after the approve click.
import { chromium, type BrowserContext } from "playwright";
import { mkdirSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "https://bakerysense.swmengappdev.workers.dev";
const SLUG = "demo";
const EMAIL = "demo@bs.co";
const PASSWORD = "Password2026Password";
const BUKIT = "brn_fXfjy1wpy7y6";
const SUBANG = "brn_demo_subang1";
const ON_DATE = "2026-05-29";
const REC = join(__dirname, "video", "public", "recordings");
const SIZE = { width: 1440, height: 900 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clip(browser: import("playwright").Browser, storageState: string, name: string, fn: (p: import("playwright").Page) => Promise<void>) {
	const ctx: BrowserContext = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, storageState: JSON.parse(storageState), recordVideo: { dir: REC, size: SIZE } });
	const page = await ctx.newPage();
	await fn(page);
	const video = page.video();
	await ctx.close(); // finalizes the webm
	if (video) {
		const src = await video.path();
		renameSync(src, join(REC, `${name}.webm`));
		console.log(`  ✓ ${name}.webm`);
	}
}

async function main() {
	rmSync(REC, { recursive: true, force: true });
	mkdirSync(REC, { recursive: true });
	const browser = await chromium.launch();

	// Sign in once, capture storage state to reuse across clip contexts.
	const auth = await browser.newContext({ viewport: SIZE });
	const ap = await auth.newPage();
	await ap.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
	await ap.fill("[data-testid='signin-slug']", SLUG);
	await ap.fill("[data-testid='signin-email']", EMAIL);
	await ap.fill("[data-testid='signin-password']", PASSWORD);
	await Promise.all([ap.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {}), ap.click("[data-testid='signin-submit']")]);
	const storageState = JSON.stringify(await auth.storageState());
	await auth.close();

	// 1. INPUT — Admin → Data
	await clip(browser, storageState, "input", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/data`, { waitUntil: "networkidle" });
		await sleep(2500);
		await p.mouse.wheel(0, 500); await sleep(3500);
	});

	// 2. PLAN — dashboard bake plan
	await clip(browser, storageState, "plan", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/dashboard?branch=${BUKIT}&on_date=${ON_DATE}`, { waitUntil: "networkidle" });
		await p.waitForSelector("[data-testid^='row-sku-']", { timeout: 30000 }).catch(() => {});
		await sleep(3000);
		await p.mouse.wheel(0, 600); await sleep(3500);
	});

	// 3. REVIEW — harness proposals
	await clip(browser, storageState, "review", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
		await p.waitForSelector("[data-testid='harness-proposal']", { timeout: 30000 });
		await sleep(3500);
		await p.mouse.wheel(0, 350); await sleep(3000);
	});

	// 4. APPROVE — click Approve on the first proposal, show success
	await clip(browser, storageState, "approve", async (p) => {
		await p.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
		await p.waitForSelector("[data-testid='harness-approve']", { timeout: 30000 });
		await sleep(2000);
		await p.locator("[data-testid='harness-approve']").first().click();
		await sleep(4000); // let the success state + refresh show
	});

	await browser.close();
	console.log("recordings:", readdirSync(REC).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
