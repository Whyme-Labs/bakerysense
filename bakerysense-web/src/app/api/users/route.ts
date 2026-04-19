import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveSession } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { requireRole } from "@/lib/rbac";
import { getDb } from "@/db/client";
import { users, memberships } from "@/db/schema";
import { Unauthorized, BadRequest, Forbidden, Conflict, errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/argon2";

export const runtime = "nodejs";

const InviteBody = z.object({
	email: z.string().email(),
	role: z.enum(["tenant_admin", "branch_manager", "staff", "viewer"]),
});

function newMembershipId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `mbr_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

function newUserId(): string {
	const b = crypto.getRandomValues(new Uint8Array(9));
	return `usr_${btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

function generateTempPassword(): string {
	// 20-character random password from a URL-safe alphabet
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const raw = crypto.getRandomValues(new Uint8Array(20));
	let out = "";
	for (const byte of raw) {
		out += chars[byte % chars.length];
	}
	return out;
}

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const db = getDb(env);
		const rows = await db
			.select({
				membershipId: memberships.id,
				userId: memberships.userId,
				email: users.email,
				role: memberships.role,
				createdAt: memberships.createdAt,
			})
			.from(memberships)
			.innerJoin(users, eq(memberships.userId, users.id))
			.where(eq(memberships.tenantId, session.claims.tid))
			.all();
		return Response.json({ members: rows });
	} catch (e) { return errorResponse(e); }
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		if (!(await verifyCsrf(env, req.headers.get("x-csrf-token"), session.claims.sub))) throw new Forbidden("csrf");
		requireRole(session.claims, ["tenant_admin"]);

		const parsed = InviteBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");

		const { email, role } = parsed.data;
		const db = getDb(env);
		const now = Date.now();

		// Check if user with this email already exists
		const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1).all();
		const existingUser = existingUsers[0];

		if (existingUser) {
			// Check if already a member of this tenant
			const existingMembership = await db
				.select()
				.from(memberships)
				.where(and(eq(memberships.userId, existingUser.id), eq(memberships.tenantId, session.claims.tid)))
				.limit(1)
				.all();

			if (existingMembership.length > 0) {
				throw new Conflict("email already has membership in this tenant");
			}

			// Create only the membership
			const membershipId = newMembershipId();
			await db.insert(memberships).values({
				id: membershipId,
				userId: existingUser.id,
				tenantId: session.claims.tid,
				role,
				createdAt: now,
			});
			await writeAudit(env, {
				tenantId: session.claims.tid,
				actorUserId: session.claims.sub,
				action: "user.invited",
				target: existingUser.id,
				metadata: { email, role, existingUser: true },
			});
			return Response.json({ userId: existingUser.id, email, tempPassword: null }, { status: 201 });
		}

		// New user: create user row + membership
		const tempPassword = generateTempPassword();
		const passwordHash = await hashPassword(tempPassword);
		const userId = newUserId();
		const membershipId = newMembershipId();

		await db.insert(users).values({
			id: userId,
			email,
			passwordHash,
			emailVerified: 0,
			createdAt: now,
		});

		await db.insert(memberships).values({
			id: membershipId,
			userId,
			tenantId: session.claims.tid,
			role,
			createdAt: now,
		});

		await writeAudit(env, {
			tenantId: session.claims.tid,
			actorUserId: session.claims.sub,
			action: "user.invited",
			target: userId,
			metadata: { email, role },
		});

		return Response.json({ userId, email, tempPassword }, { status: 201 });
	} catch (e) { return errorResponse(e); }
}
