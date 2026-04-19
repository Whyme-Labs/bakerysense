import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 3: dashboard — bake plan + branch selector + close-out button", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  const selector = page.locator('[data-testid="branch-selector"]');
  await expect(selector).toBeVisible();
  await selector.selectOption({ index: 0 });
  await expect(page).toHaveURL(/branch=brn_/);

  const rows = page.locator('[data-testid^="row-sku-"]');
  await expect(rows.first()).toBeVisible();
  // Each row has a ConfidenceBar SVG
  await expect(rows.first().locator("svg").first()).toBeVisible();
  // Close-out trigger
  await expect(page.getByRole("button", { name: /Close out today/i })).toBeVisible();
});
