import { consultar, consultarUno, num, type Valores } from "./db";
import type { Story } from "./engine/pjud";

/**
 * Lecturas del estado de las corridas, para el panel y para el worker.
 *
 * Viven acá y no en `worker/corrida.ts` porque las páginas web no tienen por qué
 * arrastrar al worker (ni a `nodemailer`, que sólo usa el resumen por mail): el
 * worker importa estas funciones, nunca al revés.
 */

export type CorridaResumen = {
  id: number;
  inicio: string | null;
  fin: string | null;
  modo: string;
  estado: string;
  total: number;
  si: number;
  no: number;
  ko: number;
  error: string | null;
};

const COLUMNAS_CORRIDA = `
  id,
  to_char(inicio, 'YYYY-MM-DD"T"HH24:MI:SS')      AS inicio,
  to_char(fin, 'YYYY-MM-DD"T"HH24:MI:SS')         AS fin,
  modo,
  estado,
  total,
  cnt_si AS si,
  cnt_no AS no,
  cnt_ko AS ko,
  error`;

function comoCorrida(f: Record<string, unknown>): CorridaResumen {
  return {
    id: num(f.id),
    inicio: (f.inicio as string | null) ?? null,
    fin: (f.fin as string | null) ?? null,
    modo: String(f.modo ?? ""),
    estado: String(f.estado ?? ""),
    total: num(f.total),
    si: num(f.si),
    no: num(f.no),
    ko: num(f.ko),
    error: (f.error as string | null) ?? null,
  };
}

export async function listadoDeCorridas(limite = 30, pagina = 0): Promise<CorridaResumen[]> {
  const filas = await consultar<Record<string, unknown>>(
    `SELECT ${COLUMNAS_CORRIDA}
       FROM corridas
      ORDER BY id DESC
      LIMIT $1 OFFSET $2`,
    [clamp(limite, 1, 100), Math.max(0, pagina)]
  );
  return filas.map(comoCorrida);
}

export async function corridaPorId(id: number): Promise<CorridaResumen | null> {
  const fila = await consultarUno<Record<string, unknown>>(
    `SELECT ${COLUMNAS_CORRIDA} FROM corridas WHERE id = $1`,
    [id]
  );
  return fila ? comoCorrida(fila) : null;
}

export type ItemDeCorrida = {
  id: number;
  expediente_id: number | null;
  numero: string | null;
  resultado: string;
  motivo: string | null;
  movimientos_nuevos: number;
  duracion_ms: number;
};

export async function itemsDeCorrida(
  corridaId: number,
  opts: { soloKo?: boolean; limite?: number; offset?: number } = {}
): Promise<ItemDeCorrida[]> {
  const valores: Valores = [corridaId];
  let where = "ci.corrida_id = $1";
  if (opts.soloKo) where += " AND ci.resultado = 'KO'";
  valores.push(clamp(opts.limite ?? 200, 1, 1000));
  valores.push(Math.max(0, opts.offset ?? 0));

  const filas = await consultar<Record<string, unknown>>(
    `SELECT ci.id, ci.expediente_id, e.numero, ci.resultado, ci.motivo,
            ci.movimientos_nuevos, ci.duracion_ms
       FROM corrida_items ci
       LEFT JOIN expedientes e ON e.id = ci.expediente_id
      WHERE ${where}
      ORDER BY ci.id
      LIMIT $2 OFFSET $3`,
    valores
  );

  return filas.map((f) => ({
    id: num(f.id),
    expediente_id: f.expediente_id === null ? null : num(f.expediente_id),
    numero: (f.numero as string | null) ?? null,
    resultado: String(f.resultado ?? ""),
    motivo: (f.motivo as string | null) ?? null,
    movimientos_nuevos: num(f.movimientos_nuevos),
    duracion_ms: num(f.duracion_ms),
  }));
}

export type KoDeCorrida = {
  expediente_id: number;
  numero: string;
  jurisdiccion: number;
  motivo: string | null;
};

/**
 * Los KO de una corrida, para reprocesar sólo esos (el motivo de existir de
 * `corrida_items`). Con `corridaId` null, los de la última corrida terminada.
 */
export async function koParaReintentar(corridaId?: number): Promise<KoDeCorrida[]> {
  const id =
    corridaId ??
    num(
      (
        await consultarUno<Record<string, unknown>>(
          `SELECT id FROM corridas WHERE estado <> 'RUNNING' ORDER BY id DESC LIMIT 1`
        )
      )?.id
    );
  if (!id) return [];

  return consultar<KoDeCorrida>(
    `SELECT ci.expediente_id, e.numero, e.jurisdiccion, ci.motivo
       FROM corrida_items ci
       JOIN expedientes e ON e.id = ci.expediente_id
      WHERE ci.corrida_id = $1 AND ci.resultado = 'KO' AND ci.expediente_id IS NOT NULL
      ORDER BY ci.id`,
    [id]
  );
}

