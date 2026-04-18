import { z } from "zod";
import { getDb } from "@/db/client";
import { tenants, users, memberships, branches } from "@/db/schema";
import { hashPassword } from "@/lib/auth/argon2";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { issueRefresh } from "@/lib/auth/refresh";
import { setAuthCookie, setReadableCookie } from "@/lib/auth/cookies";
import { issueCsrf } from "@/lib/auth/csrf";
import { BadRequest, Conflict, TooMany, errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(12).max(256),
	tenantName: z.string().min(1).max(80),
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
	vertical: z.enum(["bakery", "grocery", "pharmacy", "retail", "other"]),
});

function newId(prefix: string): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `${prefix}_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const json = await req.json();
		const parsed = Body.safeParse(json);
		if (!parsed.success) throw new BadRequest("invalid body");
		const { email, password, tenantName, tenantSlug, vertical } = parsed.data;

		const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
		const rl = await rateLimit(env, "signup", ip, 3, 3600);
		if (!rl.allowed) throw new TooMany("too many signups");

		const db = getDb(env);
		const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
		if (existingUser) throw new Conflict("email already registered");
		const existingSlug = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).get();
		if (existingSlug) throw new Conflict("tenant slug taken");

		const now = Date.now();
		const userId      = newId("usr");
		const tenantId    = newId("ten");
		const branchId    = newId("brn");
		const membershipId = newId("mem");

		const passwordHash = await hashPassword(password);
		await db.insert(tenants).values({ id: tenantId, slug: tenantSlug, name: tenantName, vertical, plan: "free", createdAt: now });
		await db.insert(users).values({ id: userId, email, passwordHash, emailVerified: 0, createdAt: now, lastLoginAt: now });
		await db.insert(memberships).values({ id: membershipId, userId, tenantId, role: "tenant_admin", createdAt: now });
		await db.insert(branches).values({ id: branchId, tenantId, name: "HQ", createdAt: now });

		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: userId, tid: tenantId, role: "tenant_admin", branches: null, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		const rt = await issueRefresh(env, {
			userId,
			tenantId,
			ip: req.headers.get("cf-connecting-ip") ?? undefined,
			ua: req.headers.get("user-agent") ?? undefined,
		});

		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rt.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		const csrf = await issueCsrf(env, userId);
		setReadableCookie(headers, "bs_csrf", csrf, 60 * 60);

		await writeAudit(env, { tenantId, actorUserId: userId, action: "tenant.created" });
		await writeAudit(env, { tenantId, actorUserId: userId, action: "user.signed_up" });

		return new Response(JSON.stringify({ tenantSlug, userId, tenantId }), { status: 201, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
