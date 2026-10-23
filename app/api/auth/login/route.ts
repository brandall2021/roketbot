import { NextRequest, NextResponse } from "next/server";
import { consultarUno, ejecutar, num } from "@/lib/db";
import { comparePassword, setAuthCookie, signToken } from "@/lib/auth";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return false;
  }

  entry.count++;
  return true;
}

type FilaUsuario = {
  id: number | string;
  username: string;
  password_hash: string;
  nombre: string;
  rol: string;
  activo: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta nuevamente en 15 minutos." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    if (!username || !password) {
      return NextResponse.json({ error: "Usuario y contraseña requeridos" }, { status: 400 });
    }

    const user = await consultarUno<FilaUsuario>(
      `SELECT id, username, password_hash, nombre, rol, activo
         FROM usuarios
        WHERE username = $1
        LIMIT 1`,
      [username]
    );

    // Credenciales incorrectas: mismo mensaje que antes, sin revelar si el usuario existe.
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    // Un usuario desactivado no puede entrar aunque la contraseña siga siendo válida.
    // El estado se avisa recién con credenciales correctas: si no, cualquiera podría
    // sondear qué usernames existen.
    if (user.activo === false) {
      return NextResponse.json(
        { error: "Usuario desactivado. Contactá a un administrador." },
        { status: 403 }
      );
    }

    // El registro de último acceso no puede tumbar un login válido.
    await ejecutar("UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1", [num(user.id)]).catch(
      (err: unknown) => console.error("[api/auth/login] no se pudo registrar ultimo_acceso:", err)
    );

    const token = signToken({
      id: num(user.id),
      username: user.username,
      nombre: user.nombre,
      rol: user.rol,
    });

    return setAuthCookie(token);
  } catch (err) {
    return respuestaDeError("auth/login", err);
  }
}
