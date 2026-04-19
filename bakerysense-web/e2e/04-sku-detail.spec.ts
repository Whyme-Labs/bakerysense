import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 4: SKU detail — charts + Ask-Gemma link", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });

  const firstRow = page.locator('[data-testid^="row-sku-"]').first();
  await firstRow.getByRole("link", { name: /drivers/i }).click();
  await expect(page).toHaveURL(/\/sku\//);

  // Quantile chart + driver bars sections. Match the heading text directly
  // so sections below the fold still assert presence without scrolling.
  await expect(page.getByRole("heading", { name: /Quantile band/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Top drivers/i })).toBeVisible();
  // Ask Gemma CTA
  const ask = page.getByRole("link", { name: /Ask Gemma why/i });
  await expect(ask).toHaveAttribute("href", /\/chat\?.*prefill=/);
});
