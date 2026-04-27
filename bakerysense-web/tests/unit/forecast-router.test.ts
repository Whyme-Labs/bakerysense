import { describe, expect, it } from "vitest";
import {
  classifyStage,
  bandMultiplier,
  bannerFor,
  widenQuantiles,
  priorToQuantileMap,
  coldStartForecast,
  alphaForBlending,
  alphaForQuantile,
  blendQuantiles,
} from "../../src/lib/forecast-router";
import { priorForecast } from "../../src/lib/corpus-prior";

describe("forecast-router stage classification", () => {
  it("0 actuals → no_data", () => {
    expect(classifyStage(0)).toBe("no_data");
  });

  it("1–29 actuals → cold", () => {
    expect(classifyStage(1)).toBe("cold");
    expect(classifyStage(29)).toBe("cold");
  });

  it("30–89 actuals → warm", () => {
    expect(classifyStage(30)).toBe("warm");
    expect(classifyStage(89)).toBe("warm");
  });

  it("90+ actuals → mature", () => {
    expect(classifyStage(90)).toBe("mature");
    expect(classifyStage(1000)).toBe("mature");
  });

  it("band multiplier shrinks monotonically as data accumulates", () => {
    expect(bandMultiplier("no_data")).toBeGreaterThan(bandMultiplier("cold"));
    expect(bandMultiplier("cold")).toBeGreaterThan(bandMultiplier("warm"));
    expect(bandMultiplier("warm")).toBeGreaterThan(bandMultiplier("mature"));
    expect(bandMultiplier("mature")).toBe(1.0);
  });

  it("banners are non-empty for every stage", () => {
    for (const stage of ["no_data", "cold", "warm", "mature"] as const) {
      expect(bannerFor(stage).length).toBeGreaterThan(20);
    }
  });
});

describe("widenQuantiles", () => {
  it("preserves the median exactly", () => {
    const q = { "q0.1": 50, "q0.3": 70, "q0.5": 100, "q0.7": 130, "q0.9": 150 };
    const wide = widenQuantiles(q, 1.5);
    expect(wide["q0.5"]).toBe(100);
  });

  it("multiplier=1 is a no-op", () => {
    const q = { "q0.1": 50, "q0.3": 70, "q0.5": 100, "q0.7": 130, "q0.9": 150 };
    const out = widenQuantiles(q, 1.0);
    expect(out).toEqual(q);
  });

  it("multiplier>1 widens the spread symmetrically about the median", () => {
    const q = { "q0.1": 80, "q0.5": 100, "q0.9": 120 };
    const wide = widenQuantiles(q, 1.5);
    expect(wide["q0.1"]).toBe(100 + (80 - 100) * 1.5);   // 70
    expect(wide["q0.9"]).toBe(100 + (120 - 100) * 1.5);  // 130
  });

  it("clamps lower quantiles at 0 even when widening drives them negative", () => {
    const q = { "q0.1": 5, "q0.5": 10, "q0.9": 15 };
    const wide = widenQuantiles(q, 5.0);
    expect(wide["q0.1"]).toBeGreaterThanOrEqual(0);
  });
});

describe("priorToQuantileMap", () => {
  it("anchors q0.1, q0.3, q0.5, q0.7, q0.9 from the prior", () => {
    const p = { q10: 50, q30: 70, q50: 100, q70: 130, q90: 160 };
    const m = priorToQuantileMap(p);
    expect(m["q0.1"]).toBe(50);
    expect(m["q0.3"]).toBe(70);
    expect(m["q0.5"]).toBe(100);
    expect(m["q0.7"]).toBe(130);
    expect(m["q0.9"]).toBe(160);
  });

  it("fills q0.2/q0.4/q0.6/q0.8 by linear interpolation", () => {
    const p = { q10: 0, q30: 100, q50: 200, q70: 300, q90: 400 };
    const m = priorToQuantileMap(p);
    expect(m["q0.2"]).toBe(50);
    expect(m["q0.4"]).toBe(150);
    expect(m["q0.6"]).toBe(250);
    expect(m["q0.8"]).toBe(350);
  });

  it("output is monotonically non-decreasing across all 9 quantiles", () => {
    const p = { q10: 50, q30: 70, q50: 100, q70: 130, q90: 160 };
    const m = priorToQuantileMap(p);
    const ks = ["q0.1","q0.2","q0.3","q0.4","q0.5","q0.6","q0.7","q0.8","q0.9"];
    for (let i = 1; i < ks.length; i++) {
      expect(m[ks[i]]).toBeGreaterThanOrEqual(m[ks[i - 1]]);
    }
  });
});

describe("priorForecast (corpus-prior)", () => {
  it("known family returns family-specific quantiles", () => {
    const f = priorForecast("TRADITIONAL BAGUETTE", "2026-04-25"); // Saturday
    expect(f.is_default_family).toBe(false);
    expect(f.matched_family).toBe("traditional baguette");
    expect(f.quantiles.q50).toBeGreaterThan(100);
  });

  it("unknown family falls back to default with the flag set", () => {
    const f = priorForecast("ROCKET-FUEL DOUGHNUT", "2026-04-25");
    expect(f.is_default_family).toBe(true);
  });

  it("weekend (Sat) and weekday (Wed) produce different forecasts", () => {
    const sat = priorForecast("TRADITIONAL BAGUETTE", "2026-04-25"); // Saturday
    const wed = priorForecast("TRADITIONAL BAGUETTE", "2026-04-22"); // Wednesday
    expect(sat.quantiles.q50).not.toBe(wed.quantiles.q50);
  });

  it("CV is in a sensible range for retail demand (0.2–0.7)", () => {
    const f = priorForecast("CROISSANT", "2026-04-25");
    expect(f.cv).toBeGreaterThan(0.2);
    expect(f.cv).toBeLessThan(0.7);
  });
});

