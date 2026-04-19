import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test("Scenario 7: sign out → /signin + subsequent dashboard access blocked", async ({ page }) => {
  await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
  await page.click('[data-testid="user-menu-signout"]');
  await expect(page).toHaveURL(/\/signin/);

  await page.goto(`/t/${DEMO.slug}/dashboard`);
  await expect(page).toHaveURL(/\/signin/);
});
