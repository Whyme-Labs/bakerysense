import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { getDb } from "../../src/db/client";
import { dailyActuals, forecastSnapshots } from "../../src/db/schema";

interface AuthResult {
  cookieHeader: string;
  csrf: string;
  tenantId: string;
}

/** Returns a date string N days ago (YYYY-MM-DD). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

/** Signup and return auth cookies + CSRF token + tenantId. */
async function signupAndGetAuth(
  email = "t@t.co",
  password = "Password2026Password",
  slug = "t",
): Promise<AuthResult> {
  const res = await SELF.fetch("https://x.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      tenantName: slug.toUpperCase(),
      tenantSlug: slug,
      vertical: "bakery",
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { tenantId: string; userId: string };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const parts = setCookie.split(",").map((s) => s.trim());
  const cookies: Record<string, string> = {};
  for (const part of parts) {
    const nameVal = part.split(";")[0];
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx !== -1) {
      const k = nameVal.slice(0, eqIdx).trim();
      const v = nameVal.slice(eqIdx + 1).trim();
      if (k) cookies[k] = v;
    }
  }
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const csrf = cookies["bs_csrf"] ? decodeURIComponent(cookies["bs_csrf"]) : "";
  return { cookieHeader, csrf, tenantId: body.tenantId };
}

/** Create a branch and return its id. */
async function createBranch(
  cookieHeader: string,
  csrf: string,
  name = "Main",
): Promise<string> {
  const res = await SELF.fetch("https://x.test/api/branches", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("metrics rolling WAPE", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.MIGRATIONS);
    const listed = await env.KV.list();
    await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  });

  it("GET /api/actuals/metrics returns correct WAPE for 3 seeded matched days", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth("mw1@x.co", "Password2026Password", "mw1");
    const branchId = await createBranch(cookieHeader, csrf, "Main");
    const db = getDb(env);

    // Seed 3 days using daysAgo(0), daysAgo(1), daysAgo(2)
    // WAPE = sum(|predicted - actual|) / sum(|actual|)
    // Day 0: predicted=120, actual=100, absErr=20
    // Day 1: predicted=90,  actual=80,  absErr=10
    // Day 2: predicted=110, actual=100, absErr=10
    // WAPE = (20+10+10) / (100+80+100) = 40/280 ≈ 0.142857...
    const days = [daysAgo(0), daysAgo(1), daysAgo(2)];
    const actuals = [100, 80, 100];
    const predicted = [120, 90, 110];

    for (let i = 0; i < 3; i++) {
      await db.insert(dailyActuals).values({
        id: `act_mw1_${i}`,
        tenantId,
        branchId,
        family: "BAGUETTE",
        date: days[i],
        actualSales: actuals[i],
        source: "manual",
        capturedByUserId: null,
        capturedAt: Date.now(),
      });
      await db.insert(forecastSnapshots).values({
        id: `fcs_mw1_${i}`,
        tenantId,
        branchId,
        family: "BAGUETTE",
        date: days[i],
        modelVersion: 0,
        bakeQuantity: predicted[i],
        quantilesJson: JSON.stringify({ "q0.5": predicted[i], "q0.7": predicted[i] + 10, "q0.9": predicted[i] + 20 }),
        servedAt: Date.now(),
      });
    }

    const res = await SELF.fetch(
      `https://x.test/api/actuals/metrics?branch=${branchId}&window=7`,
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      window: number;
      entries: Array<{ family: string; wape: number; sampleCount: number }>;
    };
    expect(body.entries.length).toBeGreaterThan(0);
    const baguette = body.entries.find((e) => e.family === "BAGUETTE");
    expect(baguette).toBeTruthy();
    expect(baguette!.sampleCount).toBe(3);
    // WAPE = 40/280 ≈ 0.142857
    const expectedWape = 40 / 280;
    expect(baguette!.wape).toBeCloseTo(expectedWape, 5);
  });

  it("No matched forecasts → sampleCount: 0 and wape: 0", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth("mw2@x.co", "Password2026Password", "mw2");
    const branchId = await createBranch(cookieHeader, csrf, "Main");
    const db = getDb(env);

    // Seed actuals but no forecast snapshots — no match possible
    await db.insert(dailyActuals).values({
      id: "act_mw2_0",
      tenantId,
      branchId,
      family: "PAIN",
      date: daysAgo(1),
      actualSales: 50,
      source: "manual",
      capturedByUserId: null,
      capturedAt: Date.now(),
    });

    const res = await SELF.fetch(
      `https://x.test/api/actuals/metrics?branch=${branchId}&window=7`,
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ family: string; wape: number; sampleCount: number }>;
    };
    // PAIN family should appear with sampleCount 0 and wape 0
    const pain = body.entries.find((e) => e.family === "PAIN");
    expect(pain).toBeTruthy();
    expect(pain!.sampleCount).toBe(0);
    expect(pain!.wape).toBe(0);
  });

  it("?family=BAGUETTE filters to just that family", async () => {
    const { cookieHeader, csrf, tenantId } = await signupAndGetAuth("mw3@x.co", "Password2026Password", "mw3");
    const branchId = await createBranch(cookieHeader, csrf, "Main");
    const db = getDb(env);

    const date = daysAgo(1);
    // Seed two families
    for (const family of ["BAGUETTE", "CROISSANT"]) {
      await db.insert(dailyActuals).values({
        id: `act_mw3_${family}`,
        tenantId,
        branchId,
        family,
        date,
        actualSales: 100,
        source: "manual",
        capturedByUserId: null,
        capturedAt: Date.now(),
      });
      await db.insert(forecastSnapshots).values({
        id: `fcs_mw3_${family}`,
        tenantId,
        branchId,
        family,
        date,
        modelVersion: 0,
        bakeQuantity: 120,
        quantilesJson: JSON.stringify({ "q0.5": 110 }),
        servedAt: Date.now(),
      });
    }

    const res = await SELF.fetch(
      `https://x.test/api/actuals/metrics?branch=${branchId}&window=7&family=BAGUETTE`,
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ family: string }>;
    };
    expect(body.entries.every((e) => e.family === "BAGUETTE")).toBe(true);
    expect(body.entries.some((e) => e.family === "CROISSANT")).toBe(false);
  });

  it("Unauthenticated → 401", async () => {
    const res = await SELF.fetch("https://x.test/api/actuals/metrics?branch=brn_test&window=7");
    expect(res.status).toBe(401);
  });

  it("?window=1000 → 400 (out of range)", async () => {
    const { cookieHeader } = await signupAndGetAuth("mw4@x.co", "Password2026Password", "mw4");
    const res = await SELF.fetch(
      "https://x.test/api/actuals/metrics?branch=brn_test&window=1000",
      { headers: { cookie: cookieHeader } },
    );
    expect(res.status).toBe(400);
  });
});
