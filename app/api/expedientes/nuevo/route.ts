import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { darAlta, type CargaInput } from "@/lib/expedientes";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

/**
 * Alta manual de un expediente.
 *
 * `historia` ya no es un campo: la historia del expediente es la tabla
 * `movimientos` (la alimenta el worker y la devuelve GET /api/expedientes/[id]).
 * `documento` ahora sí se guarda: antes vivía en ExpdtesLineas y se descartaba.
 */
const CAMPOS: (keyof CargaInput)[] = [
  "centroJudicial",
  "unidadJudicial",
  "cenJudId",
  "expdte",
  "actor",
  "demandado",
  "fecha",
  "descripcion",
  "documento",
  "fechaProcesado",
  "estado",
  "estadoProcesal",
  "estadoProcesalNombre",
  "caratula",
];

export async function POST(req: NextRequest) {
  const { session, response } = requireAuth(req);
  if (response) return response;

  try {
    const body: Record<string, unknown> = await req.json();
    const expdte = String(body.expdte ?? "").trim();
    if (!expdte) {
      return NextResponse.json({ error: "El campo 'expdte' es obligatorio" }, { status: 400 });
    }

    const carga = Object.fromEntries(
      CAMPOS.map((campo) => [campo, body[campo] ? String(body[campo]) : null])
    ) as CargaInput;
    carga.expdte = expdte;

    const resultado = await darAlta(carga, session!.id, "MANUAL");
    const errores = resultado.error ? [resultado.error] : [];

    if (!resultado.insertado) {
      return NextResponse.json({ error: `No se pudo insertar: ${errores.join("; ")}` }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, expdte, id: resultado.id, insertados: 1, errores, cargadoPor: session!.username },
      { status: 201 }
    );
  } catch (err) {
    return respuestaDeError("expedientes/nuevo", err);
  }
}
