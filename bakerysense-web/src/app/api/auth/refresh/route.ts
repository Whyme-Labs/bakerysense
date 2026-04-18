import { readAuthCookie, setAuthCookie, clearAuthCookie } from "@/lib/auth/cookies";
import { rotateRefresh, revokeAllForUser, readRefresh } from "@/lib/auth/refresh";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { verifyCsrf } from "@/lib/auth/csrf";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/db/client";
import { memberships, branchAccess } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const presented = await readAuthCookie(env, req.headers.get("cookie"), "bs_rt");
		if (!presented) throw new Unauthorized();
		const existing = await readRefresh(env, presented);
		if (!existing) {
			// reuse attempt (not found = already revoked): clear cookies and 401
			await writeAudit(env, { tenantId: "", action: "token.reuse_detected", metadata: { cookieCleared: true } });
			const headers = new Headers({ "content-type": "application/json" });
			clearAuthCookie(headers, "bs_at");
			clearAuthCookie(headers, "bs_rt");
			return new Response(JSON.stringify({ error: "reused" }), { status: 401, headers });
		}

		// CSRF enforcement: require a valid CSRF token for refresh
		const csrfHeader = req.headers.get("x-csrf-token");
		const csrfOk = await verifyCsrf(env, csrfHeader, existing.userId);
		if (!csrfOk) throw new Forbidden("csrf");

		let rotated;
		try {
			rotated = await rotateRefresh(env, presented);
		} catch {
			await revokeAllForUser(env, existing.userId);
			throw new Unauthorized("refresh failed");
		}

		const db = getDb(env);
		const m = await db.select().from(memberships)
			.where(and(eq(memberships.userId, existing.userId), eq(memberships.tenantId, existing.tenantId)))
			.get();
		if (!m) throw new Unauthorized();
		const ba = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, m.id)).all();
		const permittedBranches = ba.length === 0 ? null : ba.map((r) => r.branchId);

		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: existing.userId, tid: existing.tenantId, role: m.role, branches: permittedBranches, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		await writeAudit(env, { tenantId: existing.tenantId, actorUserId: existing.userId, action: "token.refreshed" });

		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rotated.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
