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

export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;
	if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
	if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

	const hasAuthCookie = req.cookies.get("bs_at");
	if (!hasAuthCookie) {
		const url = req.nextUrl.clone();
		url.pathname = "/signin";
		url.searchParams.set("next", pathname);
		return NextResponse.redirect(url);
	}
	// JWT validity is re-checked server-side in route handlers; middleware does a cheap gate only.
	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