describe("coldStartForecast end-to-end", () => {
  it("returns a 9-quantile envelope tagged with the prior forecaster", () => {
    const stage = { stage: "cold" as const, actuals_count: 5, band_multiplier: 1.3, banner: "x" };
    const out = coldStartForecast("CROISSANT", "2026-04-25", stage);
    expect(out.forecaster).toBe("population_prior_v1");
    expect(out.quantiles["q0.1"]).toBeLessThan(out.quantiles["q0.5"]);
    expect(out.quantiles["q0.5"]).toBeLessThan(out.quantiles["q0.9"]);
  });

  it("no_data stage produces wider bands than warm stage", () => {
    const noData = { stage: "no_data" as const, actuals_count: 0, band_multiplier: 1.6, banner: "x" };
    const warm = { stage: "warm" as const, actuals_count: 60, band_multiplier: 1.1, banner: "x" };
    const a = coldStartForecast("CROISSANT", "2026-04-25", noData);
    const b = coldStartForecast("CROISSANT", "2026-04-25", warm);
    const spreadA = a.quantiles["q0.9"] - a.quantiles["q0.1"];
    const spreadB = b.quantiles["q0.9"] - b.quantiles["q0.1"];
    expect(spreadA).toBeGreaterThan(spreadB);
  });
});

describe("alphaForBlending (maturity factor)", () => {
  it("0 actuals → 0 (pure prior)", () => {
    expect(alphaForBlending(0)).toBe(0);
  });
  it("90+ actuals → 1 (full GBM weight available for tail quantiles)", () => {
    expect(alphaForBlending(90)).toBe(1);
    expect(alphaForBlending(180)).toBe(1);
  });
  it("ramps linearly between 0 and 90", () => {
    expect(alphaForBlending(45)).toBeCloseTo(0.5);
    expect(alphaForBlending(30)).toBeCloseTo(1 / 3, 3);
  });
});

describe("alphaForQuantile (Tier 4 per-quantile blend)", () => {
  it("at full maturity, prior owns the median (alpha=0 at q0.5)", () => {
    expect(alphaForQuantile(180, "q0.5")).toBe(0);
    expect(alphaForQuantile(180, "q0.4")).toBe(0);
    expect(alphaForQuantile(180, "q0.6")).toBe(0);
  });
  it("at full maturity, GBM owns the tails (alpha=1 at q0.1 and q0.9)", () => {
    expect(alphaForQuantile(180, "q0.1")).toBe(1);
    expect(alphaForQuantile(180, "q0.2")).toBe(1);
    expect(alphaForQuantile(180, "q0.8")).toBe(1);
    expect(alphaForQuantile(180, "q0.9")).toBe(1);
  });
  it("transitional quantiles (q0.3, q0.7) hit a 50/50 blend at maturity", () => {
    expect(alphaForQuantile(180, "q0.3")).toBe(0.5);
    expect(alphaForQuantile(180, "q0.7")).toBe(0.5);
  });
  it("cold tenant gets pure prior across every quantile", () => {
    for (const q of ["q0.1", "q0.3", "q0.5", "q0.7", "q0.9"]) {
      expect(alphaForQuantile(0, q)).toBe(0);
    }
  });
  it("half-mature tenant scales every quantile's target alpha by maturity", () => {
    // count=45 → maturity=0.5; q0.9 target=1.0 → effective alpha=0.5
    expect(alphaForQuantile(45, "q0.9")).toBeCloseTo(0.5);
    // q0.5 target=0 → still 0 regardless of maturity
    expect(alphaForQuantile(45, "q0.5")).toBe(0);
  });
});

describe("blendQuantiles (per-quantile + flat alpha)", () => {
  const prior = { "q0.1": 5, "q0.5": 10, "q0.9": 20 };
  const gbm = { "q0.1": 15, "q0.5": 30, "q0.9": 60 };

  it("flat alpha=0 returns pure prior", () => {
    expect(blendQuantiles(prior, gbm, 0)).toEqual(prior);
  });
  it("flat alpha=1 returns pure GBM", () => {
    expect(blendQuantiles(prior, gbm, 1)).toEqual(gbm);
  });
  it("flat alpha=0.5 returns midpoint per quantile", () => {
    const out = blendQuantiles(prior, gbm, 0.5);
    expect(out["q0.5"]).toBe(20);
    expect(out["q0.9"]).toBe(40);
  });
  it("per-quantile fn yields prior at q0.5 and GBM at q0.9 when fed the Tier-4 schedule", () => {
    const out = blendQuantiles(prior, gbm, (q) => alphaForQuantile(180, q));
    expect(out["q0.5"]).toBe(10); // pure prior
    expect(out["q0.9"]).toBe(60); // pure GBM
    expect(out["q0.1"]).toBe(15); // pure GBM
  });
  it("falls back to prior when GBM lacks a quantile", () => {
    const partialGbm = { "q0.5": 30 };
    const out = blendQuantiles(prior, partialGbm, 1);
    expect(out["q0.1"]).toBe(5);
    expect(out["q0.5"]).toBe(30);
    expect(out["q0.9"]).toBe(20);
  });
  it("clamps out-of-range alpha values to [0, 1]", () => {
    expect(blendQuantiles(prior, gbm, 2)).toEqual(gbm);
    expect(blendQuantiles(prior, gbm, -1)).toEqual(prior);
  });
});
