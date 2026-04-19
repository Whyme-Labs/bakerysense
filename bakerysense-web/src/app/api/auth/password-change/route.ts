import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/argon2";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { revokeAllForUser } from "@/lib/auth/refresh";
import { BadRequest, Unauthorized, Forbidden, errorResponse } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const Body = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(8),
});

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();

		// 1. Resolve session — 401 if none
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();

		// 2. Verify CSRF — 403 if missing/invalid
		const csrfToken = req.headers.get("x-csrf-token");
		const csrfOk = await verifyCsrf(env, csrfToken, session.claims.sub);
		if (!csrfOk) throw new Forbidden("invalid or missing CSRF token");

		// 3. Zod parse body
		const json = await req.json();
		const parsed = Body.safeParse(json);
		if (!parsed.success) throw new BadRequest("invalid body");
		const { currentPassword, newPassword } = parsed.data;

		// 4. Load user row by session.claims.sub
		const db = getDb(env);
		const user = await db.select().from(users).where(eq(users.id, session.claims.sub)).get();
		if (!user) throw new Unauthorized();

		// 5. Verify current password
		const passwordOk = await verifyPassword(currentPassword, user.passwordHash);
		if (!passwordOk) {
			return Response.json({ error: "current password is incorrect" }, { status: 403 });
		}

		// 6. Hash new password
		const newHash = await hashPassword(newPassword);

		// 7. Update users.passwordHash
		await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

		// 8. Revoke ALL refresh tokens for the user (including the current session's token).
		// This forces re-login, which is appropriate for a password change scenario.
		// The user will be signed out immediately after this call succeeds.
		await revokeAllForUser(env, user.id);

		// 9. Write audit entry
		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: user.id,
			action: "user.password_changed",
		});

		// 10. Return success
		return Response.json({ ok: true });
	} catch (e) {
		return errorResponse(e);
	}
}
