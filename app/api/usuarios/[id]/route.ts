import { NextRequest, NextResponse } from "next/server";
import { consultarUno, ejecutar, num } from "@/lib/db";
import { requireAdmin, hashPassword, ROLES } from "@/lib/auth";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const body = await req.json();

    // Lista blanca de columnas: el SET se arma con fragmentos hardcodeados y los
    // valores entran por posición. Nunca va texto del usuario dentro del SQL.
    const sets: string[] = [];
    const valores: unknown[] = [];

    if (body.nombre !== undefined) {
      const nombre = String(body.nombre).trim();
      if (!nombre || nombre.length > 120) {
        return NextResponse.json({ error: "nombre inválido" }, { status: 400 });
      }
      valores.push(nombre);
      sets.push(`nombre = $${valores.length}`);
    }

    if (body.rol !== undefined) {
      const rol = String(body.rol).toUpperCase();
      if (!ROLES.includes(rol as (typeof ROLES)[number])) {
        return NextResponse.json({ error: `Rol inválido (${ROLES.join(", ")})` }, { status: 400 });
      }
      if (id === session!.id && rol !== "ADMIN") {
        return NextResponse.json({ error: "No podés quitarte el rol ADMIN a vos mismo" }, { status: 400 });
      }
      valores.push(rol);
      sets.push(`rol = $${valores.length}`);
    }

    if (body.password !== undefined && String(body.password) !== "") {
      const password = String(body.password);
      if (password.length < 6) {
        return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
      }
      valores.push(await hashPassword(password));
      sets.push(`password_hash = $${valores.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    valores.push(id);
    const actualizado = await ejecutar(
      `UPDATE usuarios SET ${sets.join(", ")} WHERE id = $${valores.length} RETURNING id`,
      valores
    );

    if (actualizado.rows.length === 0) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return respuestaDeError("usuarios/[id]", err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    if (id === session!.id) {
      return NextResponse.json({ error: "No podés eliminar tu propio usuario" }, { status: 400 });
    }

    const admins = await consultarUno<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'ADMIN'"
    );
    const target = await consultarUno<{ id: number | string; rol: string }>(
      "SELECT id, rol FROM usuarios WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }
    if (target.rol === "ADMIN" && num(admins?.n ?? 0) <= 1) {
      return NextResponse.json({ error: "No se puede eliminar el último administrador" }, { status: 400 });
    }

    const borrado = await ejecutar("DELETE FROM usuarios WHERE id = $1 RETURNING id", [id]);
    return NextResponse.json({ ok: true, eliminados: borrado.rowCount });
  } catch (err) {
    return respuestaDeError("usuarios/[id]", err);
  }
}
