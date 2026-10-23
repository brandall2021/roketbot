import { consultar, consultarUno, ejecutar, enTransaccion, num } from "./db";
import type { Valores } from "./db";
import { parseFechaPjud, type Dia } from "./engine/pjud";
import { ErrorDePeticion } from "./rutas";

/**
 * Escritura de expedientes sobre PostgreSQL.
 *
 * En SQL Server esto era un baile: `MAX(ExpdteId)+1` por insert, un pre-fetch de
 * todos los números existentes para no duplicar, y dos tablas (`ExpdtesCaratula`
 * + `app_expedientes`) guardando el mismo registro. Acá la clave la da la base
 * (identity) y el anti-duplicado lo da el `UNIQUE (numero, jurisdiccion)` con
 * `ON CONFLICT DO NOTHING`: la fila duplicada no se inserta y devuelve 0 filas,
 * así el contador de duplicados es exacto sin precargar la tabla.
 *
 * `jurisdiccion` no es un detalle decorativo: es el `codigo_endpoint` del centro
 * que usa el PJud, y forma parte de la clave única junto con `numero`. Usar 0 por
 * default duplicaría un expediente que el padrón ya tiene con su jurisdicción.
 */

export type CargaInput = {
  centroJudicial?: string | null;
  unidadJudicial?: string | null;
  /** `ExpdteCenJudId` del legado, o el `codigo_endpoint` del PJud. */
  cenJudId?: string | null;
  expdte?: string | null;
  actor?: string | null;
  demandado?: string | null;
  caratula?: string | null;
  fecha?: string | null;
  descripcion?: string | null;
  documento?: string | null;
  fechaProcesado?: string | null;
  /** SI / NO / KO: resultado de la consulta al PJud (antes `ExpdteActualizado`). */
  estado?: string | null;
  /** ACT / INA: estado procesal (antes `ExpdteEstado`). */
  estadoProcesal?: string | null;
  estadoProcesalNombre?: string | null;
};

export type OrigenCarga = "MANUAL" | "CSV" | "MASIVO";

const RESULTADOS = new Set(["SI", "NO", "KO"]);
const PROCESALES = new Set(["ACT", "INA"]);

export function limpiar(valor?: string | null): string {
  return (valor ?? "").trim();
}

/**
 * Fechas tal como vienen del CSV o del legado: `DD/MM/AAAA`, `DD/MM/AA`, `DD-MM-AAAA`
 * o ISO. `new Date("12/03/2024")` interpreta en orden estadounidense, que en un padrón
 * argentino invierte día y mes sin avisar: por eso el parseo es explícito.
 *
 * Devuelve la cadena `YYYY-MM-DD` (el `Dia` del motor), no un `Date`. Un `Date` a
 * medianoche UTC serializa con los componentes **locales** de `pg`: en un contenedor
 * con `TZ=America/Argentina/Buenos_Aires` el día se escribe uno antes. Como cadena,
 * Postgres hace el cast directo a `date` y la zona horaria del proceso deja de
 * importar. Es la misma función que usa el PJud, así que el CSV y las corridas
 * validan el calendario igual (`31/02/2026` y `13/13/13` no pasan).
 */
export function parseFecha(s?: string | null): Dia | null {
  return parseFechaPjud(s);
}

export function caratulaAuto(r: CargaInput): string {
  return `${limpiar(r.actor)} C/ ${limpiar(r.demandado)}`.trim();
}

