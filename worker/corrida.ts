import { consultarUno, ejecutar, num } from "../lib/db";
import { entero, opcional } from "../lib/config";
import { koParaReintentar } from "../lib/corridas";
import { CaptchaError, TokenManager } from "../lib/engine/captcha";
import { CaptchaInvalido, PjudClient } from "../lib/engine/pjud";
import {
  expedientesPendientes,
  expedientePorId,
  marcarResultado,
  procesarExpediente,
  type ExpedienteConsulta,
  type Resultado,
} from "../lib/engine/ingest";
import { notificarCorrida } from "../lib/mailer";
import {
  guardarProgramacionCorridas,
  programarSiguienteTrasCorrida,
  reclamarCorridaProgramada,
} from "../lib/programacion";
import {
  finalizarSolicitudIndividual,
  reclamarSolicitudIndividual,
} from "../lib/solicitudes-corrida";

/**
 * Corrida de consulta contra el PJud (antes `worker.py` del bot Python).
 *
 * Tres propiedades que hay que conservar porque son las que el bot ya había
 * probado en producción:
 *
 *   1. Idempotencia: un movimiento no se inserta dos veces (UNIQUE + hash).
 *   2. Aislamiento: si un expediente falla, la corrida sigue y queda el motivo.
 *   3. Abortar ante captcha: si el token vuelve a ser rechazado después de
 *      renovarlo, la corrida se corta y queda FAILED. Seguir llenaría la base de
 *      KO falsos, y un KO falso es peor que una corrida incompleta.
 *
 * Todo el estado vive en Postgres (`corridas` / `corrida_items`), no en logs.
 */

/** Límite duro por corrida: era MAX_EXPEDIENTES_PER_RUN=500 en el bot. */
export function limitePorCorrida(): number {
  return entero("MAX_EXPEDIENTES_PER_RUN", 500);
}

export type CorridaCreada = { id: number };

async function crearCorrida(modo: string): Promise<number> {
  const { rows } = await ejecutar(
    `INSERT INTO corridas (modo, estado, total, cnt_si, cnt_no, cnt_ko)
     VALUES ($1, 'RUNNING', 0, 0, 0, 0)
     RETURNING id`,
    [modo]
  );
  return num((rows[0] as { id: number | string } | undefined)?.id);
}

async function cerrarCorrida(
  id: number,
  contadores: Record<Resultado, number>,
  error: string | null
): Promise<void> {
  await ejecutar(
    `UPDATE corridas
        SET fin = now(),
            estado = $2,
            error = $3,
            cnt_si = $4,
            cnt_no = $5,
            cnt_ko = $6
      WHERE id = $1`,
    [id, error ? "FAILED" : "DONE", error, contadores.SI, contadores.NO, contadores.KO]
  );
}

