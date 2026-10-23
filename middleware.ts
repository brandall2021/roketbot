import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
// /api/health se deja afuera a propósito: lo necesita el healthcheck de Dokploy o del
// proxy, que no tienen sesión. La ruta no revela nada que el sitio público no revele:
// devuelve sólo `{ok, base}` y el detalle del error queda en el log del servidor.
const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health"];

// Routes that require ADMIN role
const ADMIN_ROUTES = ["/usuarios", "/api/usuarios"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = request.cookies.get("juridico_token")?.value;
  if (!token) {
    // API routes return 401, pages redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // For admin routes, we'd need to decode the JWT to check role
  // But since middleware runs on the edge and we use Node.js JWT library,
  // we'll keep the existing requireAdmin pattern in API routes
  // This middleware only handles the basic auth check

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
