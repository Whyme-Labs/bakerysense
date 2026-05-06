import { describe, it, expect } from "vitest";
import { dispatch, TOOL_REGISTRY } from "@/lib/tools";

function ctx(): any {
  return {
    env: {}, tenantId: "t1", userId: "u1", permittedBranches: null,
    defaultBranchId: "brn1", costRatio: { cu: 2, co: 1 },
    quantiles: [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9],
  };
}

describe("tools dispatch", () => {
  it("unknown tool returns error object (does not throw)", async () => {
    const out = await dispatch("nonexistent", {}, ctx());
    expect(out).toEqual({ error: "unknown_tool: nonexistent" });
  });
  it("invalid args returns invalid_args error", async () => {
    const out = await dispatch("forecast", { sku: "X" }, ctx());
    expect(typeof out.error).toBe("string");
    expect((out.error as string).startsWith("invalid_args:")).toBe(true);
  });
  it("all registered tools expose flat top-level parameters (Gemma 4 rule)", () => {
    for (const [name, t] of Object.entries(TOOL_REGISTRY)) {
      const p = t.schema.function.parameters as any;
      expect(p.type).toBe("object");
      for (const [k, v] of Object.entries<any>(p.properties ?? {})) {
        // Allow nested objects ONLY for record-valued fields like `inventory`
        // where the nested values are still primitives (integer).
        if (v.type === "object") {
          expect(v.additionalProperties?.type ?? "(nonprimitive)").toMatch(/^(string|number|integer|boolean)$/);
          continue;
        }
        expect(["string", "number", "integer", "boolean"]).toContain(v.type);
      }
    }
  });
  it("tool registry contains exactly the expected 6 tools", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual(
      ["explain_drivers", "forecast", "list_skus", "narrate_plan_options", "suggest_markdowns", "waste_risk"]
    );
  });
});
