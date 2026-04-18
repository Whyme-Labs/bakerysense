import { rotateKeys } from "@/lib/auth/jwks";
import { errorResponse, Forbidden } from "@/lib/errors";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
	try {
		const { env } = getCloudflareContext();
		const expected = env.OPS_ROTATE_SECRET;
		if (!expected || req.headers.get("x-ops-secret") !== expected) throw new Forbidden();
		const result = await rotateKeys(env);
		return Response.json(result);
	} catch (e) { return errorResponse(e); }
}
