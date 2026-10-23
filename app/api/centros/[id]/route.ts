import { NextRequest, NextResponse } from "next/server";
import { ejecutar } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  comoCodigoEndpoint,
  comoId,
  comoProvinciaId,
  esViolacionDeClaveForanea,
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
    const unidad = body.unidad ? String(body.unidad).trim() : null;
    const sitioWeb = body.sitioWeb ? String(body.sitioWeb).trim() : null;

    if (!nombre || nombre.length > 40) {
      return NextResponse.json({ error: "Nombre obligatorio (máx 40)" }, { status: 400 });
    }
    if (unidad && unidad.length > 40) {
      return NextResponse.json({ error: "La unidad supera el largo permitido" }, { status: 400 });
    }
    if (sitioWeb && sitioWeb.length > 80) {
      return NextResponse.json({ error: "El sitio web supera el largo permitido" }, { status: 400 });
    }

    const prov = comoProvinciaId(body.provinciaId ? String(body.provinciaId).trim() : null);
    if (prov.error) {
      return NextResponse.json({ error: prov.error }, { status: 400 });
    }

    const ep = comoCodigoEndpoint(body.equivEndpoint ? String(body.equivEndpoint).trim() : null);
    if (ep.error) {
      return NextResponse.json({ error: ep.error }, { status: 400 });
    }

    const actualizado = await ejecutar(
      `UPDATE centros_judiciales
          SET nombre = $2, provincia_id = $3, unidad = $4, sitio_web = $5, codigo_endpoint = $6
        WHERE id = $1
        RETURNING id`,
      [id, nombre, prov.valor, unidad, sitioWeb, ep.valor]
    );

    if (actualizado.rowCount === 0) {
      return NextResponse.json({ error: "Centro no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esViolacionDeClaveForanea(err)) {
      return NextResponse.json({ error: "La provincia indicada no existe" }, { status: 400 });
    }
    return respuestaDeError("centros/[id]", err);
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
    const borrado = await ejecutar("DELETE FROM centros_judiciales WHERE id = $1 RETURNING id", [id]);
    if (borrado.rowCount === 0) {
      return NextResponse.json({ error: "Centro no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, eliminados: borrado.rowCount });
  } catch (err) {
    if (esViolacionDeClaveForanea(err)) {
      console.error("[api/centros/[id]] borrado bloqueado por FK:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "No se puede eliminar: el centro tiene expedientes asociados" },
        { status: 409 }
      );
    }
    return respuestaDeError("centros/[id]", err);
  }
}
