// POST /api/admin/seed-demo
//
// HMAC-signed endpoint that populates the Favorita demo tenant idempotently.
// The caller must provide an HMAC-SHA-256 signature over the canonical JSON body
// in the x-ops-secret header.  Same pattern as /api/internal/publish-model.

import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { errorResponse, Unauthorized, BadRequest } from "@/lib/errors";
import { seedDemo } from "@/scripts/seed-demo";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Canonical JSON: deterministic regardless of insertion order.
// Sorts object keys recursively; arrays preserve element order.
// ---------------------------------------------------------------------------
function canonicalize(o: unknown): string {
	if (o === null || typeof o !== "object") return JSON.stringify(o);
	if (Array.isArray(o)) return "[" + o.map(canonicalize).join(",") + "]";
	const keys = Object.keys(o as Record<string, unknown>).sort();
	return (
		"{" +
		keys
			.map(
				(k) =>
					JSON.stringify(k) +
					":" +
					canonicalize((o as Record<string, unknown>)[k]),
			)
			.join(",") +
		"}"
	);
}

function computeSig(secret: string, canonical: string): string {
	const mac = hmac(
		sha256,
		new TextEncoder().encode(secret),
		new TextEncoder().encode(canonical),
	);
	return bytesToHex(mac);
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const secret = env.OPS_ROTATE_SECRET;
		if (!secret) throw new Error("OPS_ROTATE_SECRET not configured");

		// Read raw bytes first so the signature is verified over the exact payload.
		const raw = await req.text();
		let body: unknown;
		try {
			body = raw ? JSON.parse(raw) : {};
		} catch {
			throw new BadRequest("invalid json");
		}

		const canonical = canonicalize(body ?? {});
		const expected = computeSig(secret, canonical);
		const provided = req.headers.get("x-ops-secret") ?? "";

		// Constant-time comparison: avoid early-exit timing oracle.
		if (provided.length !== expected.length) throw new Unauthorized();
		let diff = 0;
		for (let i = 0; i < expected.length; i++) {
			diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
		}
		if (diff !== 0) throw new Unauthorized();

		const result = await seedDemo(env);
		return Response.json(result);
	} catch (e) {
		return errorResponse(e);
	}
}
