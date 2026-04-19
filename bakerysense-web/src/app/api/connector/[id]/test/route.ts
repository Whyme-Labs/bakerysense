import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { listConnectors, resolveUpstreamCredential } from "@/lib/connector";
import { Unauthorized, Forbidden, NotFound, errorResponse } from "@/lib/errors";
import { verifyCsrf } from "@/lib/auth/csrf";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");

		const { id } = await params;

		// Load connector scoped to tenant
		const connectors = await listConnectors(env, session.claims.tid);
		const connector = connectors.find((c) => c.id === id);
		if (!connector) throw new NotFound("connector");

		// Resolve credential
		const credential = await resolveUpstreamCredential(env, connector);

		// Build headers for upstream call
		const upstreamHeaders: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (credential) {
			upstreamHeaders["Authorization"] = `Bearer ${credential}`;
		}

		// Use AbortController with 5s timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const start = Date.now();
		try {
			const testUrl = connector.baseUrl.endsWith("/")
				? `${connector.baseUrl}models`
				: `${connector.baseUrl}/models`;

			const res = await fetch(testUrl, {
				method: "GET",
				headers: upstreamHeaders,
				signal: controller.signal,
			});

			const latency_ms = Date.now() - start;
			clearTimeout(timeout);

			return Response.json({ ok: res.ok, status: res.status, latency_ms });
		} catch (err) {
			clearTimeout(timeout);
			const latency_ms = Date.now() - start;
			const message =
				err instanceof Error
					? controller.signal.aborted
						? "timeout after 5s"
						: err.message
					: "unknown error";
			return Response.json({ ok: false, error: message, latency_ms });
		}
	} catch (e) {
		return errorResponse(e);
	}
}
