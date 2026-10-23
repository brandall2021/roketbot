import { Pool, types, type PoolClient, type QueryResult } from "pg";
import { connectionString, entero, esProduccion } from "./config";

/**
 * Acceso a PostgreSQL con `pg` en crudo.
 *
 * No hay ORM ni constructor de queries: las consultas se escriben en SQL y se
 *parametrizan siempre por posición (`$1`, `$2`), nunca por concatenación. Los
 * nombres de tabla y columna que arma el código (ordenamiento, filtros de
 * carátula) salen de listas blancas, no del usuario.
 */

/**
 * Las columnas `date` (OID 1082) llegan como cadena `YYYY-MM-DD`, no como `Date`.
 *
 * Por qué: `pg` construye el `Date` a las **medianoche local** del proceso. Con
 * `TZ=America/Argentina/Buenos_Aires` eso es `03:00Z`, y cualquier lectura que use
 * getters de UTC (o que compare contra una fecha parseada del PJud, que es
 * medianoche UTC) devuelve un día de menos. Como cadena, la comparación
 * lexicográfica es el ordering del calendario y el resultado no depende de la zona
 * del contenedor. Es el mismo criterio de `type Dia` en el motor (`lib/engine/pjud.ts`).
 *
 * `timestamptz` (1184) se deja con su parser: es un instante, no una fecha de calendario.
 */
types.setTypeParser(1082, (valor) => valor);

export type Valores = unknown[];

export type Ejecucion = {
  rowCount: number;
  rows: QueryResult["rows"];
};

type Cliente = Pick<PoolClient, "query">;

function log(msg: string, extra?: unknown) {
  console.log(`[db] ${msg}`, extra ?? "");
}

function crearPool(): Pool {
  const url = connectionString();
  const pideSsl = /sslmode=(require|verify-full|verify-ca|no-verify)/i.test(url);
  const pool = new Pool({
    connectionString: url,
    // Si el enlace dice sslmode, se cifra. `no-verify` NO se honra: la conexión
    // siempre verifica el certificado. Con un CA interno, la verificación se hace
    // contra la autoridad que firmó (NODE_EXTRA_CA_CERTS), no desactivándola.
    ssl: pideSsl ? { rejectUnauthorized: true } : undefined,
    max: entero("DB_POOL_MAX", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: entero("DB_TIMEOUT_CONEXION_MS", 10_000),
    // statement_timeout corta un query colgado antes de que se lleve el proceso
    // por delante (el worker mantiene conexiones abiertas durante minutos).
    statement_timeout: entero("DB_STATEMENT_TIMEOUT_MS", 60_000),
  });

  pool.on("error", (err) => {
    // Un error en una conexión ociosa no debe tumbar el proceso.
    log("error en conexión ociosa", err.message);
  });

  return pool;
}

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export function pool(): Pool {
  if (!global.__pgPool) global.__pgPool = crearPool();
  return global.__pgPool;
}

/** Filas de un query. `number` de Postgres llega como string en BIGINT: se deja tal cual. */
export async function consultar<T = Record<string, unknown>>(
  texto: string,
  valores: Valores = []
): Promise<T[]> {
  // `rows as T[]` en vez de `query<T>`: pg exige que el genérico extienda
  // QueryResultRow, y acá los tipos de fila se declaran en cada llamado (varios
  // son parciales o columnas renombradas con AS).
  const res = await pool().query(texto, valores as never[]);
  return res.rows as T[];
}

/** Primera fila o null, para los queries de un solo registro. */
export async function consultarUno<T = Record<string, unknown>>(
  texto: string,
  valores: Valores = []
): Promise<T | null> {
  const filas = await consultar<T>(texto, valores);
  return filas[0] ?? null;
}

/** Para INSERT/UPDATE/DELETE: devuelve cuántas filas afectó y las RETURNING. */
export async function ejecutar(texto: string, valores: Valores = []): Promise<Ejecucion> {
  const res = await pool().query(texto, valores as never[]);
  return { rowCount: res.rowCount ?? 0, rows: res.rows ?? [] };
}

/**
 * Transacción: `BEGIN`/`COMMIT` y `ROLLBACK` ante cualquier error. Se usa en las
 * cargas masivas, donde medio archivo aplicado es peor que ninguno.
 */
export async function enTransaccion<T>(fn: (tx: Cliente) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Versión de transacción sobre un cliente suelto (para el runner de migraciones). */
export async function conCliente<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function cerrarPool(): Promise<void> {
  if (global.__pgPool) {
    await global.__pgPool.end();
    global.__pgPool = undefined;
  }
}

/** Ping de salud: lo usa /api/health para distinguir "app arriba" de "base reachable". */
export async function estanSanos(): Promise<{ base: boolean; error?: string }> {
  try {
    await consultar("SELECT 1 AS ok");
    return { base: true };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (esProduccion()) log("base inaccesible", mensaje);
    return { base: false, error: mensaje };
  }
}

/**
 * Postgres devuelve los aggregate counters como string. En vez de dispersar
 * Number() por las rutas, se convierte en la frontera.
 */
export function num(valor: unknown): number {
  if (typeof valor === "number") return valor;
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function fecha(valor: unknown): string | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(d.getTime()) ? String(valor) : d.toISOString();
}

export default { consultar, consultarUno, ejecutar, enTransaccion, pool };
