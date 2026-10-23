import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { CAMPOS_LISTADO, FUENTE, filaVista } from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Detalle de un expediente.
 *
 * El parámetro de la ruta sigue siendo el NÚMERO de expediente (lo que la tabla
 * manda en `Expdte`), con `?centro=&unidad=` para desambiguar cuando el mismo
 * número aparece en dos juzgados. Antes devolvía la columna XML `[Historia]` de la
 * vista; ahora la historia vive en `movimientos` y se devuelve como lista.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const expdte = params.id.trim();
    const centro = url.searchParams.get("centro")?.trim();
    const unidad = url.searchParams.get("unidad")?.trim();

    const condiciones = ["numero = $1"];
    const valores: unknown[] = [expdte];

    if (centro) {
      valores.push(centro);
      condiciones.push(`centro_judicial = $${valores.length}`);
    }
    if (unidad) {
      valores.push(unidad);
      condiciones.push(`unidad_judicial = $${valores.length}`);
    }

    const fila = await consultarUno<Record<string, unknown>>(
      `SELECT ${CAMPOS_LISTADO.join(", ")}
         FROM ${FUENTE}
        WHERE ${condiciones.join(" AND ")}
        ORDER BY id
        LIMIT 1`,
      valores
    );

    if (!fila) {
      return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
    }

    // `m.` explícito en el ORDER BY: sin él, Postgres casaría con el alias de salida
    // `fecha` (que es texto DD/MM/AAAA) y ordenaría lexicográficamente.
    const movimientos = await consultar<Record<string, unknown>>(
      `SELECT m.id,
              to_char(m.fecha::date, 'DD/MM/YYYY') AS fecha,
              m.descripcion,
              m.texto,
              m.link,
              m.histid,
              m.origen
         FROM movimientos m
        WHERE m.expediente_id = $1
        ORDER BY m.fecha DESC NULLS LAST, m.id DESC`,
      [fila.id]
    );

    return NextResponse.json({ expediente: filaVista(fila), movimientos });
  } catch (err) {
    return respuestaDeError("expedientes/[id]", err);
  }
}
