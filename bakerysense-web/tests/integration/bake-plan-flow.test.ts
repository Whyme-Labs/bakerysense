import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { bakePlanDecisions, branches, forecastSnapshots } from "../../src/db/schema";
import { writeForecastSnapshot } from "../../src/lib/snapshots";
import { writeActive } from "../../src/lib/model-pointer";

interface AuthResult {
  cookieHeader: string;
  csrf: string;
  tenantSlug: string;
}

async function signupTenantAdmin(slug: string): Promise<AuthResult> {
  const res = await SELF.fetch("https://x.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `admin@${slug}.co`,
      password: "Password2026Password",
      tenantName: slug.toUpperCase(),
      tenantSlug: slug,
      vertical: "bakery",
    }),
  });
  expect(res.status).toBe(201);
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
  return { cookieHeader, csrf, tenantSlug: slug };
}

async function getTenantId(slug: string): Promise<string> {
  const db = getDb(env as unknown as CloudflareEnv);
  const { tenants } = await import("../../src/db/schema");
  const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).all();
  return row.id;
}

async function seedBranchAndSnapshot(tenantId: string, branchId: string, family: string, date: string): Promise<{ snapshotId: string }> {
  const db = getDb(env as unknown as CloudflareEnv);
  await db.insert(branches).values({
    id: branchId,
    tenantId,
    name: branchId,
    createdAt: Date.now(),
  });
  await writeActive(env as unknown as CloudflareEnv, tenantId, {
    version: 1,
    treesR2Key: "trees",
    featuresR2Key: "features",
    trainedAt: 1700000000000,
  });
  await writeForecastSnapshot(env as unknown as CloudflareEnv, {
    tenantId,
    branchId,
    family,
    date,
    modelVersion: 1,
    bakeQuantity: 116,
    quantiles: { "q0.1": 80, "q0.25": 90, "q0.5": 100, "q0.75": 110, "q0.9": 120 },
  });
  const [snap] = await db
    .select({ id: forecastSnapshots.id })
    .from(forecastSnapshots)
    .where(and(
      eq(forecastSnapshots.tenantId, tenantId),
      eq(forecastSnapshots.branchId, branchId),
      eq(forecastSnapshots.family, family),
      eq(forecastSnapshots.date, date),
    ))
    .all();
  return { snapshotId: snap.id };
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
  const listed = await env.KV.list();
  await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
});