async function registrarItem(
  corridaId: number,
  expedienteId: number | null,
  resultado: Resultado,
  motivo: string | null,
  insertados: number,
  duracionMs: number
): Promise<void> {
  await ejecutar(
    `INSERT INTO corrida_items
       (corrida_id, expediente_id, resultado, motivo, movimientos_nuevos, duracion_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [corridaId, expedienteId, resultado, motivo, insertados, Math.max(0, Math.round(duracionMs))]
  );
}

/**
 * Procesa un expediente; si el token venció, el PJud lo rechaza: se renueva y se
 * reintenta exactamente una vez, sobre una fila fresca (la anterior puede haber
 * quedado con el `fch_ult_mov` de medio proceso).
 */
async function procesarConReintento(
  client: PjudClient,
  tokens: TokenManager,
  expediente: ExpedienteConsulta
): Promise<{ resultado: Resultado; motivo: string | null; insertados: number }> {
  try {
    return await procesarExpediente(client, await tokens.get(), expediente);
  } catch (e) {
    if (!(e instanceof CaptchaInvalido)) throw e;
    console.warn(`[worker] token rechazado al consultar ${expediente.numero}: se renueva y se reintenta`);
    const fresco = await expedientePorId(expediente.id);
    if (!fresco) throw e;
    return procesarExpediente(client, await tokens.get(true), fresco);
  }
}

export type OpcionesCorrida = {
  /** Token fijo para probar sin resolver captcha. */
  token?: string | null;
  limite?: number;
  /** ID interno para ejecutar sólo un expediente. */
  expedienteId?: number;
  notificar?: boolean;
  modo?: string;
};

/**
 * Ejecuta una corrida completa y devuelve el id de la corrida.
 *
 * No lanza excepciones por fallos del PJud: eso es información de la corrida. Sí
 * deja subir un error de base (si Postgres está caído no hay corrida que registrar).
 */
export async function correrUna(opts: OpcionesCorrida = {}): Promise<number> {
  const limite = opts.limite ?? limitePorCorrida();
  const modo = opts.modo ?? (opts.expedienteId === undefined ? "pjud" : "pjud-individual");
  const expedientes = opts.expedienteId === undefined
    ? await expedientesPendientes(limite)
    : [await expedientePorId(opts.expedienteId)].filter((e): e is ExpedienteConsulta => e !== null);
  if (opts.expedienteId !== undefined && expedientes.length === 0) {
    throw new Error(`No existe un expediente con ID ${opts.expedienteId}`);
  }
  const tokens = new TokenManager({
    fijo: opts.token ?? (opcional("CAPTCHA_TOKEN") || null),
  });

  const corridaId = await crearCorrida(modo);
  await ejecutar(`UPDATE corridas SET total = $2 WHERE id = $1`, [corridaId, expedientes.length]);
  console.log(`[worker] corrida ${corridaId}: ${expedientes.length} expedientes a procesar`);

  const contadores: Record<Resultado, number> = { SI: 0, NO: 0, KO: 0 };
  let errorCorrida: string | null = null;
  const client = new PjudClient();

  for (let indice = 1; indice <= expedientes.length; indice++) {
    const expediente = expedientes[indice - 1];
    const inicio = performance.now();

    let resultado: Resultado;
    let motivo: string | null = null;
    let insertados = 0;

    try {
      ({ resultado, motivo, insertados } = await procesarConReintento(client, tokens, expediente));
    } catch (e) {
      if (e instanceof CaptchaError) {
        errorCorrida = `no se pudo obtener un token válido: ${mensaje(e)}`;
        console.error(`[worker] ${errorCorrida} — se aborta la corrida ${corridaId}`);
        break;
      }
      if (e instanceof CaptchaInvalido) {
        // Ni con un token nuevo: no tiene sentido seguir marcando todo KO.
        errorCorrida = `token rechazado por el PJud: ${mensaje(e)}`;
        console.error(`[worker] ${errorCorrida} — se aborta la corrida ${corridaId}`);
        break;
      }

      // Un fallo de un expediente no corta la corrida: queda el KO y el motivo.
      resultado = "KO";
      motivo = mensaje(e);
      console.error(`[worker] expediente ${expediente.numero} falló: ${motivo}`);
      await marcarResultado(expediente.id, "KO").catch((err) =>
        console.error(`[worker] no se pudo marcar KO el expediente ${expediente.id}: ${mensaje(err)}`)
      );
    }

    contadores[resultado] += 1;
    await registrarItem(
      corridaId,
      expediente.id,
      resultado,
      motivo,
      insertados,
      performance.now() - inicio
    );

    if (indice % 100 === 0) {
      console.log(
        `[worker] corrida ${corridaId}: ${indice}/${expedientes.length} ` +
          `(SI=${contadores.SI} NO=${contadores.NO} KO=${contadores.KO})`
      );
    }
  }

  await cerrarCorrida(corridaId, contadores, errorCorrida);
  console.log(
    `[worker] corrida ${corridaId} ${errorCorrida ? "FAILED" : "DONE"}: ` +
      `${contadores.SI} SI / ${contadores.NO} NO / ${contadores.KO} KO`
  );

  if (opts.notificar) {
    // Los contadores son los mismos que se acaban de escribir en `corridas`; no hace
    // falta volver a leerlos de la base para armar el mail.
    await notificarCorrida({
      id: corridaId,
      total: expedientes.length,
      cntSi: contadores.SI,
      cntNo: contadores.NO,
      cntKo: contadores.KO,
    });
  }

  return corridaId;
}

/** Ejecuta una solicitud enviada por el botón de la ficha y conserva su estado. */
async function procesarSolicitudIndividual(): Promise<boolean> {
  const solicitud = await reclamarSolicitudIndividual();
  if (!solicitud) return false;

  if (solicitud.expedienteId === null) {
    await finalizarSolicitudIndividual(solicitud.id, "FAILED", null, "El expediente fue eliminado antes de ejecutarse");
    return true;
  }

  try {
    const corridaId = await correrUna({
      expedienteId: solicitud.expedienteId,
      modo: "pjud-individual-web",
      notificar: true,
    });
    const corrida = await consultarUno<{ estado: string; error: string | null }>(
      "SELECT estado, error FROM corridas WHERE id = $1",
      [corridaId]
    );
    const fallo = corrida?.estado === "FAILED";
    await finalizarSolicitudIndividual(
      solicitud.id,
      fallo ? "FAILED" : "DONE",
      corridaId,
      fallo ? corrida?.error || "La corrida finalizó con error" : null
    );
  } catch (e) {
    await finalizarSolicitudIndividual(
      solicitud.id,
      "FAILED",
      null,
      mensaje(e)
    );
  }
  return true;
}

/**
 * Worker residente: consulta la programación compartida con el panel y reclama
 * cada corrida de forma atómica para evitar que dos réplicas ejecuten la misma.
 */
export async function workerResidente(opts: { limite?: number; intervalo?: number } = {}): Promise<never> {
  if (opts.intervalo !== undefined) {
    await guardarProgramacionCorridas(true, opts.intervalo, null);
  }
  console.log("[worker] residente: revisando la programación persistida cada 15 segundos");
  for (;;) {
    try {
      const solicitudAtendida = await procesarSolicitudIndividual();
      if (!solicitudAtendida && await reclamarCorridaProgramada()) {
        console.log("[worker] ejecución programada iniciada");
        try {
          await correrUna({ limite: opts.limite, notificar: true });
        } finally {
          await programarSiguienteTrasCorrida();
        }
      }
    } catch (e) {
      // Un error de base no debe matar el proceso: se vuelve a revisar en 15 s.
      console.error(`[worker] error al revisar/ejecutar la programación: ${mensaje(e)}`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/**
 * Reintenta los KO de una corrida con su propio ciclo (mismas reglas de token y
 * captcha) pero sobre la lista de expedientes marcada KO en vez del padrón completo.
 */
export async function reintentarKo(corridaId?: number, opts: OpcionesCorrida = {}): Promise<number> {
  const kos = await koParaReintentar(corridaId);
  if (kos.length === 0) {
    console.log("[worker] no hay KO para reintentar");
    return 0;
  }

  const tokens = new TokenManager({ fijo: opts.token ?? null });
  const client = new PjudClient();
  const nuevoCorrida = await crearCorrida(opts.modo ?? "pjud-reintento");
  await ejecutar(`UPDATE corridas SET total = $2 WHERE id = $1`, [nuevoCorrida, kos.length]);

  const contadores: Record<Resultado, number> = { SI: 0, NO: 0, KO: 0 };
  let errorCorrida: string | null = null;

  for (const ko of kos) {
    const expediente = await expedientePorId(ko.expediente_id);
    if (!expediente) continue;
    const inicio = performance.now();
    try {
      const { resultado, motivo, insertados } = await procesarConReintento(client, tokens, expediente);
      contadores[resultado] += 1;
      await registrarItem(nuevoCorrida, expediente.id, resultado, motivo, insertados, performance.now() - inicio);
    } catch (e) {
      if (e instanceof CaptchaError || e instanceof CaptchaInvalido) {
        errorCorrida = mensaje(e);
        console.error(`[worker] ${errorCorrida} — se aborta el reintento ${nuevoCorrida}`);
        break;
      }
      contadores.KO += 1;
      await registrarItem(nuevoCorrida, expediente.id, "KO", mensaje(e), 0, performance.now() - inicio);
    }
  }

  await cerrarCorrida(nuevoCorrida, contadores, errorCorrida);
  console.log(
    `[worker] reintento ${nuevoCorrida}: ${contadores.SI} SI / ${contadores.NO} NO / ${contadores.KO} KO`
  );
  return nuevoCorrida;
}

// Las lecturas que comparte el panel (listado de corridas, items, movimientos de un
// expediente y resumen del sistema) viven en `lib/corridas.ts`: el worker las usa,
// pero no es dueño de ellas.

function mensaje(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