/** Devuelve el error legible o null si el registro calza. */
export function validar(r: CargaInput): string | null {
  const numero = limpiar(r.expdte);
  if (!numero) return "falta el número de expediente";
  if (numero.length > 64) return "expediente supera 64 caracteres";

  const actualizado = limpiar(r.estado).toUpperCase();
  if (actualizado.length > 4) return "estado (SI/NO/KO) supera 4 caracteres";
  if (actualizado && !RESULTADOS.has(actualizado)) return `estado "${actualizado}" inválido: usá SI, NO o KO`;

  const procesal = limpiar(r.estadoProcesal).toUpperCase();
  if (procesal.length > 8) return "estado procesal supera 8 caracteres";
  if (procesal && !PROCESALES.has(procesal)) return `estado procesal "${procesal}" inválido: usá ACT o INA`;

  if (limpiar(r.estadoProcesalNombre).length > 40) return "nombre del estado procesal supera 40 caracteres";
  if (limpiar(r.caratula).length > 400) return "carátula supera 400 caracteres";
  if (limpiar(r.documento).length > 2000) return "documento (URL) supera 2000 caracteres";

  // Una fecha ilegible no puede quedar NULL sin decir nada: la fila se rechaza y
  // aparece en el conteo de errores del archivo (antes se insertaba con la fecha
  // perdida y el usuario no se enteraba).
  const fecha = limpiar(r.fecha);
  if (fecha && !parseFecha(fecha)) return `fecha de movimiento inválida: "${fecha}"`;
  const procesado = limpiar(r.fechaProcesado);
  if (procesado && !parseFecha(procesado)) return `fecha procesado inválida: "${procesado}"`;
  return null;
}

export type CentroResuelto = {
  id: number;
  nombre: string;
  unidad: string | null;
  provincia: string | null;
  /** Código del PJud; sin relevamiento, 0 = todavía no se puede consultar. */
  jurisdiccion: number;
};

const SQL_CENTRO = `
  SELECT c.id, c.nombre, c.unidad, c.codigo_endpoint, p.nombre AS provincia
    FROM centros_judiciales c
    LEFT JOIN provincias p ON p.id = c.provincia_id
`;

type FilaCentro = {
  id: number | string;
  nombre: string;
  unidad: string | null;
  codigo_endpoint: number | string | null;
  provincia: string | null;
};

function comoCentro(f: FilaCentro): CentroResuelto {
  return {
    id: num(f.id),
    nombre: f.nombre,
    unidad: f.unidad,
    provincia: f.provincia,
    jurisdiccion: f.codigo_endpoint === null ? 0 : num(f.codigo_endpoint),
  };
}

/**
 * Resuelve el centro por id propio, id legado o código de endpoint; si no viene
 * ningún id, por nombre+unidad (los nombres se repiten, por eso la unidad acompaña).
 */
export async function resolverCentro(r: CargaInput): Promise<{ centro: CentroResuelto | null; error?: string }> {
  const idRaw = limpiar(r.cenJudId);

  if (idRaw) {
    const idNum = Number(idRaw);
    if (!Number.isFinite(idNum)) return { centro: null, error: `ID de centro judicial inválido: "${idRaw}"` };

    const fila = await consultarUno<Parameters<typeof comoCentro>[0]>(
      `${SQL_CENTRO}
        WHERE c.id = $1 OR c.legado_id = $1 OR c.codigo_endpoint = $1
        ORDER BY (c.id = $1) DESC NULLS LAST, c.id
        LIMIT 1`,
      [Math.trunc(idNum)]
    );
    if (!fila) return { centro: null, error: `centro judicial no encontrado: ID ${idRaw}` };
    return { centro: comoCentro(fila) };
  }

  const nombre = limpiar(r.centroJudicial);
  const unidad = limpiar(r.unidadJudicial);
  if (!nombre) return { centro: null, error: "falta el centro judicial" };

  const fila = await consultarUno<Parameters<typeof comoCentro>[0]>(
    `${SQL_CENTRO}
      WHERE TRIM(c.nombre) = $1
        AND ($2 = '' OR COALESCE(TRIM(c.unidad), '') = $2)
      ORDER BY c.id
      LIMIT 1`,
    [nombre, unidad]
  );
  if (!fila) return { centro: null, error: `centro judicial no encontrado: "${nombre}" / "${unidad}"` };
  return { centro: comoCentro(fila) };
}

