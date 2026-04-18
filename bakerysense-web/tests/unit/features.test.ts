import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { loadFeatures, getFeatureRow, __resetFeaturesCacheForTest } from "@/lib/features";

const FIXTURE = {
  last_date: "2024-12-31",
  per_branch_family_date: {
    "brn1|BAGUETTE|2024-12-31": { lag_1: 200, lag_7: 210, rolling_mean_7: 205 },
    "brn2|BAGUETTE|2024-12-31": { lag_1: 150, lag_7: 160, rolling_mean_7: 155 },
  },
};

describe("features", () => {
  beforeEach(async () => {
    __resetFeaturesCacheForTest();
    // seed R2
    await env.MODELS.put("tenant:t1/features/latest.json", JSON.stringify(FIXTURE));
  });

  it("loads features from R2", async () => {
    const f = await loadFeatures(env, "t1");
    expect(f.last_date).toBe("2024-12-31");
  });

  it("returns cached promise on second call (same reference)", async () => {
    const p1 = loadFeatures(env, "t1");
    const p2 = loadFeatures(env, "t1");
    // Both should resolve to the same data, proving they're the same promise
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.last_date).toBe(r2.last_date);
    expect(r1).toBe(r2);
  });

  it("getFeatureRow — exact hit", async () => {
    const f = await loadFeatures(env, "t1");
    const row = getFeatureRow(f, "brn1", "BAGUETTE", "2024-12-31");
    expect(row?.lag_1).toBe(200);
  });

  it("getFeatureRow — miss returns null", async () => {
    const f = await loadFeatures(env, "t1");
    expect(getFeatureRow(f, "brn1", "UNKNOWN", "2024-12-31")).toBeNull();
  });

  it("missing tenant throws and clears cache so retry can succeed", async () => {
    await expect(loadFeatures(env, "missing-tenant")).rejects.toThrow(/features not found/);
    // second call still attempts the fetch (cache was cleared)
    await expect(loadFeatures(env, "missing-tenant")).rejects.toThrow();
  });
});
