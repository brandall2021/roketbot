import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { guardarProgramacionCorridas, leerProgramacionCorridas } from "@/lib/programacion";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    return NextResponse.json(await leerProgramacionCorridas());
  } catch (err) {
    return respuestaDeError("programacion-corridas", err);
  }
}

export async function PUT(req: NextRequest) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    if (typeof body.habilitada !== "boolean") {
      return NextResponse.json({ error: "habilitada debe ser verdadero o falso" }, { status: 400 });
    }
    const intervaloSegundos = Number(body.intervaloSegundos);
    if (!Number.isInteger(intervaloSegundos) || intervaloSegundos < 60 || intervaloSegundos > 2592000) {
      return NextResponse.json({ error: "El intervalo debe estar entre 1 minuto y 30 días" }, { status: 400 });
    }

    const programacion = await guardarProgramacionCorridas(
      body.habilitada,
      intervaloSegundos,
      session!.id
    );
    return NextResponse.json({ ok: true, programacion });
  } catch (err) {
    return respuestaDeError("programacion-corridas", err);
  }
}
