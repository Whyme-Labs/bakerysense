import { describe, it, expect } from "vitest";
import {
	escapePointerToken,
	unescapePointerToken,
	parsePointer,
	getAtPointer,
	hasPointer,
	applyEdits,
} from "@/lib/harness/patch";

describe("JSON Pointer helpers", () => {
	it("escapes / and ~ per RFC 6901", () => {
		expect(escapePointerToken("a/b")).toBe("a~1b");
		expect(escapePointerToken("a~b")).toBe("a~0b");
		expect(unescapePointerToken("a~1b")).toBe("a/b");
		expect(unescapePointerToken("a~0b")).toBe("a~b");
	});
	it("round-trips a sku|dow key (pipe needs no escaping)", () => {
		expect(escapePointerToken("banana_cake|Wed")).toBe("banana_cake|Wed");
	});
	it("parsePointer splits and decodes", () => {
		expect(parsePointer("")).toEqual([]);
		expect(parsePointer("/a/b~1c")).toEqual(["a", "b/c"]);
	});
	it("parsePointer rejects malformed pointers", () => {
		expect(() => parsePointer("no-leading-slash")).toThrow();
	});
});

describe("getAtPointer / hasPointer", () => {
	const doc = { a: { b: { c: 1 } }, x: 2 };
	it("reads nested values", () => {
		expect(getAtPointer(doc, "/a/b/c")).toBe(1);
		expect(getAtPointer(doc, "/x")).toBe(2);
	});
	it("returns undefined for missing segments", () => {
		expect(getAtPointer(doc, "/a/z/c")).toBeUndefined();
		expect(hasPointer(doc, "/a/b/c")).toBe(true);
		expect(hasPointer(doc, "/a/z")).toBe(false);
	});
});

describe("applyEdits", () => {
	it("adds a new object member", () => {
		const doc = { p: { sku_adjustments: {} } };
		const out = applyEdits(doc, [
			{ op: "add", path: "/p/sku_adjustments/banana_cake|Wed", value: { multiplier: 0.85 } },
		]);
		expect(out).toEqual({ p: { sku_adjustments: { "banana_cake|Wed": { multiplier: 0.85 } } } });
	});

	it("replaces an existing member", () => {
		const doc = { p: { dow: { Wed: 1.0 } } };
		const out = applyEdits(doc, [{ op: "replace", path: "/p/dow/Wed", value: 0.85 }]);
		expect(out.p).toEqual({ dow: { Wed: 0.85 } });
	});

	it("removes a member", () => {
		const doc = { p: { a: 1, b: 2 } };
		const out = applyEdits(doc, [{ op: "remove", path: "/p/a" }]);
		expect(out.p).toEqual({ b: 2 });
	});

	it("creates intermediate objects for a sparse branch override", () => {
		const out = applyEdits({}, [
			{ op: "add", path: "/post_forecast_adjustments/sku_adjustments/croissant|Fri", value: { multiplier: 1.2 } },
		]);
		expect(out).toEqual({
			post_forecast_adjustments: { sku_adjustments: { "croissant|Fri": { multiplier: 1.2 } } },
		});
	});

	it("applies multiple ops in order", () => {
		const out = applyEdits({ p: { dow: { Mon: 1, Wed: 1 } } }, [
			{ op: "replace", path: "/p/dow/Wed", value: 0.85 },
			{ op: "add", path: "/p/dow/Sat", value: 1.3 },
		]);
		expect(out.p).toEqual({ dow: { Mon: 1, Wed: 0.85, Sat: 1.3 } });
	});

	it("does not mutate the input document", () => {
		const doc = { p: { dow: { Wed: 1.0 } } };
		const snapshot = structuredClone(doc);
		applyEdits(doc, [{ op: "replace", path: "/p/dow/Wed", value: 0.5 }]);
		expect(doc).toEqual(snapshot);
	});

	it("refuses prototype-polluting paths", () => {
		expect(() => applyEdits({}, [{ op: "add", path: "/__proto__/polluted", value: true }])).toThrow();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("refuses to patch the document root", () => {
		expect(() => applyEdits({}, [{ op: "replace", path: "", value: 1 }])).toThrow();
	});
});
