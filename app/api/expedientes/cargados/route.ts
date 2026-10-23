import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { CAMPOS_LISTADO, FUENTE, construirFiltros, filasVista, paginacion } from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Auditoría de lo que cargó la app.
 *
 * `dbo.app_expedientes` ya no existe: era una copia del alta en ExpdtesCaratula.
 * El registro ahora ES la fila de `expedientes`, marcada con `origen_carga`
 * (MANUAL / CSV / MASIVO) y `creado_por`, así que esta ruta es el mismo listado
 * de la vista filtrado por `origen_carga IS NOT NULL`, con los mismos filtros y
 * el filtro `origen` de siempre. Las fechas de carga por archivo están en
 * /api/expedientes/cargas.
 */
export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const filtros = construirFiltros(url.searchParams);

    // construirFiltros devuelve "WHERE a ILIKE $1 AND ..." (o string vacío); acá se
    // le agrega la condición de auditoría adelante, por lo que se quita el `WHERE`.
    const condiciones = [
      "origen_carga IS NOT NULL",
      ...(filtros.where ? [filtros.where.replace(/^WHERE\s+/, "")] : []),
    ];
    const valores: unknown[] = [...filtros.valores];

    const origen = url.searchParams.get("origen")?.trim();
    if (origen) {
      valores.push(`%${origen}%`);
      condiciones.push(`origen_carga ILIKE $${valores.length}`);
    }

    const where = `WHERE ${condiciones.join(" AND ")}`;
    const { page, pageSize, offset } = paginacion(url.searchParams);

    const conteo = await consultarUno<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM ${FUENTE} ${where}`,
      valores
    );

    const filas = await consultar<Record<string, unknown>>(
      `SELECT ${CAMPOS_LISTADO.join(", ")}
         FROM ${FUENTE}
         ${where}
        ORDER BY id DESC
        OFFSET $${valores.length + 1} LIMIT $${valores.length + 2}`,
      [...valores, offset, pageSize]
    );

    // filaVista ya trae `Origen` (origen_carga) y `Creado Por` (el usuario), que son
    // las claves que lee la pestaña "Registros cargados".
    return NextResponse.json({
      total: num(conteo?.total ?? 0),
      page,
      pageSize,
      rows: filasVista(filas),
    });
  } catch (err) {
    return respuestaDeError("expedientes/cargados", err);
  }
}
