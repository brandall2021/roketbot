import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { CARATULA_DE, CARATULA_SELECCION, respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Listing de la carátula (antes dbo.ExpdtesCaratula). La tabla es `expedientes` y
 * las claves de la respuesta se aliasan para no modificar la página.
 */
export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25) || 25));
    const offset = (page - 1) * pageSize;
    const q = url.searchParams.get("q")?.trim();

    const condiciones: string[] = [];
    const valores: unknown[] = [];

    if (q) {
      valores.push(`%${q}%`);
      condiciones.push(
        `(e.id::text ILIKE $${valores.length} OR e.numero ILIKE $${valores.length}
          OR e.caratula ILIKE $${valores.length} OR e.actor ILIKE $${valores.length}
          OR e.demandado ILIKE $${valores.length})`
      );
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

    const conteo = await consultarUno<{ total: number | string }>(
      `SELECT COUNT(*) AS total ${CARATULA_DE} ${where}`,
      valores
    );

    const pagina = [...valores, offset, pageSize];
    const rows = await consultar<Record<string, unknown>>(
      `SELECT ${CARATULA_SELECCION}
         ${CARATULA_DE}
         ${where}
        ORDER BY e.id DESC
        OFFSET $${valores.length + 1} LIMIT $${valores.length + 2}`,
      pagina
    );

    return NextResponse.json({ total: num(conteo?.total ?? 0), page, pageSize, rows });
  } catch (err) {
    return respuestaDeError("caratula", err);
  }
}
