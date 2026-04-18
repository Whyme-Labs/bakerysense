import { listActiveJwks } from "@/lib/auth/jwks";
import { errorResponse } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function GET(_req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const entries = await listActiveJwks(env);
		const keys = entries.map((e) => ({ ...e.publicJwk, kid: e.kid, use: "sig", alg: "ES256" }));
		return Response.json({ keys });
	} catch (e) { return errorResponse(e); }
}
