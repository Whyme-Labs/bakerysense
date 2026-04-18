import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users, memberships, tenants, branchAccess } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/argon2";
import { signAccessToken } from "@/lib/auth/jwt";
import { getActivePrivateJwk } from "@/lib/auth/jwks";
import { issueRefresh } from "@/lib/auth/refresh";
import { setAuthCookie, setReadableCookie } from "@/lib/auth/cookies";
import { issueCsrf } from "@/lib/auth/csrf";
import { BadRequest, Unauthorized, TooMany, errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const Body = z.object({
	email: z.string().email().toLowerCase(),
	password: z.string().min(1),
	tenantSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
});

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const parsed = Body.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const { email, password, tenantSlug } = parsed.data;

		const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
		const rl = await rateLimit(env, "signin", `${ip}:${email}`, 5, 900);
		if (!rl.allowed) throw new TooMany("too many attempts");

		const db = getDb(env);
		const user = await db.select().from(users).where(eq(users.email, email)).get();
		if (!user) throw new Unauthorized("invalid credentials");
		if (!(await verifyPassword(password, user.passwordHash))) throw new Unauthorized("invalid credentials");

		const tenant = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).get();
		if (!tenant) throw new Unauthorized("invalid credentials");
		const m = await db.select().from(memberships)
			.where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenant.id)))
			.get();
		if (!m) throw new Unauthorized("invalid credentials");

		const ba = await db.select().from(branchAccess).where(eq(branchAccess.membershipId, m.id)).all();
		const permittedBranches = ba.length === 0 ? null : ba.map((r) => r.branchId);

		await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id));
		await writeAudit(env, { tenantId: tenant.id, actorUserId: user.id, action: "user.signed_in" });

		const { kid, jwk } = await getActivePrivateJwk(env);
		const at = await signAccessToken(
			{ sub: user.id, tid: tenant.id, role: m.role, branches: permittedBranches, kid },
			{ privateJwk: jwk, kid, ttlSeconds: 60 * 15 },
		);
		const rt = await issueRefresh(env, {
			userId: user.id,
			tenantId: tenant.id,
			ip: req.headers.get("cf-connecting-ip") ?? undefined,
			ua: req.headers.get("user-agent") ?? undefined,
		});

		const headers = new Headers({ "content-type": "application/json" });
		await setAuthCookie(env, headers, "bs_at", at, { maxAgeSeconds: 60 * 15 });
		await setAuthCookie(env, headers, "bs_rt", rt.token, { maxAgeSeconds: 60 * 60 * 24 * 30 });
		const csrf = await issueCsrf(env, user.id);
		setReadableCookie(headers, "bs_csrf", csrf, 60 * 60);

		return new Response(JSON.stringify({ tenantSlug: tenant.slug, userId: user.id }), { status: 200, headers });
	} catch (e) {
		return errorResponse(e);
	}
}
