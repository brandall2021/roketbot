import { NextRequest, NextResponse } from "next/server";
import { parseCsv, type ColumnMapping } from "@/lib/csv";
import { cargarLote, registrarCarga } from "@/lib/expedientes";
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

    let mapping: ColumnMapping | undefined;
    const mappingRaw = formData.get("mapping");
    if (mappingRaw) {
      try {
        mapping = JSON.parse(String(mappingRaw)) as ColumnMapping;
      } catch {
        return NextResponse.json({ error: "campo 'mapping' inválido (debe ser JSON)" }, { status: 400 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { records, errors } = await parseCsv(buffer, mapping);

    if (records.length === 0) {
      return NextResponse.json({ error: "No se encontraron registros válidos en el CSV", errors }, { status: 400 });
    }

    // cargarLote corre en una sola transacción y descarta duplicados con
    // ON CONFLICT (numero, jurisdiccion) DO NOTHING: el conteo es exacto.
    const lote = await cargarLote(records, session!.id, "CSV");
    const errores = [...errors, ...lote.errores];

    const cargaId = await registrarCarga(
      {
        archivo: file.name,
        tamano: file.size,
        filasLeidas: records.length,
        insertados: lote.insertados,
        duplicados: lote.duplicados,
        errores,
      },
      session!.id
    );

    return NextResponse.json({
      ok: true,
      cargaId,
      totalLeidos: records.length,
      insertados: lote.insertados,
      duplicados: lote.duplicados,
      errores,
    });
  } catch (err) {
    return respuestaDeError("expedientes/import", err);
  }
}
