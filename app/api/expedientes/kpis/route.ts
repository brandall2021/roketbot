import { NextRequest, NextResponse } from "next/server";
import { consultarUno, fecha, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { FUENTE } from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

// In-memory cache for KPIs (60 seconds TTL)
let kpiCache: { data: Kpis; expiresAt: number } | null = null;
const KPI_CACHE_TTL_MS = 60 * 1000;

type Kpis = {
  total: number;
  actualizadosHoy: number;
  conDocumento: number;
  sinDocumento: number;
  antiguos: number;
  ultimaActualizacion: string | null;
};

/**
 * Indicadores del panel. Antes cada métrica dependía de `TRY_CONVERT(date, ...)`
 * sobre las columnas texto de la vista goolge2; acá son `date`/`timestamptz` reales:
 *   - actualizados hoy  -> fch_ult_proc::date = CURRENT_DATE
 *   - antiguos          -> fch_ult_mov < CURRENT_DATE - INTERVAL '365 days'
 * Los contadores vienen de aggregate: Postgres los devuelve como string -> num().
 */
export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const now = Date.now();
    if (kpiCache && now < kpiCache.expiresAt) {
      return NextResponse.json(kpiCache.data);
    }

    const [k, ultima] = await Promise.all([
      consultarUno<Record<string, unknown>>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE fch_ult_proc::date = CURRENT_DATE) AS "actualizadosHoy",
           COUNT(*) FILTER (WHERE documento IS NOT NULL AND TRIM(documento) <> '') AS "conDocumento",
           COUNT(*) FILTER (WHERE documento IS NULL OR TRIM(documento) = '') AS "sinDocumento",
           COUNT(*) FILTER (WHERE fch_ult_mov IS NOT NULL
                              AND fch_ult_mov < CURRENT_DATE - INTERVAL '365 days') AS antiguos
         FROM ${FUENTE}`
      ),
      consultarUno<{ ultima: unknown }>(`SELECT MAX(fch_ult_proc) AS ultima FROM ${FUENTE}`),
    ]);

    const data: Kpis = {
      total: num(k?.total ?? 0),
      actualizadosHoy: num(k?.actualizadosHoy ?? 0),
      conDocumento: num(k?.conDocumento ?? 0),
      sinDocumento: num(k?.sinDocumento ?? 0),
      antiguos: num(k?.antiguos ?? 0),
      ultimaActualizacion: ultima?.ultima ? fecha(ultima.ultima) : null,
    };

    kpiCache = { data, expiresAt: now + KPI_CACHE_TTL_MS };
    return NextResponse.json(data);
  } catch (err) {
    return respuestaDeError("expedientes/kpis", err);
  }
}
