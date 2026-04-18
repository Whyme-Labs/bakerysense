import { SignJWT, jwtVerify, exportJWK, generateKeyPair as joseGenerate, importJWK } from "jose";

export type Role = "platform_admin" | "tenant_admin" | "branch_manager" | "staff" | "viewer";

export interface AccessTokenClaims {
	sub: string;                  // user id
	tid: string;                  // tenant id
	role: Role;
	branches: string[] | null;    // null = all branches within tenant
	kid: string;
}

export interface KeyPairJwk {
	privateJwk: JsonWebKey;
	publicJwk: JsonWebKey;
}

export async function generateKeyPair(): Promise<KeyPairJwk> {
	const { privateKey, publicKey } = await joseGenerate("ES256", { extractable: true });
	const privateJwk = await exportJWK(privateKey);
	const publicJwk = await exportJWK(publicKey);
	publicJwk.alg = privateJwk.alg = "ES256";
	publicJwk.use = "sig";
	return { privateJwk, publicJwk };
}

export async function signAccessToken(
	claims: AccessTokenClaims,
	opts: { privateJwk: JsonWebKey; kid: string; ttlSeconds: number; issuer?: string; audience?: string },
): Promise<string> {
	const key = await importJWK(opts.privateJwk, "ES256");
	const now = Math.floor(Date.now() / 1000);
	return await new SignJWT({ tid: claims.tid, role: claims.role, branches: claims.branches })
		.setProtectedHeader({ alg: "ES256", kid: opts.kid, typ: "JWT" })
		.setSubject(claims.sub)
		.setIssuedAt(now)
		.setExpirationTime(now + opts.ttlSeconds)
		.setIssuer(opts.issuer ?? "bakerysense")
		.setAudience(opts.audience ?? "bakerysense-web")
		.sign(key);
}

export async function verifyAccessToken(
	token: string,
	resolvePublicJwk: (kid: string) => Promise<JsonWebKey>,
): Promise<AccessTokenClaims> {
	const { payload, protectedHeader } = await jwtVerify(token, async (header) => {
		if (!header.kid) throw new Error("missing kid");
		const jwk = await resolvePublicJwk(header.kid);
		return await importJWK(jwk, "ES256");
	});
	return {
		sub: String(payload.sub),
		tid: String(payload.tid),
		role: payload.role as Role,
		branches: (payload.branches as string[] | null) ?? null,
		kid: String(protectedHeader.kid),
	};
}
