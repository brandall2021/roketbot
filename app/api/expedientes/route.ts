import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  CAMPOS_LISTADO,
  FUENTE,
  construirFiltros,
  filasVista,
  orden,
  paginacion,
} from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    // `?historia=1` se sigue aceptando pero ya no hace nada: el legado devolvía la
    // columna XML `[Historia]` de la vista goolge2, y ahora la historia es la tabla
    // `movimientos`. El listado trae el conteo (`Movimientos`) y el detalle de cada
    // movimiento se pide a GET /api/expedientes/[id].
    const { where, valores } = construirFiltros(params);
    const { page, pageSize, offset } = paginacion(params);
    const orderSql = orden(params);

    const conteo = await consultarUno<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM ${FUENTE} ${where}`,
      valores
    );
    const total = num(conteo?.total ?? 0);

    const filas = await consultar<Record<string, unknown>>(
      `SELECT ${CAMPOS_LISTADO.join(", ")}
         FROM ${FUENTE}
         ${where}
        ORDER BY ${orderSql}
        OFFSET $${valores.length + 1} LIMIT $${valores.length + 2}`,
      [...valores, offset, pageSize]
    );

    return NextResponse.json({ total, page, pageSize, rows: filasVista(filas) });
  } catch (err) {
    return respuestaDeError("expedientes", err);
  }
}
