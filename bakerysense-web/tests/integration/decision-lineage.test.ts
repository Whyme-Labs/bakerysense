import { describe, it, expect, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { tenants, modelVersions, retrainEvents, forecastSnapshots, users } from "../../src/db/schema";
import {
  getOrCreateActiveModelVersion,
  recordRetrainQueued,
  markRetrainRunning,
  recordRetrainSucceeded,
  recordRetrainFailed,
  getDecisionLineage,
} from "../../src/lib/lineage";
import { writeForecastSnapshot } from "../../src/lib/snapshots";
import { writeActive } from "../../src/lib/model-pointer";

// Unique per-test tenant id avoids FK conflicts from stale rows in other
// tables (audit_log, branches, daily_actuals) that reference tenants.id.
let TENANT_ID = "";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
  const db = getDb(env as unknown as CloudflareEnv);
  const listed = await env.KV.list();
  await Promise.all(listed.keys.map((k) => env.KV.delete(k.name)));
  TENANT_ID = "tenant_lineage_" + crypto.randomUUID().slice(0, 8);
  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: TENANT_ID.slice(0, 30),
    name: "Lineage Test",
    vertical: "bakery",
    plan: "free",
    createdAt: Date.now(),
  });
});

describe("decision lineage — model_versions bootstrap", () => {
  it("bootstraps a model_versions row from the KV pointer when none exists", async () => {
    await writeActive(env as unknown as CloudflareEnv, TENANT_ID, {
      version: 7,
      treesR2Key: `tenant:${TENANT_ID}/models/v7/trees.json`,
      featuresR2Key: `tenant:${TENANT_ID}/models/v7/features.json`,
      trainedAt: 1700000000000,
      rollingMae: 4.2,
    });
    const mv = await getOrCreateActiveModelVersion(env as unknown as CloudflareEnv, TENANT_ID, "gbm_v1");
    expect(mv).toBeTruthy();
    expect(mv?.versionNumber).toBe(7);
    const db = getDb(env as unknown as CloudflareEnv);
    const [row] = await db.select().from(modelVersions).where(eq(modelVersions.id, mv!.id)).all();
    expect(row.tenantId).toBe(TENANT_ID);
    expect(row.modelKind).toBe("gbm_v1");
    expect(row.versionNumber).toBe(7);
    expect(row.r2Key).toBe(`tenant:${TENANT_ID}/models/v7/trees.json`);
    expect(row.status).toBe("active");
    expect(row.activatedAt).toBe(1700000000000);
    expect(row.notes).toMatch(/bootstrapped from KV pointer/);
    expect(JSON.parse(row.validationMetricsJson!)).toEqual({ rolling_mae: 4.2 });
  });

  it("returns the existing active row on subsequent calls (idempotent)", async () => {
    await writeActive(env as unknown as CloudflareEnv, TENANT_ID, {
      version: 1,
      treesR2Key: "trees",
      featuresR2Key: "features",
      trainedAt: 1700000000000,
    });
    const first = await getOrCreateActiveModelVersion(env as unknown as CloudflareEnv, TENANT_ID, "gbm_v1");
    const second = await getOrCreateActiveModelVersion(env as unknown as CloudflareEnv, TENANT_ID, "gbm_v1");
    expect(first?.id).toBe(second?.id);
  });

  it("bootstraps with version=1 when no KV pointer exists for non-gbm kinds", async () => {
    const mv = await getOrCreateActiveModelVersion(env as unknown as CloudflareEnv, TENANT_ID, "v1_5_prior");
    expect(mv?.versionNumber).toBe(1);
    const db = getDb(env as unknown as CloudflareEnv);
    const [row] = await db.select().from(modelVersions).where(eq(modelVersions.id, mv!.id)).all();
    expect(row.r2Key).toBeNull();
    expect(row.modelKind).toBe("v1_5_prior");
  });
});

