import { describe, it, expect } from "vitest";
import { wape, driftDetected } from "@/lib/metrics";

describe("wape", () => {
  it("computes WAPE on three points", () => {
    const pts = [
      { date: "2026-01-01", predicted: 120, actual: 100, absError: 20 },
      { date: "2026-01-02", predicted: 95, actual: 100, absError: 5 },
      { date: "2026-01-03", predicted: 100, actual: 100, absError: 0 },
    ];
    expect(wape(pts)).toBeCloseTo(25 / 300, 5);
  });
  it("returns 0 on empty input", () => {
    expect(wape([])).toBe(0);
  });
  it("returns 0 when all actuals are 0", () => {
    const pts = [{ date: "2026-01-01", predicted: 5, actual: 0, absError: 5 }];
    expect(wape(pts)).toBe(0);
  });
});

describe("driftDetected", () => {
  it("fires at 1.5x baseline", () => {
    // Use 0.45/0.30 = 1.5 exactly (avoids JS fp rounding with 0.30/0.20 = 1.4999…)
    expect(driftDetected(0.45, 0.30)).toBe(true);
  });
  it("does not fire at 1.49x", () => {
    expect(driftDetected(0.298, 0.20)).toBe(false);
  });
  it("no drift if baseline is 0", () => {
    expect(driftDetected(0.3, 0)).toBe(false);
  });
});
