import { NextRequest, NextResponse } from "next/server";
import { parseCsvActualizar, type ActualizarRegistro } from "@/lib/csv";
import { actualizarEnMasa, registrarCarga } from "@/lib/expedientes";
import { requireAuth } from "@/lib/auth";
import { respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { session, response } = requireAuth(req);
  if (response) return response;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo CSV requerido (campo 'file')" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { records, errors } = await parseCsvActualizar(buffer);

    if (records.length === 0) {
      return NextResponse.json({ error: "No se encontraron registros válidos en el CSV", errors }, { status: 400 });
    }

    // actualizarEnMasa abre su propia transacción y reporta por fila: un archivo
    // que se cae a la mitad no deja medio padrón con el estado cambiado.
    // Las filas sin número ya se avisaron en `errors` (las genera el parseo de CSV),
    // así que acá se descartan: no se actualiza nada sin expediente.
    const conNumero = records.filter((r): r is ActualizarRegistro & { expdte: string } => r.expdte !== null);
    const masa = await actualizarEnMasa(conNumero);
    const errores = [...errors, ...masa.errores];

    const cargaId = await registrarCarga(
      {
        archivo: file.name,
        tamano: file.size,
        filasLeidas: records.length,
        // Como antes: la planilla de "Archivos subidos" muestra los estados
        // modificados en la columna Insertados, y ahora además queda en Actualizados.
        insertados: masa.actualizados,
        duplicados: 0,
        actualizados: masa.actualizados,
        errores,
        origen: "CSV-UPDATE",
      },
      session!.id
    );

    return NextResponse.json({
      ok: true,
      cargaId,
      totalLeidos: records.length,
      actualizados: masa.actualizados,
      errores,
    });
  } catch (err) {
    return respuestaDeError("expedientes/actualizar", err);
  }
}
