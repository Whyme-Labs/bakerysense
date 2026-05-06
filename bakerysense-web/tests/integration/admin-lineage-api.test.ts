import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { branches, forecastSnapshots } from "../../src/db/schema";
import { writeForecastSnapshot } from "../../src/lib/snapshots";
import { writeActive } from "../../src/lib/model-pointer";
import {
  recordRetrainQueued,
  recordRetrainSucceeded,
} from "../../src/lib/lineage";

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

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
  const listed = await env.KV.list();
  await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
});

describe("GET /api/admin/lineage", () => {
  it("returns recent model_versions and retrain_events for the caller's tenant only", async () => {
    const auth = await signupTenantAdmin("lin-a");
    const tenantId = await getTenantId(auth.tenantSlug);

    // Seed lineage rows directly via the helpers — fastest path that exercises
    // the real production code path (bootstrap from KV pointer + supersession).
    await writeActive(env as unknown as CloudflareEnv, tenantId, {
      version: 1,
      treesR2Key: `tenant:${tenantId}/trees`,
      featuresR2Key: `tenant:${tenantId}/features`,
      trainedAt: 1700000000000,
      rollingMae: 5.0,
    });
    const queued = await recordRetrainQueued(env as unknown as CloudflareEnv, {
      tenantId,
      modelKind: "gbm_v1",
      triggeredBy: "manual",
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
    });
    await recordRetrainSucceeded(env as unknown as CloudflareEnv, {
      eventId: queued.id,
      tenantId,
      modelKind: "gbm_v1",
      parentModelId: null,
      r2Key: `tenant:${tenantId}/trees/v2.json`,
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
      trainingActualsCount: 100,
      validationMetrics: { wape: 0.21, mase: 0.62 },
    });

    const res = await SELF.fetch("https://x.test/api/admin/lineage", {
      method: "GET",
      headers: { cookie: auth.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      modelVersions: Array<{ versionNumber: number; status: string; validationMetrics: Record<string, number> | null }>;
      retrainEvents: Array<{ status: string; triggeredBy: string; outputModelId: string | null }>;
    };
    expect(body.modelVersions.length).toBeGreaterThanOrEqual(1);
    // Most recent first — that's the new active row.
    expect(body.modelVersions[0].status).toBe("active");
    expect(body.modelVersions[0].validationMetrics).toEqual({ wape: 0.21, mase: 0.62 });
    expect(body.retrainEvents.length).toBe(1);
    expect(body.retrainEvents[0].status).toBe("succeeded");
    expect(body.retrainEvents[0].outputModelId).toBeTruthy();
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await SELF.fetch("https://x.test/api/admin/lineage", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("isolates tenants — tenant B cannot see tenant A's lineage", async () => {
    const a = await signupTenantAdmin("lin-isoa");
    const tenantA = await getTenantId(a.tenantSlug);
    await recordRetrainQueued(env as unknown as CloudflareEnv, {
      tenantId: tenantA,
      modelKind: "gbm_v1",
      triggeredBy: "manual",
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
    });

    const b = await signupTenantAdmin("lin-isob");
    const res = await SELF.fetch("https://x.test/api/admin/lineage", {
      method: "GET",
      headers: { cookie: b.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { modelVersions: unknown[]; retrainEvents: unknown[] };
    expect(body.modelVersions).toEqual([]);
    expect(body.retrainEvents).toEqual([]);
  });

  it("respects the limit query param (cap 100)", async () => {
    const auth = await signupTenantAdmin("lin-lim");
    const tenantId = await getTenantId(auth.tenantSlug);
    for (let i = 0; i < 5; i++) {
      await recordRetrainQueued(env as unknown as CloudflareEnv, {
        tenantId,
        modelKind: "gbm_v1",
        triggeredBy: "manual",
        trainingWindowStart: "2026-01-01",
        trainingWindowEnd: "2026-04-01",
      });
    }
    const res = await SELF.fetch("https://x.test/api/admin/lineage?limit=2", {
      method: "GET",
      headers: { cookie: auth.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retrainEvents: unknown[] };
    expect(body.retrainEvents.length).toBe(2);
  });
});

describe("GET /api/admin/lineage/:snapshotId", () => {
  it("returns the full chain for a snapshot in the caller's tenant", async () => {
    const auth = await signupTenantAdmin("lin-snap");
    const tenantId = await getTenantId(auth.tenantSlug);

    // Tenant infra: branch + active model pointer so writeForecastSnapshot
    // can resolve a model_versions row.
    const db = getDb(env as unknown as CloudflareEnv);
    const branchId = "branch_snap_test";
    await db.insert(branches).values({
      id: branchId,
      tenantId,
      name: "Lineage Snap Branch",
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
      family: "TRADITIONAL BAGUETTE",
      date: "2026-04-29",
      modelVersion: 1,
      bakeQuantity: 116,
      quantiles: { "q0.5": 110, "q0.9": 124 },
    });

    const [snap] = await db
      .select({ id: forecastSnapshots.id })
      .from(forecastSnapshots)
      .where(eq(forecastSnapshots.tenantId, tenantId))
      .all();

    const res = await SELF.fetch(`https://x.test/api/admin/lineage/${snap.id}`, {
      method: "GET",
      headers: { cookie: auth.cookieHeader },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshotId: string;
      modelVersion: { versionNumber: number; modelKind: string } | null;
    };
    expect(body.snapshotId).toBe(snap.id);
    expect(body.modelVersion?.versionNumber).toBe(1);
    expect(body.modelVersion?.modelKind).toBe("gbm_v1");
  });

  it("returns 404 when the snapshot belongs to a different tenant (no information leak)", async () => {
    const a = await signupTenantAdmin("lin-snapa");
    const tenantA = await getTenantId(a.tenantSlug);

    const db = getDb(env as unknown as CloudflareEnv);
    await db.insert(branches).values({
      id: "branch_a",
      tenantId: tenantA,
      name: "A",
      createdAt: Date.now(),
    });
    await writeActive(env as unknown as CloudflareEnv, tenantA, {
      version: 1,
      treesR2Key: "trees",
      featuresR2Key: "features",
      trainedAt: 1700000000000,
    });
    await writeForecastSnapshot(env as unknown as CloudflareEnv, {
      tenantId: tenantA,
      branchId: "branch_a",
      family: "BAGUETTE",
      date: "2026-04-29",
      modelVersion: 1,
      bakeQuantity: 50,
      quantiles: { "q0.5": 48 },
    });
    const [snap] = await db
      .select({ id: forecastSnapshots.id })
      .from(forecastSnapshots)
      .where(eq(forecastSnapshots.tenantId, tenantA))
      .all();

    const b = await signupTenantAdmin("lin-snapb");
    const res = await SELF.fetch(`https://x.test/api/admin/lineage/${snap.id}`, {
      method: "GET",
      headers: { cookie: b.cookieHeader },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown snapshot id", async () => {
    const auth = await signupTenantAdmin("lin-404");
    const res = await SELF.fetch("https://x.test/api/admin/lineage/fcs_doesnotexist", {
      method: "GET",
      headers: { cookie: auth.cookieHeader },
    });
    expect(res.status).toBe(404);
  });
});
