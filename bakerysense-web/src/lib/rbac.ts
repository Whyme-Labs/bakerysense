import type { AccessTokenClaims, Role } from "./auth/jwt";

export class ForbiddenError extends Error {
	readonly status = 403;
	constructor(msg = "forbidden") { super(msg); }
}

export class NotFoundError extends Error {
	readonly status = 404;
	constructor(msg = "not found") { super(msg); }
}

export function requireRole(claims: AccessTokenClaims, allowed: Role[]): void {
	if (claims.role === "platform_admin") return;
	if (!allowed.includes(claims.role)) throw new ForbiddenError();
}

export function assertBranchAccess(claims: AccessTokenClaims, branchId: string): void {
	if (claims.role === "platform_admin" || claims.role === "tenant_admin") return;
	if (claims.branches === null) return;
	if (!claims.branches.includes(branchId)) throw new NotFoundError();
}
