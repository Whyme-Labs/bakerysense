import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set<string>(["/", "/signin", "/signup", "/forgot"]);
const PUBLIC_PREFIXES = [
	"/api/auth/signup",
	"/api/auth/signin",
	"/api/auth/refresh",
	"/api/.well-known",
	"/_next",
	"/favicon",
];

function applySecurityHeaders(res: NextResponse): NextResponse {
	res.headers.set(
		"content-security-policy",
		"default-src 'self'; connect-src 'self' https://openrouter.ai; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'"
	);
	res.headers.set("x-content-type-options", "nosniff");
	res.headers.set("x-frame-options", "DENY");
	res.headers.set("referrer-policy", "no-referrer-when-downgrade");
	res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
	return res;
}

export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	if (PUBLIC_PATHS.has(pathname)) return applySecurityHeaders(NextResponse.next());
	if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return applySecurityHeaders(NextResponse.next());

	const hasAuthCookie = req.cookies.get("bs_at");
	if (!hasAuthCookie) {
		const url = req.nextUrl.clone();
		url.pathname = "/signin";
		url.searchParams.set("next", pathname);
		return applySecurityHeaders(NextResponse.redirect(url));
	}
	// JWT validity is re-checked server-side in route handlers; middleware does a cheap gate only.
	return applySecurityHeaders(NextResponse.next());
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
