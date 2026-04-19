import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 2: signin — demo admin lands on dashboard", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await expect(page).toHaveURL(new RegExp(`/t/${DEMO.slug}/dashboard`));
  await expect(page.locator('[data-testid="branch-selector"]')).toBeVisible();
});

test("Scenario 2b: wrong password stays on /signin with error", async ({ page }) => {
  await page.goto("/signin");
  await page.fill('[data-testid="signin-email"]', DEMO.adminEmail);
  await page.fill('[data-testid="signin-password"]', "wrong-password-here");
  await page.fill('[data-testid="signin-slug"]', DEMO.slug);
  await page.click('[data-testid="signin-submit"]');
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByText(/invalid credentials/i)).toBeVisible();
});
