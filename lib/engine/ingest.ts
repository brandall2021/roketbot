import { consultar, consultarUno, ejecutar, enTransaccion, num, type Valores } from "../db";
import {
  descripcionDe,
  hashMovimiento,
  parseFechaPjud,
  type Dia,
  type PjudClient,
  type Story,
} from "./pjud";

/**
 * Ingesta de un expediente: consulta al PJud, alta de los movimientos nuevos y
 * marca de resultado (antes, en Python, `worker.procesar_expediente`).
 *
 * La idempotencia la da el `UNIQUE (expediente_id, hash_unico)` de `movimientos`:
 * el insert va con `ON CONFLICT DO NOTHING ... RETURNING id`, así que la cantidad
 * de filas devueltas ES la cantidad de movimientos nuevos reales. Eso es lo que
 * distingue SI de NO: si todo lo que vino ya estaba registrado, el expediente no
 * se actualizó, por más que el endpoint haya contestado cosas.
 *
 * (En Python se hacía un SELECT por movimiento antes de insertar; acá el conflicto
 * hace el mismo trabajo con una sola query por expediente.)
 */

export type Resultado = "SI" | "NO" | "KO";

export type ExpedienteConsulta = {
  id: number;
  numero: string;
  jurisdiccion: number;
  estado: string;
  fchUltMov: Dia | null;
};

export type Proceso = {
  resultado: Resultado;
  motivo: string | null;
  insertados: number;
};

/** Cliente de transacción: `pg` y el `ejecutar` del módulo comparten esta forma. */
type Ejecutor = (texto: string, valores?: Valores) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>;

function comoExpediente(fila: Record<string, unknown>): ExpedienteConsulta {
  return {
    id: num(fila.id),
    numero: String(fila.numero ?? ""),
    jurisdiccion: num(fila.jurisdiccion),
    estado: String(fila.estado ?? ""),
    fchUltMov: (fila.fch_ult_mov as Dia | null) ?? null,
  };
}

/**
 * Primero los nunca consultados; después los más viejos (`fch_ult_proc ASC NULLS
 * FIRST`). Exactamente el orden del bot: garantiza que ningún expediente activo
 * quede indefinidamente sin consultar aunque la corrida corte por límite.
 */
export async function expedientesPendientes(limite: number): Promise<ExpedienteConsulta[]> {
  const filas = await consultar<Record<string, unknown>>(
    `SELECT id, numero, jurisdiccion, estado, fch_ult_mov
       FROM expedientes
      WHERE estado = 'ACT'
      ORDER BY fch_ult_proc ASC NULLS FIRST, id ASC
      LIMIT $1`,
    [Math.max(1, Math.trunc(limite))]
  );
  return filas.map(comoExpediente);
}

/** Un solo expediente por id; lo pide el reintento tras un token rechazado. */
export async function expedientePorId(id: number): Promise<ExpedienteConsulta | null> {
  const fila = await consultarUno<Record<string, unknown>>(
    `SELECT id, numero, jurisdiccion, estado, fch_ult_mov FROM expedientes WHERE id = $1`,
    [id]
  );
  return fila ? comoExpediente(fila) : null;
}

/**
 * Da de alta los movimientos y actualiza el "último movimiento" del expediente.
 * Todo o nada: un expediente marcado SI sin sus movimientos (o al revés) es el
 * estado inconsistente que el legado tenía.
 */
export async function registrarMovimientos(
  expediente: ExpedienteConsulta,
  nuevas: Story[],
  run: Ejecutor = ejecutar
): Promise<number> {
  if (nuevas.length === 0) return 0;

  const valores: Valores = [];
  const tuples: string[] = [];

  for (const story of nuevas) {
    const fecha = parseFechaPjud(story.fecha);
    const descripcion = descripcionDe(story);
    const huella = hashMovimiento(fecha, descripcion);
    const texto = String(story.texto ?? "").trim() || null;
    const enlace = String(story.link ?? "").trim() || null;
    const histid = story.histid === null || story.histid === undefined ? null : String(story.histid);

    const n = valores.length;
    valores.push(expediente.id, fecha, descripcion, texto, enlace, histid, huella);
    tuples.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, 'pjud')`);
  }

  const { rows } = await run(
    `INSERT INTO movimientos (expediente_id, fecha, descripcion, texto, link, histid, hash_unico, origen)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (expediente_id, hash_unico) DO NOTHING
     RETURNING id`,
    valores
  );

  // `nuevas` viene ordenado ascendente por fecha (lo garantiza filtrarNuevas), así
  // que el último elemento es el movimiento más reciente. COALESCE: una descripción
  // vacía no borra la que ya estaba.
  const ultima = nuevas[nuevas.length - 1];
  await run(
    `UPDATE expedientes
        SET fch_ult_mov  = COALESCE($2, fch_ult_mov),
            ult_mov_desc = COALESCE($3, ult_mov_desc)
      WHERE id = $1`,
    [expediente.id, parseFechaPjud(ultima.fecha), descripcionDe(ultima)]
  );

  return rows.length;
}

/** Marca el resultado de la consulta sobre el expediente. */
export async function marcarResultado(expedienteId: number, resultado: Resultado): Promise<void> {
  await ejecutar(
    `UPDATE expedientes
        SET actualizado = $2,
            fch_ult_proc = now()
      WHERE id = $1`,
    [expedienteId, resultado]
  );
}

/**
 * Consulta un expediente y persiste lo que trajo. NO captura nada: un fallo del
 * PJud tiene que subir hasta la corrida, que es la que decide si sigue con el
 * resto del padrón o aborta.
 */
export async function procesarExpediente(
  client: PjudClient,
  token: string,
  expediente: ExpedienteConsulta
): Promise<Proceso> {
  const { encontrado, nuevas } = await client.consultar(
    expediente.numero,
    expediente.jurisdiccion,
    token,
    expediente.fchUltMov
  );

  if (!encontrado) {
    await marcarResultado(expediente.id, "KO");
    return {
      resultado: "KO",
      motivo: "el endpoint no devolvió datos para el expediente",
      insertados: 0,
    };
  }

  if (nuevas.length === 0) {
    await marcarResultado(expediente.id, "NO");
    return { resultado: "NO", motivo: null, insertados: 0 };
  }

  const insertados = await enTransaccion((tx) =>
    registrarMovimientos(expediente, nuevas, (texto, valores) =>
      tx.query(texto, valores as unknown[]).then((r) => ({ rowCount: r.rowCount ?? 0, rows: r.rows }))
    )
  );

  const resultado: Resultado = insertados > 0 ? "SI" : "NO";
  await marcarResultado(expediente.id, resultado);
  return { resultado, motivo: null, insertados };
}
