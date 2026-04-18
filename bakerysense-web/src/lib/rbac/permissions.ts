import type { Role } from "@/lib/auth/jwt";

export interface Capability {
	path: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	allow: Role[];
}

export const CAPABILITIES: Capability[] = [
	{ path: "/api/connector",                    method: "GET",    allow: ["tenant_admin"] },
	{ path: "/api/connector",                    method: "POST",   allow: ["tenant_admin"] },
	{ path: "/api/connector/:id",                method: "DELETE", allow: ["tenant_admin"] },
	{ path: "/api/connector/:id/default",        method: "POST",   allow: ["tenant_admin"] },
	{ path: "/api/oauth/openrouter/start",       method: "GET",    allow: ["tenant_admin"] },
];
