import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConfidenceBar } from "@/components/forecast/ConfidenceBar";

describe("ConfidenceBar", () => {
  it("renders q10-q90 band + median + bake markers", () => {
    const { container } = render(
      <ConfidenceBar quantiles={{ "q0.1": 100, "q0.5": 150, "q0.9": 200 }} bakeQuantity={160} max={200} />,
    );
    expect(container.querySelector("rect")).toBeTruthy();
    expect(container.querySelector("line")).toBeTruthy();
    expect(container.querySelector("circle")).toBeTruthy();
  });
});
