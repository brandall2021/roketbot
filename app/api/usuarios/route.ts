import { NextRequest, NextResponse } from "next/server";
import { consultar, ejecutar, fecha, num } from "@/lib/db";
import { requireAdmin, hashPassword, ROLES } from "@/lib/auth";
import { respuestaDeError, conflicto, esViolacionDeUnicidad } from "@/lib/rutas";

export const runtime = "nodejs";

type FilaUsuario = {
  id: number | string;
  username: string;
  nombre: string;
  rol: string;
  created_at: unknown;
};

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const users = await consultar<FilaUsuario>(
      `SELECT id, username, nombre, rol, creado_en AS created_at
         FROM usuarios
        ORDER BY id`
    );

    return NextResponse.json({
      users: users.map((u) => ({
        id: num(u.id),
        username: u.username,
        nombre: u.nombre,
        rol: u.rol,
        created_at: fecha(u.created_at),
      })),
    });
  } catch (err) {
    return respuestaDeError("usuarios", err);
  }
}

export async function POST(req: NextRequest) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    const username = String(body.username ?? "").trim();
    const nombre = String(body.nombre ?? "").trim();
    const rol = String(body.rol ?? "USER").toUpperCase();
    const password = String(body.password ?? "");

    if (!username || !nombre || !password) {
      return NextResponse.json(
        { error: "username, nombre y password son requeridos" },
        { status: 400 }
      );
    }
    if (username.length > 80 || nombre.length > 120) {
      return NextResponse.json({ error: "username o nombre demasiado largo" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    }
    if (!ROLES.includes(rol as (typeof ROLES)[number])) {
      return NextResponse.json({ error: `Rol inválido (${ROLES.join(", ")})` }, { status: 400 });
    }

    const existente = await consultar<{ id: number }>(
      "SELECT id FROM usuarios WHERE username = $1 LIMIT 1",
      [username]
    );
    if (existente.length > 0) {
      return NextResponse.json({ error: "El usuario ya existe" }, { status: 409 });
    }

    // RETURNING id: la clave la da la base (identity), no un MAX+1.
    const creado = await ejecutar(
      `INSERT INTO usuarios (username, password_hash, nombre, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [username, await hashPassword(password), nombre, rol]
    );

    const id = num(creado.rows[0]?.id);

    return NextResponse.json({ ok: true, id, creadoPor: session!.username }, { status: 201 });
  } catch (err) {
    if (esViolacionDeUnicidad(err)) return conflicto("usuarios", err, "El usuario ya existe");
    return respuestaDeError("usuarios", err);
  }
}
