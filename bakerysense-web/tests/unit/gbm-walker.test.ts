import { describe, it, expect } from "vitest";
import { loadTrees, predict, shapContribs } from "@/lib/gbm-walker";
import fixture from "../fixtures/tiny-trees.json";

describe("gbm-walker", () => {
  it("predicts tree0.leaf0 + tree1.leaf0 = 1.5", () => {
    const trees = loadTrees(fixture.quantiles["0.5"]);
    // x=-1 -> leaf0 (1.0), y=5 -> leaf0 (0.5) => total 1.5
    expect(predict(trees, { x: -1, y: 5 })).toBeCloseTo(1.5, 6);
  });

  it("predicts tree0.leaf1 + tree1.leaf1 = 1.5", () => {
    const trees = loadTrees(fixture.quantiles["0.5"]);
    // x=1 -> leaf1 (2.0), y=20 -> leaf1 (-0.5) => total 1.5
    expect(predict(trees, { x: 1, y: 20 })).toBeCloseTo(1.5, 6);
  });

  it("predicts mixed leaves correctly", () => {
    const trees = loadTrees(fixture.quantiles["0.5"]);
    // x=1 (leaf1 = 2.0), y=5 (leaf0 = 0.5) => 2.5
    expect(predict(trees, { x: 1, y: 5 })).toBeCloseTo(2.5, 6);
  });

  it("missing feature defaults to 0", () => {
    const trees = loadTrees(fixture.quantiles["0.5"]);
    // x=0 goes left (leaf0 = 1.0), y missing treated as 0 goes left (leaf0 = 0.5)
    expect(predict(trees, { x: 0 })).toBeCloseTo(1.5, 6);
  });

  it("shapContribs returns contributions keyed by feature_name", () => {
    const trees = loadTrees(fixture.quantiles["0.5"]);
    const contribs = shapContribs(trees, { x: 1, y: 5 });
    expect(Object.keys(contribs).sort()).toEqual(["x", "y"]);
    // x took the higher branch (leaf1 > leaf0), so x contribution should be positive
    expect(contribs.x).toBeGreaterThan(0);
    // y took the lower branch (leaf0 > leaf1 in tree1), so y contribution positive too
    expect(contribs.y).toBeGreaterThan(0);
  });
});
