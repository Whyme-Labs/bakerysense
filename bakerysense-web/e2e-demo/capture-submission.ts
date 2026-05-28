// Captures high-res product screenshots for the UCWS submission deck + Drive.
//   npx tsx e2e-demo/capture-submission.ts
// Output: docs/submission/screenshots/*.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "https://bakerysense.swmengappdev.workers.dev";
const SLUG = "demo";
const EMAIL = "demo@bs.co";
const PASSWORD = "Password2026Password";
const BUKIT = "brn_fXfjy1wpy7y6";
const ON_DATE = "2026-05-29";
const OUT = join(__dirname, "..", "..", "docs", "submission", "screenshots");

async function main() {
	mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
	const page = await ctx.newPage();

	await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
	await page.fill("[data-testid='signin-slug']", SLUG);
	await page.fill("[data-testid='signin-email']", EMAIL);
	await page.fill("[data-testid='signin-password']", PASSWORD);
	await Promise.all([
		page.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {}),
		page.click("[data-testid='signin-submit']"),
	]);

	// 1. Dashboard bake plan (branch selected).
	await page.goto(`${BASE}/t/${SLUG}/dashboard?branch=${BUKIT}&on_date=${ON_DATE}`, { waitUntil: "networkidle" });
	await page.waitForSelector("[data-testid^='row-sku-']", { timeout: 30000 }).catch(() => {});
	await page.waitForTimeout(1000);
	await page.screenshot({ path: join(OUT, "dashboard-bakeplan.png") });

	// 2. Harness evolution page (full) + cards.
	await page.goto(`${BASE}/t/${SLUG}/admin/harness`, { waitUntil: "networkidle" });
	await page.waitForSelector("[data-testid='harness-proposal']", { timeout: 30000 });
	await page.waitForTimeout(800);
	await page.screenshot({ path: join(OUT, "harness-full.png") });
	const cards = page.locator("[data-testid='harness-proposal']");
	const n = await cards.count();
	if (n > 0) await cards.first().screenshot({ path: join(OUT, "harness-card-1.png") });
	if (n > 1) await cards.nth(1).screenshot({ path: join(OUT, "harness-card-2.png") });

	// 3. Model / decision-lineage page (technical depth).
	await page.goto(`${BASE}/t/${SLUG}/admin/retraining`, { waitUntil: "networkidle" }).catch(() => {});
	await page.waitForTimeout(1200);
	await page.screenshot({ path: join(OUT, "model-lineage.png") });

	console.log(`captured ${n} proposal cards; screenshots in ${OUT}`);
	await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