describe("decision lineage — retrain event lifecycle", () => {
  it("records queued → running → succeeded with output_model_id linkage", async () => {
    await writeActive(env as unknown as CloudflareEnv, TENANT_ID, {
      version: 3,
      treesR2Key: "trees",
      featuresR2Key: "features",
      trainedAt: 1700000000000,
    });
    const parent = await getOrCreateActiveModelVersion(env as unknown as CloudflareEnv, TENANT_ID);

    // Create a user row so the triggered_by_user_id FK is satisfied.
    const userId = "user_" + crypto.randomUUID().slice(0, 8);
    const db = getDb(env as unknown as CloudflareEnv);
    await db.insert(users).values({
      id: userId,
      email: `${userId}@test.local`,
      passwordHash: "stub",
      emailVerified: 1,
      createdAt: Date.now(),
    });
    const queued = await recordRetrainQueued(env as unknown as CloudflareEnv, {
      tenantId: TENANT_ID,
      modelKind: "gbm_v1",
      triggeredBy: "manual",
      triggeredByUserId: userId,
      parentModelId: parent?.id ?? null,
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
    });

    await markRetrainRunning(env as unknown as CloudflareEnv, queued.id);
    const result = await recordRetrainSucceeded(env as unknown as CloudflareEnv, {
      eventId: queued.id,
      tenantId: TENANT_ID,
      modelKind: "gbm_v1",
      parentModelId: parent?.id ?? null,
      r2Key: `tenant:${TENANT_ID}/models/v4/trees.json`,
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
      trainingActualsCount: 142,
      validationMetrics: { wape: 0.21, mase: 0.62 },
    });

    expect(result.versionNumber).toBe(4); // parent was 3, so next is 4

    const [evRow] = await db.select().from(retrainEvents).where(eq(retrainEvents.id, queued.id)).all();
    expect(evRow.status).toBe("succeeded");
    expect(evRow.outputModelId).toBe(result.modelVersionId);
    expect(evRow.startedAt).toBeTruthy();
    expect(evRow.completedAt).toBeTruthy();

    const [parentRow] = await db.select().from(modelVersions).where(eq(modelVersions.id, parent!.id)).all();
    expect(parentRow.status).toBe("superseded");
    expect(parentRow.supersededAt).toBeTruthy();

    const [newRow] = await db.select().from(modelVersions).where(eq(modelVersions.id, result.modelVersionId)).all();
    expect(newRow.parentModelId).toBe(parent!.id);
    expect(newRow.trainingActualsCount).toBe(142);
    expect(JSON.parse(newRow.validationMetricsJson!)).toEqual({ wape: 0.21, mase: 0.62 });
  });

  it("records a failure with status_message set", async () => {
    const queued = await recordRetrainQueued(env as unknown as CloudflareEnv, {
      tenantId: TENANT_ID,
      modelKind: "gbm_v1",
      triggeredBy: "manual",
      trainingWindowStart: "2026-01-01",
      trainingWindowEnd: "2026-04-01",
    });
    await recordRetrainFailed(env as unknown as CloudflareEnv, {
      eventId: queued.id,
      reason: "training inputs CSV exceeded 25MB; refusing to upload",
    });
    const db = getDb(env as unknown as CloudflareEnv);
    const [row] = await db.select().from(retrainEvents).where(eq(retrainEvents.id, queued.id)).all();
    expect(row.status).toBe("failed");
    expect(row.statusMessage).toBe("training inputs CSV exceeded 25MB; refusing to upload");
    expect(row.outputModelId).toBeNull();
  });
});

describe("decision lineage — forecast snapshot linkage", () => {
  it("populates model_version_id automatically on writeForecastSnapshot", async () => {
    await writeActive(env as unknown as CloudflareEnv, TENANT_ID, {
      version: 1,
      treesR2Key: "trees",
      featuresR2Key: "features",
      trainedAt: 1700000000000,
    });
    // Insert a branch for FK validity.
    const db = getDb(env as unknown as CloudflareEnv);
    const { branches } = await import("../../src/db/schema");
    await db.insert(branches).values({
      id: "branch_lineage",
      tenantId: TENANT_ID,
      name: "Lineage Branch",
      createdAt: Date.now(),
    });

    await writeForecastSnapshot(env as unknown as CloudflareEnv, {
      tenantId: TENANT_ID,
      branchId: "branch_lineage",
      family: "TRADITIONAL BAGUETTE",
      date: "2026-04-29",
      modelVersion: 1,
      bakeQuantity: 116,
      quantiles: { "q0.5": 110, "q0.9": 124 },
    });

    const [snap] = await db.select().from(forecastSnapshots).where(
      eq(forecastSnapshots.tenantId, TENANT_ID),
    ).all();
    expect(snap.modelVersionId).toBeTruthy();

    const lineage = await getDecisionLineage(env as unknown as CloudflareEnv, snap.id);
    expect(lineage).toBeTruthy();
    expect(lineage!.modelVersion?.versionNumber).toBe(1);
    expect(lineage!.modelVersion?.modelKind).toBe("gbm_v1");
  });
});
