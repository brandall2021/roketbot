import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
// Exportado: las páginas de servidor leen la misma cookie desde lib/sesion.ts y si
// el nombre se duplica, la barra lateral y el panel se desincronizan en silencio.
export const COOKIE_NAME = "juridico_token";

export type SessionUser = {
  id: number;
  username: string;
  nombre: string;
  rol: string;
};

export function signToken(user: SessionUser): string {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES } as jwt.SignOptions);
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET environment variable is required");
    }
    return jwt.verify(token, JWT_SECRET) as SessionUser;
  } catch {
    return null;
  }
}

export function setAuthCookie(token: string): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

export function clearAuthCookie(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export function getSession(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function requireAuth(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }
  return { session, response: null };
}

export function requireAdmin(req: NextRequest) {
  const { session, response } = requireAuth(req);
  if (response) return { session, response };
  if (session!.rol !== "ADMIN") {
    return {
      session,
      response: NextResponse.json({ error: "Requiere rol ADMIN" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export const ROLES = ["ADMIN", "USER"] as const;
export type Rol = (typeof ROLES)[number];

import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
