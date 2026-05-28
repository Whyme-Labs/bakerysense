// Captures high-res screenshots of the live /harness review page for use as
// Ken Burns shots in the HarnessStory Remotion composition.
//
//   npx tsx e2e-demo/capture-harness.ts
//
// Output: e2e-demo/video/public/captures/*.png (staticFile-loadable).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "https://bakerysense.swmengappdev.workers.dev";
const SLUG = process.env.DEMO_SLUG ?? "demo";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@bs.co";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Password2026Password";
const OUT = join(__dirname, "video", "public", "captures");

async function main() {
	mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	});
	const page = await ctx.newPage();

	// Sign in.
	await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
	await page.fill("[data-testid='signin-slug']", SLUG);
	await page.fill("[data-testid='signin-email']", EMAIL);
	await page.fill("[data-testid='signin-password']", PASSWORD);
	await Promise.all([
		page.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {}),
		page.click("[data-testid='signin-submit']"),
	]);

	// Harness review page.
	await page.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
	await page.waitForSelector("[data-testid='harness-proposal']", { timeout: 30000 });
	await page.waitForTimeout(800);

	// 1. Full page — both pending proposals.
	await page.screenshot({ path: join(OUT, "harness-full.png") });

	// 2. The proposals list region (crop to the cards).
	const proposals = page.locator("[data-testid='harness-proposal']");
	const count = await proposals.count();
	console.log(`captured ${count} proposal cards`);
	if (count > 0) {
		await proposals.first().screenshot({ path: join(OUT, "harness-card-1.png") });
	}
	if (count > 1) {
		await proposals.nth(1).screenshot({ path: join(OUT, "harness-card-2.png") });
	}

	await browser.close();
	console.log("Wrote captures to", OUT);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
