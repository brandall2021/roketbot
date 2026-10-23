import { NextRequest, NextResponse } from "next/server";
import { consultarUno, ejecutar } from "@/lib/db";
import { requireAdmin, requireAuth } from "@/lib/auth";
import { actualizarExpediente, resolverCentro } from "@/lib/expedientes";
import {
  CARATULA_DE,
  CARATULA_SELECCION,
  ErrorDePeticion,
  esViolacionDeClaveForanea,
  esViolacionDeUnicidad,
  respuestaDeError,
  conflicto,
} from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Claves del formulario legacy (app/caratula/page.tsx) -> claves de
 * `actualizarExpediente`, que es la que tiene la lista blanca de columnas.
 * `ExpdteLegajo` se descarta: el legado no tenía equivalente en el esquema nuevo
 * (la historia pasó a la tabla `movimientos`).
 */
const CAMPOS_LEGADO: Record<string, string> = {
  ExpdteNro: "numero",
  ExpdteCaratula: "caratula",
  ExpdteActor: "actor",
  ExpdteDemandado: "demandado",
  ExpdteUnidadJud: "unidadJudicial",
  ExpdteProvinciaNombre: "provincia",
  ExpdteFchUltMov: "fecha",
  ExpdteFchUltProc: "fechaProcesado",
  ExpdteUltMovDescripcion: "descripcion",
  /** ExpdteActualizado era SI/NO/KO -> columna `actualizado`. */
  ExpdteActualizado: "estado",
};

function idValido(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const id = idValido(params.id);
    if (id === null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const fila = await consultarUno<Record<string, unknown>>(
      `SELECT ${CARATULA_SELECCION} ${CARATULA_DE} WHERE e.id = $1 LIMIT 1`,
      [id]
    );

    if (!fila) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }

    return NextResponse.json(fila);
  } catch (err) {
    return respuestaDeError("caratula/[id]", err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = idValido(params.id);
    if (id === null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    const body = await req.json();
    const legado = (body ?? {}) as Record<string, unknown>;

    const nuevos: Record<string, unknown> = {};
    for (const [claveLegado, claveCampo] of Object.entries(CAMPOS_LEGADO)) {
      const valor = legado[claveLegado];
      if (typeof valor === "string" && valor.trim()) nuevos[claveCampo] = valor.trim();
    }

    // El centro se resuelve contra centros_judiciales: centro_id es FK, así que
    // un id inexistente reventaría en la base con un mensaje ilegible.
    const cenJudId = typeof legado.ExpdteCenJudId === "string" ? legado.ExpdteCenJudId.trim() : "";
    if (cenJudId) {
      const { centro, error } = await resolverCentro({ cenJudId });
      if (!centro) throw new ErrorDePeticion(error ?? "centro judicial no resuelto");
      nuevos.centroId = centro.id;
    }

    if (Object.keys(nuevos).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    const resultado = await actualizarExpediente(id, nuevos);
    if (resultado.actualizados === 0) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (esViolacionDeUnicidad(err)) {
      return conflicto("caratula/[id]", err, "Ya existe un expediente con ese número y jurisdicción");
    }
    return respuestaDeError("caratula/[id]", err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = idValido(params.id);
    if (id === null) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

    // El expediente ya es una fila de `expedientes`: se borra de la tabla real y los
    // movimientos asociados caen por la FK.
    const borrado = await ejecutar("DELETE FROM expedientes WHERE id = $1 RETURNING id", [id]);
    if (borrado.rowCount === 0) {
      return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, eliminados: borrado.rowCount });
  } catch (err) {
    if (esViolacionDeClaveForanea(err)) {
      console.error("[api/caratula/[id]] borrador bloqueado por FK:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "No se puede eliminar: el expediente tiene registros asociados" },
        { status: 409 }
      );
    }
    return respuestaDeError("caratula/[id]", err);
  }
}
