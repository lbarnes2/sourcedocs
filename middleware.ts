import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS, requiredRole } from "@/lib/auth/permissions";
import { hasRole } from "@/lib/auth/roles";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function deny(request: NextRequest, status: 401 | 403, error: string): NextResponse {
  if (isApi(request.nextUrl.pathname)) return NextResponse.json({ error }, { status });
  if (status === 403) return new NextResponse(error, { status });
  const url = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/** Blocks other sites from submitting changes using a signed-in user's cookie. */
function isCrossSiteWrite(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.nextUrl.host;
  } catch {
    return true;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }

  let session;
  try {
    session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  } catch (error) {
    /* Missing AUTH_SECRET: fail closed rather than open. */
    console.error(error);
    return new NextResponse("Sign-in is not configured on this server.", { status: 500 });
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && session) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!session) return deny(request, 401, "Please sign in.");
  if (!hasRole(session.role, requiredRole(pathname, request.method))) {
    return deny(request, 403, "Your account does not have permission to do this.");
  }
  return NextResponse.next();
}

export const config = {
  /* Everything except Next's static build output and Vercel's analytics endpoints. */
  matcher: ["/((?!_next/static|_next/image|_vercel|favicon.ico).*)"]
};
