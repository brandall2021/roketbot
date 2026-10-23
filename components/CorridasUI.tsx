/**
 * Piezas de presentación compartidas por las pantallas de seguimiento (corridas,
 * expedientes). Son componentes puros, sin estado ni `fetch`: se pueden usar desde
 * un componente de servidor, así que no llevan `"use client"`.
 */

const ESTILO_BADGE: Record<string, string> = {
  SI: "badge ok",
  DONE: "badge ok",
  NO: "badge warn",
  KO: "badge danger",
  FAILED: "badge danger",
  RUNNING: "badge",
  PENDIENTE: "badge warn",
  ENVIADO: "badge ok",
  ERROR: "badge danger",
};

export function Badge({ valor }: { valor?: string | null }) {
  const v = (valor ?? "").trim().toUpperCase();
  return <span className={ESTILO_BADGE[v] ?? "badge"}>{v || "—"}</span>;
}

/** El resultado de un expediente dentro de una corrida (SI / NO / KO). */
export const BadgeResultado = Badge;

/** El estado de la corrida entera (RUNNING / DONE / FAILED). */
export const BadgeCorrida = Badge;

/** Fecha y hora legibles, en la zona horaria del servidor. */
export function fmtHora(valor?: string | null): string {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtFecha(valor?: string | null): string {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seg = ms / 1000;
  if (seg < 60) return `${seg.toFixed(1)} s`;
  return `${Math.floor(seg / 60)}m ${Math.round(seg % 60)}s`;
}
