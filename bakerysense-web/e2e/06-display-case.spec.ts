import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";
import path from "node:path";

test.describe("Scenario 6: Display case photo upload", () => {
  test.fixme(true, "requires recorded vision fixtures + e2e/fixtures/shelf.jpg");

  test("photo upload surfaces counts + markdowns + Chat-about-this link", async ({ page }) => {
    await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
    await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
    const branchId = new URL(page.url()).searchParams.get("branch");
    await page.goto(`/t/${DEMO.slug}/display-case?branch=${branchId}`);

    await page.setInputFiles('[data-testid="photo-upload-input"]', path.resolve(__dirname, "fixtures/shelf.jpg"));
    await page.click('[data-testid="photo-upload-submit"]');

    await expect(page.locator('[data-testid="counts-table"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="markdown-list"]')).toBeVisible();
    await expect(page.getByRole("link", { name: /Chat about this/i })).toHaveAttribute("href", /\/chat\?.*prefill=/);
  });
});
