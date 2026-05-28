// Minimal JSON Pointer (RFC 6901) + JSON-Patch (RFC 6902) applier, scoped
// to what the harness needs: add / replace / remove on object members of a
// rules document. Our rules schema is all keyed objects (no arrays as patch
// targets), which keeps this deterministic and avoids RFC 6902's fiddly
// array-index semantics.
//
// Used by the proposer (to know whether a key already exists → add vs
// replace) and the validator (to compute the after-edit rules for scoring).
import type { Rules } from "./resolver";

export interface EditOp {
	op: "add" | "replace" | "remove";
	path: string; // JSON Pointer, e.g. "/post_forecast_adjustments/sku_adjustments/banana_cake|Wed"
	value?: unknown;
}

export function escapePointerToken(token: string): string {
	return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function unescapePointerToken(token: string): string {
	return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Parse a JSON Pointer into its decoded path tokens. "" → []. */
export function parsePointer(path: string): string[] {
	if (path === "") return [];
	if (!path.startsWith("/")) throw new Error(`invalid JSON pointer (must start with "/"): ${path}`);
	return path.slice(1).split("/").map(unescapePointerToken);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

/** Read the value at a pointer, or undefined if any segment is missing. */
export function getAtPointer(doc: Rules, path: string): unknown {
	const tokens = parsePointer(path);
	let cur: unknown = doc;
	for (const t of tokens) {
		if (!isPlainObject(cur)) return undefined;
		if (t === "__proto__" || t === "constructor" || t === "prototype") return undefined;
		cur = cur[t];
	}
	return cur;
}

/** True when a value exists at the pointer (used to pick add vs replace). */
export function hasPointer(doc: Rules, path: string): boolean {
	return getAtPointer(doc, path) !== undefined;
}

/** Apply a list of edit ops to a DEEP COPY of the document and return it.
 *  Intermediate objects are created as needed for add/replace so a sparse
 *  branch override can be built up from nothing. The input is never mutated. */
export function applyEdits(doc: Rules, edits: EditOp[]): Rules {
	const out = structuredClone(doc) as Rules;
	for (const edit of edits) {
		const tokens = parsePointer(edit.path);
		if (tokens.length === 0) throw new Error("cannot patch the document root");
		if (tokens.some((t) => t === "__proto__" || t === "constructor" || t === "prototype")) {
			throw new Error(`refusing to patch a prototype-polluting path: ${edit.path}`);
		}
		// Descend to the parent of the final token, creating intermediates.
		let parent: Record<string, unknown> = out;
		for (let i = 0; i < tokens.length - 1; i++) {
			const t = tokens[i];
			const next = parent[t];
			if (isPlainObject(next)) {
				parent = next;
			} else {
				const created: Record<string, unknown> = {};
				parent[t] = created;
				parent = created;
			}
		}
		const leaf = tokens[tokens.length - 1];
		if (edit.op === "remove") {
			delete parent[leaf];
		} else {
			// add and replace are both upserts for an object member.
			parent[leaf] = structuredClone(edit.value);
		}
	}
	return out;
}
