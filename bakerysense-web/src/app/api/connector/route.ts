import { z } from "zod";
import { resolveSession } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac";
import { createConnector, listConnectors } from "@/lib/connector";
import { Unauthorized, Forbidden, errorResponse, BadRequest } from "@/lib/errors";
import { verifyCsrf } from "@/lib/auth/csrf";
import { writeAudit } from "@/lib/audit";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

const CreateBody = z.object({
	label: z.string().min(1).max(80),
	preset: z.enum(["openrouter","groq","together","cloudflare-ai","openai","anthropic-via-oai","ollama-tunnel","custom"]),
	baseUrl: z.string().url().max(500),
	model: z.string().min(1).max(200),
	authMethod: z.enum(["api_key","oauth","none"]),
	credential: z.string().max(500).optional(),
});

export async function GET(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const connectors = await listConnectors(env, session.claims.tid);
		return Response.json({ connectors: connectors.map(({ encryptedCredential: _enc, ...rest }) => rest) });
	} catch (e) { return errorResponse(e); }
}

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const session = await resolveSession(env, req);
		if (!session) throw new Unauthorized();
		requireRole(session.claims, ["tenant_admin"]);
		const csrfHeader = req.headers.get("x-csrf-token");
		const ok = await verifyCsrf(env, csrfHeader, session.claims.sub);
		if (!ok) throw new Forbidden("csrf");
		const parsed = CreateBody.safeParse(await req.json());
		if (!parsed.success) throw new BadRequest("invalid body");
		const c = await createConnector(env, session.claims.tid, parsed.data);
		const { encryptedCredential: _enc, ...safe } = c;
		await writeAudit(env, { tenantId: session.claims.tid, actorUserId: session.claims.sub, action: "connector.created", target: c.id });
		return Response.json(safe, { status: 201 });
	} catch (e) { return errorResponse(e); }
}