/**
 * Los últimos movimientos de un expediente. Reemplaza el `Historia` en XML que el
 * bot descargaba: acá ya están en la base, deduplicados por huella.
 * Devuelve la forma `Story` para que el listado de movimientos use el mismo render
 * que la corrida.
 */
export async function movimientosDe(expedienteId: number, limite = 50): Promise<Story[]> {
  const filas = await consultar<Record<string, unknown>>(
    `SELECT fecha::text AS fecha, descripcion AS dscr, texto, link, histid
       FROM movimientos
      WHERE expediente_id = $1
      ORDER BY fecha DESC NULLS LAST, id DESC
      LIMIT $2`,
    [expedienteId, clamp(limite, 1, 500)]
  );
  return filas.map((f) => ({
    fecha: (f.fecha as string | null) ?? null,
    dscr: (f.dscr as string | null) ?? null,
    texto: (f.texto as string | null) ?? null,
    link: (f.link as string | null) ?? null,
    histid: (f.histid as string | null) ?? null,
  }));
}

export type ResumenSistema = {
  expedientes: number;
  porResultado: Record<string, number>;
  movimientos: number;
  pendientes: number;
  corridas: number;
  ultimaCorrida: CorridaResumen | null;
};

/** Resumen para la home del panel y para `cli stats` (antes `/api/resumen`). */
export async function resumenDeSistema(): Promise<ResumenSistema> {
  const [total, porResultado, movimientos, pendientes, cantidad, ultima] = await Promise.all([
    consultarUno<Record<string, unknown>>("SELECT COUNT(*)::int AS n FROM expedientes"),
    consultar<Record<string, unknown>>(
      "SELECT COALESCE(actualizado,'—') AS k, COUNT(*)::int AS n FROM expedientes GROUP BY 1 ORDER BY 2 DESC"
    ),
    consultarUno<Record<string, unknown>>("SELECT COUNT(*)::int AS n FROM movimientos"),
    consultarUno<Record<string, unknown>>(
      "SELECT COUNT(*)::int AS n FROM expedientes WHERE actualizado IS NULL"
    ),
    consultarUno<Record<string, unknown>>("SELECT COUNT(*)::int AS n FROM corridas"),
    consultarUno<Record<string, unknown>>(
      `SELECT ${COLUMNAS_CORRIDA} FROM corridas ORDER BY id DESC LIMIT 1`
    ),
  ]);

  return {
    expedientes: num(total?.n),
    porResultado: Object.fromEntries(porResultado.map((f) => [String(f.k), num(f.n)])),
    movimientos: num(movimientos?.n),
    pendientes: num(pendientes?.n),
    corridas: num(cantidad?.n),
    ultimaCorrida: ultima ? comoCorrida(ultima) : null,
  };
}

/**
 * Historial de consultas de un expediente: en qué corrida quedó SI / NO / KO.
 * Vive acá y no en la ficha porque la ficha se lee con sesión de usuario y esta
 * query cruza `corrida_items`, que es tabla de seguimiento.
 */
export async function consultasDeExpediente(
  expedienteId: number,
  limite = 20
): Promise<{ corrida_id: number; inicio: string | null; resultado: string; motivo: string | null; movimientos_nuevos: number }[]> {
  const filas = await consultar<Record<string, unknown>>(
    `SELECT ci.corrida_id,
            to_char(c.inicio, 'YYYY-MM-DD"T"HH24:MI:SS') AS inicio,
            ci.resultado,
            ci.motivo,
            ci.movimientos_nuevos
       FROM corrida_items ci
       JOIN corridas c ON c.id = ci.corrida_id
      WHERE ci.expediente_id = $1
      ORDER BY ci.corrida_id DESC, ci.id DESC
      LIMIT $2`,
    [expedienteId, clamp(limite, 1, 100)]
  );
  return filas.map((f) => ({
    corrida_id: num(f.corrida_id),
    inicio: (f.inicio as string | null) ?? null,
    resultado: String(f.resultado ?? ""),
    motivo: (f.motivo as string | null) ?? null,
    movimientos_nuevos: num(f.movimientos_nuevos),
  }));
}

function clamp(valor: number, min: number, max: number): number {
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
