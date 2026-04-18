import { describe, it, expect } from "vitest";
import { orderQuantity, targetServiceLevel } from "@/lib/newsvendor";

describe("newsvendor", () => {
  it("target service level for Cu=2, Co=1 = 0.667", () => {
    expect(targetServiceLevel(2, 1)).toBeCloseTo(2/3, 4);
  });
  it("Cu=1, Co=1 = 0.5", () => {
    expect(targetServiceLevel(1, 1)).toBeCloseTo(0.5, 4);
  });
  it("picks closest quantile: target 0.667, trained [0.5, 0.7, 0.9] => 0.7", () => {
    const { quantity, quantile } = orderQuantity({ 0.5: 100, 0.7: 150, 0.9: 200 }, 2, 1);
    expect(quantile).toBe(0.7);
    expect(quantity).toBe(150);
  });
  it("rounds up to nearest integer unit", () => {
    const { quantity } = orderQuantity({ 0.5: 10.4, 0.7: 15.6 }, 1, 1);
    expect(Number.isInteger(quantity)).toBe(true);
  });
  it("handles single-quantile input", () => {
    const { quantity, quantile } = orderQuantity({ 0.5: 42 }, 2, 1);
    expect(quantile).toBe(0.5);
    expect(quantity).toBe(42);
  });
});
