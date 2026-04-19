// POST /api/internal/publish-model
//
// Called by the Python retrain script (or Cloudflare Container) after a successful
// retrain run. The request must carry an HMAC-SHA-256 signature over the canonical
// JSON body so that only holders of OPS_ROTATE_SECRET can trigger a publish.
//
// Canonical JSON: keys sorted recursively at every nesting level, no extra whitespace.
// Both client and server must produce the same bytes using canonicalize() below.
// Example Python: import json; json.dumps(body, sort_keys=True, separators=(',', ':'))

import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { errorResponse, Unauthorized, BadRequest } from "@/lib/errors";
import {
	writeActive,
	appendVersion,
	writeRetrainState,
	type ActivePointer,
	type VersionEntry,
} from "@/lib/model-pointer";
import { writeAudit } from "@/lib/audit";

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

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------
const Body = z.object({
	tenantId: z.string().min(1),
	newVersion: z.number().int().positive(),
	treesR2Key: z.string().min(1),
	featuresR2Key: z.string().min(1),
	trainedAt: z.number().int().positive(),
	metrics: z.object({
		rollingMae: z.number().nonnegative(),
		rollingWape: z.number().nonnegative(),
	}),
	baselineRollingMae: z.number().nonnegative().optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const secret = env.OPS_ROTATE_SECRET;
		if (!secret) throw new Error("OPS_ROTATE_SECRET not configured");

		// Read raw bytes first so signature is verified over the exact payload.
		const raw = await req.text();
		const providedSig = req.headers.get("x-ops-secret") ?? "";

		// Parse JSON, then validate schema.
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			throw new BadRequest("invalid json");
		}

		const parsed = Body.safeParse(body);
		if (!parsed.success) throw new BadRequest("invalid body");

		// Compute HMAC over canonical form of the validated (typed) data.
		const canonical = canonicalize(parsed.data);
		const expected = computeSig(secret, canonical);

		// Constant-time comparison: avoid early-exit timing oracle.
		if (providedSig.length !== expected.length) throw new Unauthorized();
		let diff = 0;
		for (let i = 0; i < expected.length; i++) {
			diff |= expected.charCodeAt(i) ^ providedSig.charCodeAt(i);
		}
		if (diff !== 0) throw new Unauthorized();

		const {
			tenantId,
			newVersion,
			treesR2Key,
			featuresR2Key,
			trainedAt,
			metrics,
			baselineRollingMae,
		} = parsed.data;

		// -----------------------------------------------------------------------
		// Regression guard: abort if rollingMae > 1.1 × baseline
		// -----------------------------------------------------------------------
		if (
			baselineRollingMae != null &&
			baselineRollingMae > 0 &&
			metrics.rollingMae > 1.1 * baselineRollingMae
		) {
			await writeRetrainState(env, tenantId, {
				status: "aborted",
				finishedAt: Date.now(),
				outcome: "aborted",
				reason: `rollingMae ${metrics.rollingMae.toFixed(3)} > 1.1 * baseline ${baselineRollingMae.toFixed(3)}`,
			});
			await writeAudit(env, {
				tenantId,
				action: "retrain.aborted",
				metadata: {
					newVersion,
					reason: "regression > 10%",
					rollingMae: metrics.rollingMae,
					baselineRollingMae,
				},
			});
			return Response.json(
				{ ok: false, reason: "regression_guard" },
				{ status: 409 },
			);
		}

		// -----------------------------------------------------------------------
		// Publish: update active pointer, append version history, write state
		// -----------------------------------------------------------------------
		const pointer: ActivePointer = {
			version: newVersion,
			treesR2Key,
			featuresR2Key,
			trainedAt,
			rollingMae: metrics.rollingMae,
		};
		const entry: VersionEntry = {
			version: newVersion,
			trainedAt,
			metrics,
			treesR2Key,
			featuresR2Key,
		};

		await writeActive(env, tenantId, pointer);
		await appendVersion(env, tenantId, entry);
		await writeRetrainState(env, tenantId, {
			status: "published",
			finishedAt: Date.now(),
			outcome: "published",
		});
		await writeAudit(env, {
			tenantId,
			action: "retrain.published",
			metadata: {
				newVersion,
				rollingMae: metrics.rollingMae,
				rollingWape: metrics.rollingWape,
			},
		});

		return Response.json({ ok: true, version: newVersion });
	} catch (e) {
		return errorResponse(e);
	}
}
