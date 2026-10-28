import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { consultarUno, fecha } from "@/lib/db";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const fila = await consultarUno<{ worker_ultimo_pulso: unknown }>(
      `SELECT worker_ultimo_pulso FROM programacion_corridas WHERE id = 1`
    );
    if (!fila) {
      return NextResponse.json({ error: "No existe la programación; aplique las migraciones" }, { status: 503 });
    }

    const ultimoPulso = fecha(fila.worker_ultimo_pulso);
    const edadSegundos = ultimoPulso
      ? Math.max(0, Math.floor((Date.now() - new Date(ultimoPulso).getTime()) / 1000))
      : null;
    return NextResponse.json({
      baseConectada: true,
      workerActivo: edadSegundos !== null && edadSegundos <= 45,
      ultimoPulso,
      edadSegundos,
    });
  } catch (err) {
    return respuestaDeError("programacion-corridas/test", err);
  }
}