/**
 * Valores del INSERT en el mismo orden que la columna `SQL_ALTA`. Centralizarlo
 * evita que el alta manual y el lote de CSV llenquen campos en distinto orden,
 * que es el tipo de error que Postgres no avisa.
 */
function valoresDeAlta(r: CargaInput, creadoPor: number, origen: OrigenCarga, centro: CentroResuelto): Valores {
  const procesal = limpiar(r.estadoProcesal).toUpperCase() || "ACT";
  return [
    limpiar(r.expdte),
    centro.jurisdiccion,
    centro.provincia ?? "Tucumán",
    centro.id,
    limpiar(r.unidadJudicial) || centro.unidad || null,
    limpiar(r.caratula) || caratulaAuto(r),
    limpiar(r.actor) || null,
    limpiar(r.demandado) || null,
    parseFecha(r.fecha),
    limpiar(r.descripcion) || null,
    limpiar(r.documento) || null,
    limpiar(r.fechaProcesado) ? parseFecha(r.fechaProcesado) : null,
    limpiar(r.estado).toUpperCase() || null,
    procesal,
    limpiar(r.estadoProcesalNombre).toUpperCase() || (procesal === "ACT" ? "ACTIVO" : "INACTIVO"),
    origen,
    creadoPor,
  ];
}

const SQL_ALTA = `
  INSERT INTO expedientes
    (numero, jurisdiccion, provincia, centro_id, unidad_judicial, caratula, actor, demandado,
     fch_ult_mov, ult_mov_desc, documento, fch_ult_proc, actualizado,
     estado, estado_nombre, origen_carga, creado_por, carga_en)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
  ON CONFLICT (numero, jurisdiccion) DO NOTHING
  RETURNING id
`;

/** Alta de un expediente (la usa el formulario manual; los lotes van por cargarLote). */
export async function darAlta(
  r: CargaInput,
  creadoPor: number,
  origen: OrigenCarga
): Promise<{ insertado: boolean; duplicado: boolean; id?: number; error?: string }> {
  const error = validar(r);
  if (error) return { insertado: false, duplicado: false, error };

  const { centro, error: errorCentro } = await resolverCentro(r);
  if (!centro) return { insertado: false, duplicado: false, error: errorCentro ?? "centro judicial no resuelto" };

  const filas = await consultar<{ id: number }>(SQL_ALTA, valoresDeAlta(r, creadoPor, origen, centro));
  if (!filas.length) return { insertado: false, duplicado: true };
  return { insertado: true, duplicado: false, id: num(filas[0].id) };
}

export type LoteResultado = { insertados: number; duplicados: number; errores: string[] };

/**
 * Alta por lote (CSV). Todo en una transacción: si el archivo se cae a la mitad,
 * no queda medio padrón cargado. Las filas inválidas no cortan el lote: se
 * acumulan en `errores`, igual que hacía la app vieja.
 */
