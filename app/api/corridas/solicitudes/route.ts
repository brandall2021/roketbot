import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { solicitarCorridaIndividual } from "@/lib/solicitudes-corrida";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    const expedienteId = Number(body.expedienteId);
    if (!Number.isSafeInteger(expedienteId) || expedienteId <= 0) {
      return NextResponse.json({ error: "ID de expediente inválido" }, { status: 400 });
    }

    const resultado = await solicitarCorridaIndividual(expedienteId, session!.id);
    if (!resultado) {
      return NextResponse.json({ error: "El expediente ya no existe" }, { status: 404 });
    }

    return NextResponse.json(
      { solicitud: resultado.solicitud, existente: resultado.existente },
      { status: resultado.existente ? 200 : 202 }
    );
  } catch (err) {
    return respuestaDeError("solicitudes-corrida", err);
  }
}
