import { parse } from "csv-parse";

export type ExpedienteInput = {
  centroJudicial: string | null;
  unidadJudicial: string | null;
  cenJudId: string | null;
  expdte: string | null;
  actor: string | null;
  demandado: string | null;
  fecha: string | null;
  descripcion: string | null;
  documento: string | null;
  fechaProcesado: string | null;
  estado: string | null;
  estadoProcesal: string | null;
  estadoProcesalNombre: string | null;
  caratula: string | null;
  historia: string | null;
};

export type ColumnMapping = Partial<Record<keyof ExpedienteInput, string>>;

export const IMPORT_FIELDS: (keyof ExpedienteInput)[] = [
  "expdte",
  "centroJudicial",
  "unidadJudicial",
  "cenJudId",
  "actor",
  "demandado",
  "fecha",
  "descripcion",
  "fechaProcesado",
  "estado",
  "estadoProcesal",
  "estadoProcesalNombre",
  "caratula",
  "historia",
];

const HEADER_ALIASES: Record<string, keyof ExpedienteInput> = {
  "centro judicial": "centroJudicial",
  "centro_judicial": "centroJudicial",
  centrojudicial: "centroJudicial",
  "unidad judicial": "unidadJudicial",
  "unidad_judicial": "unidadJudicial",
  unidadjudicial: "unidadJudicial",
  expdte: "expdte",
  expediente: "expdte",
  expdtecenjudid: "cenJudId",
  cenjudid: "cenJudId",
  centrojudicialid: "cenJudId",
  "centro judicial id": "cenJudId",
  "id centro": "cenJudId",
  idcentro: "cenJudId",
  "id centro judicial": "cenJudId",
  actor: "actor",
  demandado: "demandado",
  fecha: "fecha",
  descripcion: "descripcion",
  documento: "documento",
  "fecha procesado": "fechaProcesado",
  "fecha_procesado": "fechaProcesado",
  fechaprocesado: "fechaProcesado",
  estado: "estadoProcesal",
  expdteestado: "estadoProcesal",
  "estado procesal": "estadoProcesal",
  estadoprocesal: "estadoProcesal",
  "estado del expediente": "estadoProcesal",
  expdteestadonombre: "estadoProcesalNombre",
  estadonombre: "estadoProcesalNombre",
  "estado procesal nombre": "estadoProcesalNombre",
  "nombre estado": "estadoProcesalNombre",
  nombreestado: "estadoProcesalNombre",
  caratula: "caratula",
  "carátula": "caratula",
  historia: "historia",
  "estado actualizado": "estado",
  expdteactualizado: "estado",
};

function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;

  // Some user-uploaded CSVs come from Excel in latin1/cp1252.
  // Falling back preserves accented characters and ñ.
  return buffer.toString("latin1");
}

function parseRows(
  buffer: Buffer,
  mapping?: ColumnMapping
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    const csv = decodeCsvBuffer(buffer);
    parse(
      csv,
      {
        columns: true,
        delimiter: [",", ";"],
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      },
      (err, rows: Record<string, string>[]) => {
        if (err) return reject(err);
        const columns = rows.length ? Object.keys(rows[0]) : [];
        resolve({ columns, rows });
      }
    );
  });
}

export async function parseCsvPreview(
  buffer: Buffer
): Promise<{ columns: string[]; rows: Record<string, string>[]; total: number; errors: string[] }> {
  const { columns, rows } = await parseRows(buffer);
  return { columns, rows: rows.slice(0, 5), total: rows.length, errors: [] };
}

