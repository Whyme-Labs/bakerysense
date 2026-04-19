import { test, expect } from "./fixtures/demo-seed";

test.describe("Scenario 1: Landing", () => {
  test("loads hero, stats, sample exchange; CTAs link to /signin + /signup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /AI production copilot/i })).toBeVisible();

    // STATS grid — assert all four cards render
    await expect(page.getByText(/−27% WAPE/)).toBeVisible();
    await expect(page.getByText(/19 \/ 20/)).toBeVisible();
    await expect(page.getByText(/700 \/ 700/)).toBeVisible();

    // Sample exchange section
    await expect(page.getByText(/Manager:/)).toBeVisible();
    await expect(page.getByText(/BakerySense:/)).toBeVisible();

    // CTA links
    await expect(page.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/signin");
    await expect(page.getByRole("link", { name: /Create a tenant/i })).toHaveAttribute("href", "/signup");
  });
});