describe("POST /api/bake-plans/commit", () => {
  it("commits a balanced plan and writes the lineage chain", async () => {
    const auth = await signupTenantAdmin("bp-a");
    const tenantId = await getTenantId(auth.tenantSlug);
    const { snapshotId } = await seedBranchAndSnapshot(tenantId, "br_bp_a", "BAGUETTE", "2026-04-29");

    const res = await SELF.fetch("https://x.test/api/bake-plans/commit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: auth.cookieHeader,
        "x-csrf-token": auth.csrf,
      },
      body: JSON.stringify({
        branchId: "br_bp_a",
        family: "BAGUETTE",
        date: "2026-04-29",
        optionKind: "balanced",
        bakeQuantity: 116,
        forecastSnapshotId: snapshotId,
        expected: { wasteUnits: 18, stockoutProb: 0.25, unitsSold: 98 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; optionKind: string; bakeQuantity: number };
    expect(body.optionKind).toBe("balanced");
    expect(body.bakeQuantity).toBe(116);

    // Verify the row was written with the lineage links.
    const db = getDb(env as unknown as CloudflareEnv);
    const [row] = await db
      .select()
      .from(bakePlanDecisions)
      .where(eq(bakePlanDecisions.id, body.id))
      .all();
    expect(row.tenantId).toBe(tenantId);
    expect(row.optionKind).toBe("balanced");
    expect(row.bakeQuantity).toBe(116);
    expect(row.forecastSnapshotId).toBe(snapshotId);
    expect(row.modelVersionId).toBeTruthy(); // denormalised from snapshot
    expect(row.expectedWasteUnits).toBe("18");
    expect(row.expectedStockoutProb).toBe("0.25");
  });

  it("re-commits for the same SKU-day overwrites idempotently", async () => {
    const auth = await signupTenantAdmin("bp-idem");
    const tenantId = await getTenantId(auth.tenantSlug);
    const { snapshotId } = await seedBranchAndSnapshot(tenantId, "br_bp_idem", "BAGUETTE", "2026-04-29");

    async function postCommit(optionKind: string, bakeQuantity: number) {
      return SELF.fetch("https://x.test/api/bake-plans/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: auth.cookieHeader,
          "x-csrf-token": auth.csrf,
        },
        body: JSON.stringify({
          branchId: "br_bp_idem",
          family: "BAGUETTE",
          date: "2026-04-29",
          optionKind,
          bakeQuantity,
          forecastSnapshotId: snapshotId,
        }),
      });
    }

    const r1 = await postCommit("conservative", 90);
    expect(r1.status).toBe(200);
    const r2 = await postCommit("aggressive", 140);
    expect(r2.status).toBe(200);

    // Only one row per (tenant, branch, family, date) — the unique index.
    const db = getDb(env as unknown as CloudflareEnv);
    const rows = await db
      .select()
      .from(bakePlanDecisions)
      .where(and(
        eq(bakePlanDecisions.tenantId, tenantId),
        eq(bakePlanDecisions.branchId, "br_bp_idem"),
        eq(bakePlanDecisions.family, "BAGUETTE"),
        eq(bakePlanDecisions.date, "2026-04-29"),
      ))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].optionKind).toBe("aggressive");
    expect(rows[0].bakeQuantity).toBe(140);
  });

  it("rejects a cross-tenant snapshot id with 404", async () => {
    const a = await signupTenantAdmin("bp-iso-a");
    const tenantA = await getTenantId(a.tenantSlug);
    const { snapshotId: snapA } = await seedBranchAndSnapshot(tenantA, "br_iso_a", "BAGUETTE", "2026-04-29");

    const b = await signupTenantAdmin("bp-iso-b");
    const tenantB = await getTenantId(b.tenantSlug);
    // Tenant B has its own branch (so we don't fail on branch scope first).
    const db = getDb(env as unknown as CloudflareEnv);
    await db.insert(branches).values({
      id: "br_iso_b",
      tenantId: tenantB,
      name: "br_iso_b",
      createdAt: Date.now(),
    });

    const res = await SELF.fetch("https://x.test/api/bake-plans/commit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: b.cookieHeader,
        "x-csrf-token": b.csrf,
      },
      body: JSON.stringify({
        branchId: "br_iso_b",
        family: "BAGUETTE",
        date: "2026-04-29",
        optionKind: "balanced",
        bakeQuantity: 100,
        forecastSnapshotId: snapA, // snapshot belongs to tenant A
      }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated commit with 401", async () => {
    const res = await SELF.fetch("https://x.test/api/bake-plans/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branchId: "br_anon",
        family: "BAGUETTE",
        date: "2026-04-29",
        optionKind: "balanced",
        bakeQuantity: 100,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects without CSRF with 403", async () => {
    const auth = await signupTenantAdmin("bp-csrf");
    const tenantId = await getTenantId(auth.tenantSlug);
    await seedBranchAndSnapshot(tenantId, "br_csrf", "BAGUETTE", "2026-04-29");

    const res = await SELF.fetch("https://x.test/api/bake-plans/commit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: auth.cookieHeader,
        // deliberately omit x-csrf-token
      },
      body: JSON.stringify({
        branchId: "br_csrf",
        family: "BAGUETTE",
        date: "2026-04-29",
        optionKind: "balanced",
        bakeQuantity: 100,
      }),
    });
    expect(res.status).toBe(403);
  });
});
