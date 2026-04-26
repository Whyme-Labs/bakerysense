import { describe, expect, it } from "vitest";
import {
  FEATURE_REGISTRY,
  V1_DEFAULT_AVAILABILITY,
  buildModelInput,
  featuresForLayer,
  featuresForStage,
  friendlyLabel,
  getFeature,
  maskFromList,
} from "../../src/lib/feature-registry";

describe("feature-registry", () => {
  it("has unique feature IDs", () => {
    const ids = FEATURE_REGISTRY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("V1 default availability covers exactly the v1_gbm layer", () => {
    const v1Layer = featuresForLayer("v1_gbm").map((f) => f.id);
    expect([...V1_DEFAULT_AVAILABILITY].sort()).toEqual([...v1Layer].sort());
  });

  it("friendly label falls back to humanised id for unknown features", () => {
    expect(friendlyLabel("lag_7")).toBe("Last week, same day");
    expect(friendlyLabel("totally_unknown_feature")).toBe("Totally Unknown Feature");
  });

  it("getFeature returns the spec for known IDs and null for unknown", () => {
    expect(getFeature("lag_7")?.source).toBe("autoregressive");
    expect(getFeature("nope")).toBeNull();
  });

  it("featuresForStage partitions by V1/V2/V3 cleanly", () => {
    const v1 = featuresForStage("v1");
    const v2 = featuresForStage("v2");
    const v3 = featuresForStage("v3");
    expect(v1.length).toBeGreaterThan(0);
    expect(v2.length).toBeGreaterThan(v1.length);
    expect(v3.length).toBeGreaterThan(0);
    // No feature appears in two stages.
    const seen = new Set<string>();
    for (const f of [...v1, ...v2, ...v3]) {
      expect(seen.has(f.id)).toBe(false);
      seen.add(f.id);
    }
  });

  it("buildModelInput respects the tenant availability mask", () => {
    const raw = { lag_7: 100, lag_28: 50, weather_temp_c: 22.5 };
    // Tenant has only lag_7; lag_28 and weather are out.
    const mask = maskFromList(["lag_7"]);
    const out = buildModelInput(raw, ["lag_7", "lag_28", "weather_temp_c"], mask);
    expect(out.lag_7).toBe(100);
    expect(out.lag_28).toBe(0);                  // numeric fallback
    expect(out.weather_temp_c).toBeNull();       // null = "model should mask"
  });

  it("buildModelInput substitutes fallback when tenant has the feature but value is missing", () => {
    const raw = {}; // no values at all
    const mask = maskFromList(["lag_7", "month"]);
    const out = buildModelInput(raw, ["lag_7", "month"], mask);
    expect(out.lag_7).toBe(0);   // lag fallback
    expect(out.month).toBe(1);   // month fallback (1-indexed)
  });

  it("buildModelInput drops features not in the registry", () => {
    const raw = { lag_7: 1, fake_feature: 99 };
    const mask = maskFromList(["lag_7", "fake_feature"]);
    const out = buildModelInput(raw, ["lag_7", "fake_feature"], mask);
    expect(out.lag_7).toBe(1);
    expect("fake_feature" in out).toBe(false);
  });
});