export async function parseCsv(
  buffer: Buffer,
  mapping?: ColumnMapping
): Promise<{ records: ExpedienteInput[]; errors: string[]; columns: string[] }> {
  const { columns, rows } = await parseRows(buffer, mapping);
  const errors: string[] = [];

  const colFor = (field: keyof ExpedienteInput): string | null => {
    const explicit = mapping?.[field];
    if (explicit) return explicit;
    return columns.find((c) => HEADER_ALIASES[c.trim().toLowerCase()] === field) ?? null;
  };

  const pick = (field: keyof ExpedienteInput, row: Record<string, string>): string | null => {
    const col = colFor(field);
    if (!col) return null;
    const v = row[col];
    return v && String(v).trim() !== "" ? String(v).trim() : null;
  };

  const records: ExpedienteInput[] = rows.map((row) => ({
    centroJudicial: pick("centroJudicial", row),
    unidadJudicial: pick("unidadJudicial", row),
    cenJudId: pick("cenJudId", row),
    expdte: pick("expdte", row),
    actor: pick("actor", row),
    demandado: pick("demandado", row),
    fecha: pick("fecha", row),
    descripcion: pick("descripcion", row),
    documento: pick("documento", row),
    fechaProcesado: pick("fechaProcesado", row),
    estado: pick("estado", row),
    estadoProcesal: pick("estadoProcesal", row),
    estadoProcesalNombre: pick("estadoProcesalNombre", row),
    caratula: pick("caratula", row),
    historia: pick("historia", row),
  }));

  records.forEach((r, i) => {
    if (!r.expdte) errors.push(`Fila ${i + 1}: falta el expediente (columna no mapeada o vacía)`);
  });

  return { records, errors, columns };
}

/* -------------------------------------------------------------------------- */
/* Actualización masiva de estado procesal                                     */
/* (antes lib/expedientes-actualizacion.js, puro CSV sin tocar la base)        */
/* -------------------------------------------------------------------------- */

export type ActualizarRegistro = {
  expdte: string | null;
  codEstado: string | null;
  estado: string | null;
};

export type PreviewActualizar = {
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  errors: string[];
  records: ActualizarRegistro[];
};

/**
 * Cabeceras que traen los archivos del Poder Judicial para el mismo campo. Están
 * en el orden de preferencia del legado: `CodEstado` se resuelve con el valor de
 * `Estado` si aquel falta, y `Estado` acepta el encabezado largo.
 */
const ACTUALIZAR_ALIAS: Record<keyof ActualizarRegistro, string[]> = {
  expdte: ["expdte", "expediente"],
  codEstado: ["codestado", "estado", "estado atraves de expdte"],
  estado: ["estado", "estado atraves de expdte"],
};

function normalizarClave(columna: string): string {
  return columna.trim().toLowerCase();
}

/**
 * Parsea el CSV de actualización y devuelve el preview (`columns`/`rows`/`total`)
 * más los `records` listos para `actualizarEnMasa`. Es lógica pura de CSV: no toca
 * la base, así que se puede probar sin PostgreSQL.
 */
export async function parseCsvActualizar(buffer: Buffer): Promise<PreviewActualizar> {
  const { columns, rows } = await parseRows(buffer);

  // Header del archivo -> nombre canónico en minúscula, la primera aparición gana.
  const porAlias = new Map<string, string>();
  for (const columna of columns) {
    const clave = normalizarClave(columna);
    if (!porAlias.has(clave)) porAlias.set(clave, columna);
  }

  const leer = (row: Record<string, string>, alias: string): string | null => {
    const columna = porAlias.get(alias);
    if (!columna) return null;
    const valor = row[columna];
    if (valor === undefined || valor === null) return null;
    const limpio = String(valor).trim();
    return limpio === "" ? null : limpio;
  };

  const primera = (row: Record<string, string>, campo: keyof ActualizarRegistro): string | null => {
    for (const alias of ACTUALIZAR_ALIAS[campo]) {
      const valor = leer(row, alias);
      if (valor) return valor;
    }
    return null;
  };

  const records: ActualizarRegistro[] = rows.map((row) => ({
    expdte: primera(row, "expdte"),
    codEstado: primera(row, "codEstado"),
    estado: primera(row, "estado"),
  }));

  const errors: string[] = [];
  records.forEach((r, i) => {
    if (!r.expdte) errors.push(`Fila ${i + 1}: falta Expdte`);
    if (!r.codEstado) errors.push(`Fila ${i + 1}: falta CodEstado`);
    if (!r.estado) errors.push(`Fila ${i + 1}: falta Estado`);
  });

  return { columns, rows: rows.slice(0, 5), total: rows.length, errors, records };
}
