import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { solicitudCorridaPorId } from "@/lib/solicitudes-corrida";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = requireAdmin(req);
  if (response) return response;

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID de solicitud inválido" }, { status: 400 });
  }

  try {
    const solicitud = await solicitudCorridaPorId(id);
    if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
    return NextResponse.json({ solicitud });
  } catch (err) {
    return respuestaDeError("solicitudes-corrida/[id]", err);
  }
}