export async function cargarLote(rows: CargaInput[], creadoPor: number, origen: OrigenCarga): Promise<LoteResultado> {
  return enTransaccion(async (tx) => {
    let insertados = 0;
    let duplicados = 0;
    const errores: string[] = [];

    for (const r of rows) {
      const numero = limpiar(r.expdte);
      try {
        const error = validar(r);
        if (error) throw new Error(error);

        const { centro, error: errorCentro } = await resolverCentro(r);
        if (!centro) throw new Error(errorCentro ?? "centro judicial no resuelto");

        const res = await tx.query(SQL_ALTA, valoresDeAlta(r, creadoPor, origen, centro));
        if (res.rowCount) insertados++;
        else duplicados++;
      } catch (e) {
        errores.push(`Expediente "${numero || "(sin número)"}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { insertados, duplicados, errores };
  });
}

export type CargaRegistro = {
  archivo: string;
  tamano: number;
  filasLeidas: number;
  insertados: number;
  duplicados: number;
  actualizados?: number;
  errores: string[];
  origen?: string;
};

/** Auditoría del archivo subido (antes dbo.app_cargas). */
export async function registrarCarga(c: CargaRegistro, creadoPor: number): Promise<number> {
  const filas = await consultar<{ id: number }>(
    `INSERT INTO cargas
       (archivo, tamano, filas_leidas, insertados, duplicados, actualizados, errores, detalle_errores, origen, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      c.archivo.slice(0, 255),
      c.tamano,
      c.filasLeidas,
      c.insertados,
      c.duplicados,
      c.actualizados ?? 0,
      c.errores.length,
      c.errores.length ? c.errores.join("\n").slice(0, 8000) : null,
      c.origen ?? "CSV",
      creadoPor,
    ]
  );
  return num(filas[0]?.id);
}

/**
 * Bulk update de estado procesal desde CSV (CodEstado + Estado). Los expedientes
 * que no existen se reportan como error y no se crean: un archivo viejo no tiene
 * que inventar registros que nadie dio de alta.
 */
export async function actualizarEnMasa(
  records: { expdte: string; codEstado?: string | null; estado?: string | null }[]
): Promise<{ actualizados: number; errores: string[] }> {
  return enTransaccion(async (tx) => {
    let actualizados = 0;
    const errores: string[] = [];

    for (const row of records) {
      const numero = limpiar(row.expdte);
      try {
        if (!numero) throw new Error("falta el expediente");
        const codEstado = limpiar(row.codEstado).toUpperCase();
        const estadoNombre = limpiar(row.estado).toUpperCase();
        if (!codEstado || !estadoNombre) throw new Error("falta CodEstado o Estado");
        if (!PROCESALES.has(codEstado)) throw new Error(`CodEstado "${codEstado}" inválido: usá ACT o INA`);

        const res = await tx.query(
          `UPDATE expedientes
              SET estado = $2,
                  estado_nombre = $3,
                  fch_ult_proc = COALESCE(fch_ult_proc, now())
            WHERE numero = $1`,
          [numero, codEstado, estadoNombre]
        );
        if (!res.rowCount) throw new Error("no se encontró el expediente");
        actualizados += res.rowCount;
      } catch (e) {
        errores.push(`Expediente "${numero || "(sin número)"}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { actualizados, errores };
  });
}

/** Campos editables desde la UI, siempre por lista blanca (nunca un SET arbitrario). */
const EDITABLES: Record<string, string> = {
  numero: "numero",
  caratula: "caratula",
  actor: "actor",
  demandado: "demandado",
  centroId: "centro_id",
  unidadJudicial: "unidad_judicial",
  provincia: "provincia",
  fecha: "fch_ult_mov",
  fechaProcesado: "fch_ult_proc",
  descripcion: "ult_mov_desc",
  documento: "documento",
  estado: "actualizado",
  procesal: "estado",
  estadoNombre: "estado_nombre",
};

const FECHABLES = new Set(["fch_ult_mov", "fch_ult_proc"]);

export async function actualizarExpediente(
  id: number,
  body: Record<string, unknown>
): Promise<{ actualizados: number; campos: string[] }> {
  const sets: string[] = [];
  const valores: Valores = [id];

  for (const [clave, columna] of Object.entries(EDITABLES)) {
    const raw = body[clave];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "string" && !raw.trim()) continue;

    if (FECHABLES.has(columna)) {
      const dia = parseFecha(String(raw));
      // Sin este filtro un `13/13/13` escrito en el formulario borra la fecha: el
      // UPDATE sale NULL y el expediente queda como si nunca hubiera tenido movimiento.
      if (!dia) throw new ErrorDePeticion(`fecha inválida en "${clave}": ${String(raw).trim()}`);
      valores.push(dia);
    } else {
      valores.push(String(raw).trim());
    }
    sets.push(`${columna} = $${valores.length}`);
  }

  if (!sets.length) throw new Error("No hay campos para actualizar");

  const res = await ejecutar(`UPDATE expedientes SET ${sets.join(", ")} WHERE id = $1`, valores);
  return { actualizados: res.rowCount, campos: sets.map((s) => s.split(" = ")[0]) };
}
