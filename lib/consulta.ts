/**
 * Filtros y ordenamiento del listado de expedientes, ahora sobre
 * `vista_expedientes` (PostgreSQL) en lugar de la vista goolge2 de SQL Server.
 *
 * Dos reglas que vienen de la portación:
 *   - Todo valor del usuario va por posición ($1, $2...). El único fragmento de
 *     SQL que arma el código es la columna de ordenamiento, y sale de una lista
 *     blanca: un usuario no puede meter un identificador.
 *   - El viejo `Estado` de la vista era `ExpdteActualizado` (SI/NO/KO). El estado
 *     procesal (ACT/INA) es otra columna, así que los filtros se separaron en
 *     `estado` (resultado de la consulta) y `procesal` (ACT/INA).
 */

export const FUENTE = "vista_expedientes";

/** Columnas del listado. `historia` se resuelve aparte, en movimientos. */
export const CAMPOS_LISTADO = [
  "id",
  "numero",
  "caratula",
  "actor",
  "demandado",
  "centro_judicial",
  "unidad_judicial",
  "provincia",
  "estado",
  "estado_nombre",
  "actualizado",
  "fch_ult_mov",
  "ult_mov_desc",
  "documento",
  "fch_ult_proc",
  "total_movimientos",
  "origen_carga",
  "creado_por_usuario",
] as const;

const FILTROS_TEXTOALES: Record<string, string> = {
  centro: "centro_judicial",
  unidad: "unidad_judicial",
  provincia: "provincia",
  expdte: "numero",
  actor: "actor",
  demandado: "demandado",
  caratula: "caratula",
  descripcion: "ult_mov_desc",
  documento: "documento",
  estado: "actualizado",
  procesal: "estado",
};

/** `q` busca en todo lo que un usuario escribe en el cajón de búsqueda. */
const COLUMNAS_BUSQUEDA = ["numero", "caratula", "actor", "demandado", "ult_mov_desc", "documento"];

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export type Filtros = {
  where: string;
  valores: unknown[];
  usados: string[];
};

/**
 * Construye el WHERE con placeholders posicionales. Las fechas de rango se
 * validan antes de pasarlas: un `YYYY-MM-DD` mal formado revienta en Postgres
 * con un mensaje críptico, y preferimos simplemente ignorar el filtro.
 */
export function construirFiltros(params: URLSearchParams): Filtros {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  const usados: string[] = [];

  const agregar = (fragmento: string, ...vs: unknown[]) => {
    condiciones.push(fragmento);
    valores.push(...vs);
  };

  for (const [clave, columna] of Object.entries(FILTROS_TEXTOALES)) {
    const valor = params.get(clave)?.trim();
    if (!valor) continue;
    agregar(`${columna} ILIKE $${valores.length + 1}`, `%${valor}%`);
    usados.push(clave);
  }

  const q = params.get("q")?.trim();
  if (q) {
    const idx = valores.length + 1;
    agregar(
      `(${COLUMNAS_BUSQUEDA.map((c) => `${c} ILIKE $${idx}`).join(" OR ")})`,
      `%${q}%`
    );
    usados.push("q");
  }

  const desde = params.get("fechaProcesadoDesde")?.trim();
  if (desde && FECHA_VALIDA.test(desde)) {
    agregar(`fch_ult_proc::date >= $${valores.length + 1}::date`, desde);
    usados.push("fechaProcesadoDesde");
  }

  const hasta = params.get("fechaProcesadoHasta")?.trim();
  if (hasta && FECHA_VALIDA.test(hasta)) {
    agregar(`fch_ult_proc::date <= $${valores.length + 1}::date`, hasta);
    usados.push("fechaProcesadoHasta");
  }

  return {
    where: condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "",
    valores,
    usados,
  };
}

/**
 * Ordenamiento por lista blanca. `expediente` ordena numéricamente por el número
 * antes de la barra (762/22 < 1000/22), que era lo que hacía TRY_CONVERT en el
 * SQL Server; sin la guarda regex, un número no numérico rompería el cast.
 */
const ORDEN_POR_COLUMNAS: Record<string, string> = {
  numero: `CASE WHEN split_part(numero, '/', 1) ~ '^[0-9]+$'
             THEN split_part(numero, '/', 1)::bigint END`,
  expediente: `CASE WHEN split_part(numero, '/', 1) ~ '^[0-9]+$'
             THEN split_part(numero, '/', 1)::bigint END`,
  caratula: "caratula",
  actor: "actor",
  demandado: "demandado",
  centro: "centro_judicial",
  unidad: "unidad_judicial",
  provincia: "provincia",
  fecha: "fch_ult_mov",
  fechaprocesado: "fch_ult_proc",
  descripcion: "ult_mov_desc",
  documento: "documento",
  estado: "actualizado",
  procesal: "estado",
  movimientos: "total_movimientos",
};

export function orden(params: URLSearchParams): string {
  const sort = (params.get("sort") || "expediente").toLowerCase();
  const dir = params.get("order")?.toLowerCase() === "desc" ? "DESC" : "ASC";
  const columna = ORDEN_POR_COLUMNAS[sort] || ORDEN_POR_COLUMNAS.expediente;
  return `${columna} ${dir} NULLS LAST`;
}

/** Página y tamaño de página, acotados: sin tope, `pageSize=1000000` es un DoS propio. */
export function paginacion(params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page") || 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") || 20) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * `DD/MM/AAAA` con getters UTC, que es lo que la UI mostraba del legado.
 *
 * Las columnas `date` llegan como cadena `YYYY-MM-DD` (el parser de `lib/db.ts`) y
 * `new Date("2026-10-20")` es medianoche UTC: los getters de UTC devuelven el día
 * guardado, sea cual sea la zona del contenedor. Lo único que sigue llegando como
 * `Date` es `timestamptz` (`fch_ult_proc`), y ahí se muestra el día **UTC** del
 * instante; por eso el Dockerfile fija `TZ=UTC` y el panel no depende de la zona del host.
 */
export function formatoDmY(valor: unknown): string | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return String(valor);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/**
 * Shim de compatibilidad: los componentes leen las filas con los nombres de
 * columnas de la vista goolge2 (`row["Centro Judicial"]`, `row["Expdte"]`).
 * Cambiar las claves obligaría a tocar media UI por un cambio que es de base de
 * datos, no de producto. Lo que se agrega a lo de antes: `Id` (ahora estable,
 * antes había que desambiguar por centro/unidad) y los dos estados separados.
 */
export function filaVista(r: Record<string, unknown>): Record<string, unknown> {
  return {
    Id: r.id,
    "Centro Judicial": r.centro_judicial,
    "Unidad Judicial": r.unidad_judicial,
    Expdte: r.numero,
    "Carátula": r.caratula,
    Actor: r.actor,
    Demandado: r.demandado,
    Fecha: formatoDmY(r.fch_ult_mov),
    Descripcion: r.ult_mov_desc,
    Documento: r.documento,
    "Fecha Procesado": formatoDmY(r.fch_ult_proc),
    /** SI / NO / KO: lo que la vista llamaba "Estado". */
    Estado: r.actualizado,
    "Estado Procesal": r.estado,
    "Estado Nombre": r.estado_nombre,
    Provincia: r.provincia,
    Movimientos: r.total_movimientos,
    Origen: r.origen_carga,
    "Creado Por": r.creado_por_usuario,
  };
}

export function filasVista(filas: Record<string, unknown>[]): Record<string, unknown>[] {
  return filas.map(filaVista);
}
