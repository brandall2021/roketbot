import { NextResponse } from "next/server";

/**
 * Utilidades compartidas por las rutas HTTP ya portadas a PostgreSQL.
 *
 * Está acá (y no en `lib/db.ts`, `lib/consulta.ts` o `lib/expedientes.ts`) porque
 * esos archivos los escribe otra mano y este repo se modifica en paralelo: acá van
 * sólo helpers de capa HTTP, sin tocar la base.
 */

/** Mensaje genérico: nunca se manda el mensaje de Postgres al navegador. */
export const ERROR_INTERNO = "Error interno del servidor";

/** SQLSTATE de Postgres. Se compara por código, nunca por texto del mensaje. */
export const SQLSTATE_UNICIDAD = "23505";
export const SQLSTATE_CLAVE_FORANEA = "23503";

/** Error de validación propia: se traduce a 400 con el mensaje legible. */
export class ErrorDePeticion extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorDePeticion";
  }
}

function sqlstate(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** `23505` = violación de UNIQUE / PRIMARY KEY. */
export function esViolacionDeUnicidad(err: unknown): boolean {
  return sqlstate(err) === SQLSTATE_UNICIDAD;
}

/** `23503` = violación de FOREIGN KEY (se borra un maestro que todavía está referenciado). */
export function esViolacionDeClaveForanea(err: unknown): boolean {
  return sqlstate(err) === SQLSTATE_CLAVE_FORANEA;
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Único `catch` de las rutas: loguea con el nombre de la ruta (el código legado
 * silenció todos los errores y en producción no quedaba nada) y responde con el
 * shape `{ error }` de siempre.
 */
export function respuestaDeError(ruta: string, err: unknown): NextResponse {
  if (err instanceof ErrorDePeticion) {
    console.error(`[api/${ruta}] petición rechazada: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(`[api/${ruta}] error inesperado: ${mensaje(err)}`, err);
  return NextResponse.json({ error: ERROR_INTERNO }, { status: 500 });
}

/** Violación de unicidad ya logueada, con mensaje propio y sin filtrar el de la base. */
export function conflicto(ruta: string, err: unknown, mensajeDeConflicto: string): NextResponse {
  console.error(`[api/${ruta}] conflicto de unicidad: ${mensaje(err)}`);
  return NextResponse.json({ error: mensajeDeConflicto }, { status: 409 });
}

/**
 * Celdas que empiezan con `= + - @ TAB CR` son fórmulas: si el CSV se abre en Excel
 * o LibreOffice se ejecutan (CSV injection). El prefijo `'` las vuelve texto plano.
 * El separador de la app es `;`, pero el escapado es el mismo para `,`.
 */
const INICIO_PELIGROSO = /^[=+\-@\t\r]/;

export function escaparCelulaCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor).replace(/\r?\n/g, " ").trim();
  const segura = INICIO_PELIGROSO.test(texto) ? `'${texto}` : texto;
  return `"${segura.replace(/"/g, '""')}"`;
}

/** Una fila completa ya escapada, unida por el separador de la app (`;`). */
export function filaCsv(celdas: unknown[], separador = ";"): string {
  return celdas.map(escaparCelulaCsv).join(separador);
}

/**
 * SELECT de la carátula.
 *
 * La tabla ahora es `expedientes`, pero `app/caratula/page.tsx` sigue escrita
 * contra las claves del viejo `dbo.ExpdtesCaratula` (`ExpdteId`, `ExpdteNro`, ...),
 * así que se aliasan en la query en vez de tocar la página. Los filtros van sobre
 * las columnas reales: en Postgres un alias de salida no se puede usar en WHERE.
 */
export const CARATULA_SELECCION = `
  e.id AS "ExpdteId",
  e.numero AS "ExpdteNro",
  e.caratula AS "ExpdteCaratula",
  e.actor AS "ExpdteActor",
  e.demandado AS "ExpdteDemandado",
  e.centro_id AS "ExpdteCenJudId",
  e.unidad_judicial AS "ExpdteUnidadJud",
  e.provincia AS "ExpdteProvinciaNombre",
  e.actualizado AS "ExpdteActualizado",
  to_char(e.fch_ult_mov::date, 'YYYY-MM-DD') AS "ExpdteFchUltMov",
  to_char(e.fch_ult_proc::date, 'YYYY-MM-DD') AS "ExpdteFchUltProc",
  e.ult_mov_desc AS "ExpdteUltMovDescripcion",
  c.nombre AS "CentroJudNombre"`;

export const CARATULA_DE = `
  FROM expedientes e
  LEFT JOIN centros_judiciales c ON c.id = e.centro_id`;

/**
 * Los maestros (centros / provincias) llegan como texto desde el formulario, pero
 * las columnas son numéricas. Se valida acá y se devuelve `error` legible en vez de
 * dejar que Postgres reviente con un mensaje de tipo.
 */
export type NumeroOpcional = { valor: number | null; error?: string };

/** `codigo_endpoint`: el número de jurisdicción del PJud (antes CentroJudEquivEndpoint). */
export function comoCodigoEndpoint(raw: string | null): NumeroOpcional {
  if (!raw) return { valor: null };
  if (!/^\d{1,4}$/.test(raw)) {
    return { valor: null, error: "El endpoint debe ser un número de hasta 4 dígitos" };
  }
  return { valor: Number(raw) };
}

/** `provincia_id` (antes CentroJudPvciaId, que en el legado era texto con espacios). */
export function comoProvinciaId(raw: string | null): NumeroOpcional {
  if (!raw) return { valor: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { valor: null, error: "provinciaId inválido" };
  return { valor: n };
}

/** Id de ruta (`/api/xxx/123`): entero estricto, o null si el parámetro no calza. */
export function comoId(raw: string | null | undefined): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}


