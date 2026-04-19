import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test.describe("Scenario 5: Chat with SSE replay", () => {
  test.fixme(true, "requires recorded Gemma fixtures — run `npm run test:e2e:update-fixtures` with OPENROUTER_API_KEY in .dev.vars to seed fixtures/llm/");

  test("prompt submit produces tool_call + answer bubbles", async ({ page }) => {
    await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
    await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
    const branchId = new URL(page.url()).searchParams.get("branch");
    await page.goto(`/t/${DEMO.slug}/chat?branch=${branchId}`);

    await page.fill('[data-testid="prompt-input"]', "What should I bake tomorrow for TRADITIONAL BAGUETTE?");
    await page.click('[data-testid="prompt-submit"]');

    // Tool trace + assistant bubble appear within 30s
    await expect(page.locator("details").filter({ hasText: /forecast/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="message-bubble-assistant"]').first()).toBeVisible({ timeout: 30_000 });
  });
});
