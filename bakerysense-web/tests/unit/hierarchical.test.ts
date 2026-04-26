import { describe, expect, it } from "vitest";
import {
  bottomUp,
  buildTenantHierarchy,
  leaves,
  olsMinT,
  postOrder,
} from "../../src/lib/hierarchical";

describe("hierarchical reconciliation", () => {
  const h = buildTenantHierarchy("tenant", {
    branch_a: ["sku_1", "sku_2"],
    branch_b: ["sku_3"],
  });

  it("postOrder visits children before parents", () => {
    const order = postOrder(h);
    expect(order.indexOf("sku_1")).toBeLessThan(order.indexOf("branch_a"));
    expect(order.indexOf("sku_2")).toBeLessThan(order.indexOf("branch_a"));
    expect(order.indexOf("branch_a")).toBeLessThan(order.indexOf("tenant"));
  });

  it("leaves enumerates only the SKU level", () => {
    expect(leaves(h).sort()).toEqual(["sku_1", "sku_2", "sku_3"]);
  });

  it("bottom-up sums leaves into ancestors", () => {
    const r = bottomUp(h, { sku_1: 100, sku_2: 50, sku_3: 80 });
    expect(r.branch_a).toBe(150);
    expect(r.branch_b).toBe(80);
    expect(r.tenant).toBe(230);
    // Leaves preserved
    expect(r.sku_1).toBe(100);
    expect(r.sku_2).toBe(50);
    expect(r.sku_3).toBe(80);
  });

  it("bottom-up overrides any incoherent base at non-leaves", () => {
    const r = bottomUp(h, { sku_1: 100, sku_2: 50, sku_3: 80, branch_a: 999, tenant: 9999 });
    expect(r.branch_a).toBe(150);
    expect(r.tenant).toBe(230);
  });

  it("OLS-MinT produces coherent results (parent = sum of children)", () => {
    const base = { sku_1: 100, sku_2: 50, sku_3: 80, branch_a: 145, branch_b: 78, tenant: 220 };
    const r = olsMinT(h, base);
    // Leaves can shift to satisfy coherence
    expect(r.branch_a).toBeCloseTo(r.sku_1 + r.sku_2, 6);
    expect(r.branch_b).toBeCloseTo(r.sku_3, 6);
    expect(r.tenant).toBeCloseTo(r.branch_a + r.branch_b, 6);
  });

  it("OLS-MinT is the identity when base is already coherent", () => {
    const base = { sku_1: 100, sku_2: 50, sku_3: 80, branch_a: 150, branch_b: 80, tenant: 230 };
    const r = olsMinT(h, base);
    for (const k of Object.keys(base)) {
      expect(r[k]).toBeCloseTo(base[k as keyof typeof base], 6);
    }
  });

  it("OLS-MinT pulls bottom-level forecasts toward the higher-level signal when present", () => {
    // Higher-level says total is 300, leaves sum to 230. Reconciled leaves
    // should grow proportionally to close the gap.
    const base = { sku_1: 100, sku_2: 50, sku_3: 80, branch_a: 150, branch_b: 80, tenant: 300 };
    const r = olsMinT(h, base);
    const leafSum = r.sku_1 + r.sku_2 + r.sku_3;
    // Reconciled total is the average of the original total and the leaf
    // sum, so the leaf sum should land between the originals.
    expect(leafSum).toBeGreaterThan(230);
    expect(leafSum).toBeLessThan(300);
    expect(r.tenant).toBeCloseTo(leafSum, 6);
  });

  it("bottom-up and OLS-MinT agree when only leaf forecasts are supplied", () => {
    const base = { sku_1: 100, sku_2: 50, sku_3: 80 };
    const bu = bottomUp(h, base);
    const ols = olsMinT(h, base);
    for (const k of Object.keys(bu)) {
      expect(ols[k]).toBeCloseTo(bu[k], 6);
    }
  });
});
