import { verifyAccessToken, type AccessTokenClaims } from "./jwt";
import { getPublicJwkByKid } from "./jwks";
import { readAuthCookie } from "./cookies";

export interface SessionLocals {
	claims: AccessTokenClaims;
}

export async function resolveSession(
	env: CloudflareEnv,
	request: Request,
): Promise<SessionLocals | null> {
	const cookieHeader = request.headers.get("cookie");
	const token = await readAuthCookie(env, cookieHeader, "bs_at");
	if (!token) return null;
	try {
		const claims = await verifyAccessToken(token, (kid) => getPublicJwkByKid(env, kid));
		return { claims };
	} catch {
		return null;
	}
}
