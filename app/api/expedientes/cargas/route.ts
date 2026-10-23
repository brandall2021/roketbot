import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno, fecha, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { paginacion } from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

type FilaCarga = {
  id: number | string;
  archivo: string;
  tamano: number | string | null;
  filas_leidas: number | string;
  insertados: number | string;
  duplicados: number | string;
  errores: number | string;
  detalle_errores: string | null;
  origen: string;
  creado_en: unknown;
  creado_por: number | string | null;
  usuario: string | null;
};

export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const condiciones: string[] = [];
    const valores: unknown[] = [];

    const q = url.searchParams.get("q")?.trim();
    if (q) {
      // Patrón ya envuelto + ILIKE: lo que antes era LIKE '%' + @q + '%' en T-SQL.
      valores.push(`%${q}%`);
      condiciones.push(`(c.archivo ILIKE $${valores.length} OR u.username ILIKE $${valores.length})`);
    }

    const desde = url.searchParams.get("desde")?.trim();
    if (desde && FECHA_VALIDA.test(desde)) {
      valores.push(desde);
      condiciones.push(`c.creado_en::date >= $${valores.length}::date`);
    }

    const hasta = url.searchParams.get("hasta")?.trim();
    if (hasta && FECHA_VALIDA.test(hasta)) {
      valores.push(hasta);
      condiciones.push(`c.creado_en::date <= $${valores.length}::date`);
    }

    const { page, pageSize, offset } = paginacion(url.searchParams);
    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const base = `FROM cargas c LEFT JOIN usuarios u ON u.id = c.creado_por ${where}`;

    const conteo = await consultarUno<{ total: number | string }>(
      `SELECT COUNT(*) AS total ${base}`,
      valores
    );

    const filas = await consultar<FilaCarga>(
      `SELECT c.id, c.archivo, c.tamano, c.filas_leidas, c.insertados, c.duplicados,
              c.errores, c.detalle_errores, c.origen, c.creado_en, c.creado_por,
              u.username AS usuario
         ${base}
        ORDER BY c.id DESC
        OFFSET $${valores.length + 1} LIMIT $${valores.length + 2}`,
      [...valores, offset, pageSize]
    );

    // tamano es BIGINT y los conteos llegan como string desde Postgres.
    const rows = filas.map((f) => ({
      id: num(f.id),
      archivo: f.archivo,
      tamano: f.tamano === null ? null : num(f.tamano),
      filas_leidas: num(f.filas_leidas),
      insertados: num(f.insertados),
      duplicados: num(f.duplicados),
      errores: num(f.errores),
      detalle_errores: f.detalle_errores,
      origen: f.origen,
      creado_en: fecha(f.creado_en),
      creado_por: f.creado_por === null ? null : num(f.creado_por),
      usuario: f.usuario,
    }));

    return NextResponse.json({ total: num(conteo?.total ?? 0), page, pageSize, rows });
  } catch (err) {
    return respuestaDeError("expedientes/cargas", err);
  }
}
