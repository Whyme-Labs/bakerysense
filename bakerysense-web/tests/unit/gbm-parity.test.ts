import { describe, it, expect } from "vitest";
import { loadTrees, predict } from "@/lib/gbm-walker";

// Static import resolved by the bundler at transform time (workerd sandbox cannot fs-read)
import fixture from "../fixtures/french-bakery-parity.json";

describe("gbm-walker parity with Python booster", () => {
  const typedFixture = fixture as {
    trees: { quantiles: Record<string, unknown> };
    cases: Array<{ quantile: string; features: Record<string, number>; expected: number }>;
  };

  if (!typedFixture.cases || typedFixture.cases.length === 0) {
    it.skip("parity fixture empty — regenerate from the Python side", () => {});
    return;
  }

  it(`matches Python booster on ${typedFixture.cases.length} cases within 1e-4`, () => {
    const errors: string[] = [];
    for (const c of typedFixture.cases) {
      const trees = loadTrees(typedFixture.trees.quantiles[c.quantile]);
      const got = predict(trees, c.features);
      const diff = Math.abs(got - c.expected);
      if (diff > 1e-4) {
        errors.push(`q=${c.quantile} got=${got.toFixed(6)} expected=${c.expected.toFixed(6)} diff=${diff.toFixed(6)}`);
      }
    }
    expect(errors.slice(0, 5)).toEqual([]);   // slice to avoid flooding the error log
  });
});
