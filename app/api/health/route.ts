import { NextResponse } from "next/server";
import { estanSanos } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Ping de salud para el despliegue (Dokploy/reverse proxy).
 *
 * Es la única API sin sesión (`middleware.ts` la lista como pública): el healthcheck
 * del orquestador no tiene cookie. Por eso la respuesta es mínima.
 *
 * `estanSanos()` nunca lanza: devuelve `{ base: false, error }`. El mensaje del
 * error se loguea en el servidor y afuera sólo sale `{ ok, base }`, para no
 * exponer host, puerto ni usuario de la base.
 */
export async function GET() {
  try {
    const { base, error } = await estanSanos();
    if (!base) {
      console.error("[api/health] base inaccesible:", error ?? "sin detalle");
      return NextResponse.json({ ok: false, base: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true, base: true });
  } catch (err) {
    console.error("[api/health] fallo inesperado:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, base: false }, { status: 503 });
  }
}
