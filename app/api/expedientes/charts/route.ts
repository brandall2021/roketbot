import { NextRequest, NextResponse } from "next/server";
import { consultar, consultarUno, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { FUENTE } from "@/lib/consulta";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Datos de los gráficos del panel, sobre `vista_expedientes`.
 *
 * En la vista legada `[Estado]` mezclaba el resultado de la consulta (SI/NO/KO) con
 * textos tipo ACTIVO; el espejo exacto hoy es la columna `actualizado`, así que los
 * grupos y el resumen activo/inactivo se calculan sobre esa columna conservando los
 * valores que ya reconocía la query anterior.
 *
 * Cada punto se devuelve con `nombre` Y `name`: el legado respondía con `nombre` y
 * los componentes (DashboardCharts / buildEstadoChartData) leen `name`. Emitir las
 * dos claves mantiene el shape de la respuesta y deja los gráficos etiquetados.
 */
type Punto = { nombre: string; name: string; value: number };

function puntos(filas: { nombre: unknown; value: unknown }[]): Punto[] {
  return filas.map((f) => {
    const nombre = String(f.nombre ?? "");
    return { nombre, name: nombre, value: num(f.value) };
  });
}

function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const ESTADO = "COALESCE(NULLIF(TRIM(actualizado), ''), 'Sin estado')";
const CON_DOC = "documento IS NOT NULL AND TRIM(documento) <> ''";
const CENTRO = "COALESCE(NULLIF(TRIM(centro_judicial), ''), 'Sin centro')";
const UNIDAD = "COALESCE(NULLIF(TRIM(unidad_judicial), ''), 'Sin unidad')";

export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const [estados, documentos, porMesRaw, centros, unidades] = await Promise.all([
      consultar<{ nombre: unknown; value: unknown }>(
        `SELECT ${ESTADO} AS nombre, COUNT(*) AS value
           FROM ${FUENTE}
          GROUP BY ${ESTADO}
          ORDER BY COUNT(*) DESC, nombre ASC`
      ),
      consultar<{ nombre: unknown; value: unknown }>(
        `SELECT CASE WHEN ${CON_DOC} THEN 'Con documento' ELSE 'Sin documento' END AS nombre, COUNT(*) AS value
           FROM ${FUENTE}
          GROUP BY CASE WHEN ${CON_DOC} THEN 'Con documento' ELSE 'Sin documento' END`
      ),
      consultar<{ mes: string; total: unknown }>(
        `SELECT to_char(fch_ult_proc, 'YYYY-MM') AS mes, COUNT(*) AS total
           FROM ${FUENTE}
          WHERE fch_ult_proc IS NOT NULL
          GROUP BY to_char(fch_ult_proc, 'YYYY-MM')`
      ),
      consultar<{ nombre: unknown; value: unknown }>(
        `SELECT ${CENTRO} AS nombre, COUNT(*) AS value
           FROM ${FUENTE}
          GROUP BY ${CENTRO}
          ORDER BY COUNT(*) DESC, nombre ASC
          LIMIT 6`
      ),
      consultar<{ nombre: unknown; value: unknown }>(
        `SELECT ${UNIDAD} AS nombre, COUNT(*) AS value
           FROM ${FUENTE}
          GROUP BY ${UNIDAD}
          ORDER BY COUNT(*) DESC, nombre ASC
          LIMIT 6`
      ),
    ]);

    const resumen = await consultarUno<{ activo: unknown; inactivo: unknown }>(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(actualizado, ''))) IN ('ACTIVO', 'ACT', 'A', 'SI', '1', 'TRUE')) AS activo,
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(actualizado, ''))) IN ('INACTIVO', 'INA', 'I', 'NO', '0', 'FALSE')) AS inactivo
       FROM ${FUENTE}`
    );

    const porMesMap = new Map(porMesRaw.map((r) => [r.mes, num(r.total)]));
    const porMes = ultimosMeses(12).map((mes) => ({ mes, total: porMesMap.get(mes) || 0 }));

    return NextResponse.json({
      estados: puntos(estados),
      documentos: puntos(documentos),
      porMes,
      centros: puntos(centros),
      unidades: puntos(unidades),
      estadoResumen: { activo: num(resumen?.activo ?? 0), inactivo: num(resumen?.inactivo ?? 0) },
    });
  } catch (err) {
    return respuestaDeError("expedientes/charts", err);
  }
}
