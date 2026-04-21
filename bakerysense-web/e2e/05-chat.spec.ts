import { test, expect, DEMO, signIn } from "./fixtures/demo-seed";

test.describe("Scenario 5: Chat with real Gemma 4", () => {
  // Runs against whichever backend PLAYWRIGHT_BASE_URL points at. Against the
  // deployed Worker with a real OPENROUTER_API_KEY connector, Gemma 4 responds
  // in ~10–25s. For offline CI, point at a Worker with BS_REPLAY_FIXTURES=1
  // and pre-recorded fixtures under R2 fixtures/llm/.
  test("prompt submit produces tool_call + answer bubbles", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, DEMO.adminEmail, DEMO.adminPassword, DEMO.slug);
    await page.locator('[data-testid="branch-selector"]').selectOption({ index: 0 });
    const branchId = new URL(page.url()).searchParams.get("branch");
    await page.goto(`/t/${DEMO.slug}/chat?branch=${branchId}`);

    await page.fill('[data-testid="prompt-input"]', "How many TRADITIONAL BAGUETTE should I bake tomorrow?");
    await page.click('[data-testid="prompt-submit"]');

    // A ToolTrace `<details>` appears once the forecast tool call fires.
    await expect(page.locator("details").filter({ hasText: /forecast/i }).first()).toBeVisible({ timeout: 60_000 });
    // Assistant bubble (final answer) appears after Gemma completes.
    await expect(page.locator('[data-testid="message-bubble-assistant"]').first()).toBeVisible({ timeout: 60_000 });
  });
});
