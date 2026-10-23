import { NextRequest, NextResponse } from "next/server";
import { ejecutar } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  comoId,
  conflicto,
  esViolacionDeClaveForanea,
  esViolacionDeUnicidad,
  respuestaDeError,
} from "@/lib/rutas";

export const runtime = "nodejs";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = comoId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const body = await req.json();
    const nombre = String(body.nombre ?? "").trim();
    if (!nombre || nombre.length > 40) {
      return NextResponse.json({ error: "Nombre obligatorio (máx 40)" }, { status: 400 });
    }

    const modificado = await ejecutar(
      "UPDATE provincias SET nombre = $2 WHERE id = $1 RETURNING id",
      [id, nombre]
    );

    if (modificado.rowCount === 0) {
      return NextResponse.json({ error: "Provincia no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esViolacionDeUnicidad(err)) {
      return conflicto("provincias/[id]", err, "Ya existe una provincia con ese nombre");
    }
    return respuestaDeError("provincias/[id]", err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = comoId(params.id);
    if (id === null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const borrado = await ejecutar("DELETE FROM provincias WHERE id = $1 RETURNING id", [id]);
    if (borrado.rowCount === 0) {
      return NextResponse.json({ error: "Provincia no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, eliminados: borrado.rowCount });
  } catch (err) {
    // `centros_judiciales.provincia_id` referencia esto: no se puede borrar un maestro
    // que todavía usa algún centro.
    if (esViolacionDeClaveForanea(err)) {
      console.error("[api/provincias/[id]] borrado bloqueado por FK:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "No se puede eliminar: la provincia tiene centros asociados" },
        { status: 409 }
      );
    }
    return respuestaDeError("provincias/[id]", err);
  }
}
