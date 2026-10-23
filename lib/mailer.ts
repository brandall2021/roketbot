import nodemailer, { type Transporter } from "nodemailer";
import { booleano, entero, opcional } from "./config";
import { ejecutar } from "./db";

/**
 * Correo de resumen (reemplaza al sub-bot `EnvioCorreos` de Python).
 *
 * El mail NO es el canal de verdad: el estado de una corrida vive en Postgres.
 * Por eso cada notificación se escribe primero en la tabla `notificaciones` como
 * PENDIENTE y recién después se intenta enviar; si el SMTP está caído o falta
 * configuración, la fila queda ahí con el motivo y se puede reintentar, en vez
 * de perder el resumen.
 *
 * Sólo lo usa el worker: ninguna ruta de Next lo importa, así que nodemailer no
 * entra en el bundle del sitio (hay que copiarlo a mano en la imagen; ver Dockerfile).
 */

export type ConfigSmtp = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  ssl: boolean;
  destinatarios: string[];
};

export function configSmtp(): ConfigSmtp {
  return {
    host: opcional("SMTP_HOST"),
    port: entero("SMTP_PORT", 465),
    user: opcional("SMTP_USER"),
    password: opcional("SMTP_PASSWORD"),
    from: opcional("SMTP_FROM"),
    ssl: booleano("SMTP_USE_SSL", true),
    destinatarios: opcional("MAIL_DESTINATARIOS")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

/** Con host vacío o sin destinatarios no hay nada que intentar. */
export function mailHabilitado(cfg: ConfigSmtp = configSmtp()): boolean {
  return Boolean(cfg.host && cfg.destinatarios.length);
}

let cache: { clave: string; transporter: Transporter } | null = null;

/**
 * El transporter se cachea contra una clave derivada de la configuración (sin la
 * contraseña): cambiar un host fuerza uno nuevo y no se abre una conexión SMTP por
 * cada mail.
 */
function transporter(cfg: ConfigSmtp): Transporter {
  const clave = `${cfg.host}:${cfg.port}:${cfg.ssl ? "ssl" : "tls"}:${cfg.user}`;
  if (!cache || cache.clave !== clave) {
    cache = {
      clave,
      transporter: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.ssl,
        auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
        // Explícito: el certificado del SMTP siempre se verifica.
        tls: { rejectUnauthorized: true },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      }),
    };
  }
  return cache.transporter;
}

export type Correo = {
  asunto: string;
  cuerpoHtml: string;
  destinatarios?: string[];
};

/**
 * Envía sin escribir en el outbox. Devuelve false (nunca tira) porque el mail es
 * accesorio: una corrida bien hecha no deja de serlo porque el SMTP haya fallado.
 */
export async function enviar({ asunto, cuerpoHtml, destinatarios }: Correo): Promise<boolean> {
  const cfg = configSmtp();
  if (!mailHabilitado(cfg)) {
    console.warn("[mail] deshabilitado: faltan SMTP_HOST / MAIL_DESTINATARIOS");
    return false;
  }
  const destinos = (destinatarios ?? cfg.destinatarios).filter(Boolean);
  if (!destinos.length) return false;

  try {
    await transporter(cfg).sendMail({
      from: cfg.from || cfg.user,
      to: destinos.join(", "),
      subject: asunto,
      html: cuerpoHtml,
    });
    console.log(`[mail] enviado a ${destinos.join(", ")}`);
    return true;
  } catch (e) {
    console.error(`[mail] no se pudo enviar: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export type ResumenCorrida = {
  id: number;
  total: number;
  cntSi: number;
  cntNo: number;
  cntKo: number;
};

/** Mismo espíritu que el mail del bot, pero armado desde los contadores de Postgres. */
export function plantillaResumen(corrida: ResumenCorrida): string {
  const filas: [string, number][] = [
    ["Registros procesados", corrida.total],
    ["Con actualizaciones", corrida.cntSi],
    ["Sin actualizaciones", corrida.cntNo],
    ["No se pudo obtener", corrida.cntKo],
  ];
  const cuerpo = filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 16px;background:#4c73f3;color:#fff">${escapeHtml(k)}</td>` +
        `<td style="padding:8px 16px">${Number(v) || 0}</td></tr>`
    )
    .join("");
  return (
    "<p>Buenos días:</p>" +
    "<p>Resumen de la corrida de consulta de expedientes.</p>" +
    `<table style="font-size:inherit;border-collapse:collapse">${cuerpo}</table>` +
    "<p>Saludos.</p>"
  );
}

function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Outbox + envío. Escribe siempre; marca ENVIADO o ERROR según el resultado.
 * Nunca falla: si el propio INSERT de la notificación falla (base caída), se loggea
 * y la corrida termina igual, porque el estado de la corrida ya está persistido.
 */
export async function notificarCorrida(
  corrida: ResumenCorrida,
  destinatarios?: string[]
): Promise<void> {
  const cfg = configSmtp();
  const destinos = (destinatarios ?? cfg.destinatarios).join(", ");
  const asunto = `Expedientes: corrida ${corrida.id} finalizada`;
  const cuerpo = plantillaResumen(corrida);

  let notificacionId: number | null = null;
  try {
    const { rows } = await ejecutar(
      `INSERT INTO notificaciones (corrida_id, destinatarios, asunto, cuerpo, estado)
       VALUES ($1, $2, $3, $4, 'PENDIENTE')
       RETURNING id`,
      [destinos || null, asunto, cuerpo, corrida.id]
    );
    const id = (rows[0] as { id: number | string } | undefined)?.id;
    notificacionId = id === undefined ? null : Number(id);
  } catch (e) {
    console.error(`[mail] no se pudo registrar la notificación: ${mensaje(e)}`);
    return;
  }

  const ok = await enviar({ asunto, cuerpoHtml: cuerpo, destinatarios });

  if (notificacionId !== null) {
    try {
      await ejecutar(
        ok
          ? `UPDATE notificaciones
               SET estado = 'ENVIADO', enviado_en = now(), error = NULL
             WHERE id = $1`
          : `UPDATE notificaciones
               SET estado = 'ERROR', error = 'no enviado: revisar SMTP_HOST / MAIL_DESTINATARIOS o el log del worker'
             WHERE id = $1`,
        [notificacionId]
      );
    } catch (e) {
      console.error(`[mail] no se pudo actualizar la notificación: ${mensaje(e)}`);
    }
  }
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
