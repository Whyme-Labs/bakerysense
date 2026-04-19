import { test as base, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";

function canonicalize(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map(canonicalize).join(",") + "]";
  const rec = o as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(rec[k])).join(",") + "}";
}

function sign(body: unknown, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonicalize(body)).digest("hex");
}

const SEEDED = { done: false };

export const test = base.extend<object, { seeded: void }>({
  seeded: [async ({}, use) => {
    if (!SEEDED.done) {
      const secret = process.env.OPS_ROTATE_SECRET ?? "test-ops-secret";
      const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";
      const body = {};
      const res = await fetch(`${baseUrl}/api/admin/seed-demo`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ops-secret": sign(body, secret) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`seed-demo failed ${res.status}: ${await res.text()}`);
      }
      SEEDED.done = true;
    }
    await use();
  }, { scope: "worker", auto: true }],
});

export async function signIn(page: Page, email: string, password: string, slug: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('[data-testid="signin-email"]', email);
  await page.fill('[data-testid="signin-password"]', password);
  await page.fill('[data-testid="signin-slug"]', slug);
  await page.click('[data-testid="signin-submit"]');
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/`));
}

export const DEMO = {
  slug: "favorita",
  adminEmail: "demo@bakerysense.app",
  adminPassword: "Demo2026DemoDemo",
  managerEmail: "manager@bakerysense.app",
  managerPassword: "Manager2026Manager",
} as const;

export { expect };
