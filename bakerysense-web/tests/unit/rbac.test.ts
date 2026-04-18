import { describe, it, expect } from "vitest";
import { requireRole } from "@/lib/rbac";
import type { AccessTokenClaims } from "@/lib/auth/jwt";

function claims(role: AccessTokenClaims["role"], branches: string[] | null = null): AccessTokenClaims {
	return { sub: "u1", tid: "t1", role, branches, kid: "k" };
}

describe("rbac.requireRole", () => {
	it("allows tenant_admin", () => {
		expect(() => requireRole(claims("tenant_admin"), ["tenant_admin"])).not.toThrow();
	});
	it("rejects staff from admin routes", () => {
		expect(() => requireRole(claims("staff"), ["tenant_admin"])).toThrow(/forbidden/);
	});
	it("platform_admin is everywhere", () => {
		expect(() => requireRole(claims("platform_admin"), ["tenant_admin"])).not.toThrow();
	});
});
