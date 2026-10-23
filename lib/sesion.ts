import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifyToken, type SessionUser } from "./auth";

/**
 * Sesión dentro de los componentes de servidor (las páginas de `app/**`).
 *
 * El resto del proyecto verifica la sesión en las API routes con `getSession(req)`
 * de `lib/auth.ts`; acá no hay `NextRequest` que recibir, así que se lee la misma
 * cookie firmada desde el contexto del render. La verificación es la misma
 * `verifyToken`, o sea el mismo `JWT_SECRET`: no existe un segundo camino de acceso.
 *
 * Next 14 expone `cookies()` de forma síncrona. Si el proyecto se mueve a Next 15,
 * estos tres helpers pasan a `await cookies()` y nada más cambia.
 */

export function sesionActual(): SessionUser | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Sin sesión no se renderiza ni una fila: primero redirige, después consulta. */
export function sesionRequerida(): SessionUser {
  const sesion = sesionActual();
  if (!sesion) redirect("/login");
  return sesion;
}

/**
 * Barrera de rol para las páginas de servidor. Las páginas de cliente usan
 * `components/AdminGuard.tsx`; las de servidor no pueden esperar a `getMe()`, así
 * que cortan acá. Se aplica además dentro de cada lectura, no sólo en el menú.
 */
export function sesionAdmin(): SessionUser {
  const sesion = sesionRequerida();
  if (sesion.rol !== "ADMIN") redirect("/expedientes");
  return sesion;
}
