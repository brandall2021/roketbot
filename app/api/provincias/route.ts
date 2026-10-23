import { NextRequest, NextResponse } from "next/server";
import { consultar, ejecutar, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { conflicto, esViolacionDeUnicidad, respuestaDeError } from "@/lib/rutas";

export const runtime = "nodejs";

export type Provincia = { id: string; nombre: string };

/**
 * Maestro de provincias (antes `dbo.Provincias` con `ProvinciaId` char paddeado).
 * Ahora es `provincias` con `id GENERATED ALWAYS AS IDENTITY` y `nombre UNIQUE`.
 *
 * `id` se devuelve como texto porque `app/provincias/page.tsx` (y el `<select>` de
 * `app/centros/page.tsx`) lo tratan como string: hacen `p.id.trim()` y lo comparan
 * con el `provinciaId` del centro.
 */
export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const provincias = await consultar<Provincia>(
      "SELECT id::text AS id, nombre FROM provincias ORDER BY id"
    );
    return NextResponse.json({ provincias });
  } catch (err) {
    return respuestaDeError("provincias", err);
  }
}

export async function POST(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const body = await req.json();
    const nombre = String(body.nombre ?? "").trim();

    if (!nombre) {
      return NextResponse.json({ error: "El nombre de la provincia es obligatorio" }, { status: 400 });
    }
    if (nombre.length > 40) {
      return NextResponse.json({ error: "El nombre supera 40 caracteres" }, { status: 400 });
    }

    // Antes: SELECT MAX(id)+1 y un INSERT con el id paddeado a 4 (carrera entre dos
    // usuarios). La base asigna la clave y `RETURNING` la trae.
    const creado = await ejecutar(
      "INSERT INTO provincias (nombre) VALUES ($1) RETURNING id",
      [nombre]
    );

    return NextResponse.json({ ok: true, id: num(creado.rows[0]?.id) }, { status: 201 });
  } catch (err) {
    // `provincias.nombre` es UNIQUE: dos "Tucumán" no pueden coexistir.
    if (esViolacionDeUnicidad(err)) {
      return conflicto("provincias", err, "Ya existe una provincia con ese nombre");
    }
    return respuestaDeError("provincias", err);
  }
}
