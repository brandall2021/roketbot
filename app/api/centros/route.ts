import { NextRequest, NextResponse } from "next/server";
import { consultar, ejecutar, num } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  comoCodigoEndpoint,
  comoProvinciaId,
  esViolacionDeClaveForanea,
  respuestaDeError,
} from "@/lib/rutas";

export const runtime = "nodejs";

export type Centro = {
  CentroJudId: number;
  nombre: string | null;
  provinciaId: string | null;
  provinciaNombre: string | null;
  unidad: string | null;
  sitioWeb: string | null;
  equivEndpoint: string | null;
};

/**
 * Maestros de centros judiciales sobre `centros_judiciales` (Postgres).
 * `legado_id` es el id del maestro viejo; `codigo_endpoint` es el código del PJud
 * (antes CentroJudEquivEndpoint) y `jurisdiccion` en las consultas.
 */
export async function GET(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    // Alias exactos a las claves que lee app/centros/page.tsx; los id van ::text
    // porque la página los trata como string (el <select> de provincia).
    const rows = await consultar<Centro>(
      `SELECT c.id AS "CentroJudId",
              c.nombre,
              c.provincia_id::text AS "provinciaId",
              p.nombre AS "provinciaNombre",
              c.unidad,
              c.sitio_web AS "sitioWeb",
              c.codigo_endpoint::text AS "equivEndpoint"
         FROM centros_judiciales c
         LEFT JOIN provincias p ON p.id = c.provincia_id
        ORDER BY c.id`
    );
    return NextResponse.json({ centros: rows });
  } catch (err) {
    return respuestaDeError("centros", err);
  }
}

export async function POST(req: NextRequest) {
  const { response } = requireAuth(req);
  if (response) return response;

  try {
    const body = await req.json();
    const nombre = String(body.nombre ?? "").trim();
    const unidad = body.unidad ? String(body.unidad).trim() : null;
    const sitioWeb = body.sitioWeb ? String(body.sitioWeb).trim() : null;

    if (!nombre) {
      return NextResponse.json({ error: "El nombre del centro es obligatorio" }, { status: 400 });
    }
    if (nombre.length > 40 || (unidad && unidad.length > 40) || (sitioWeb && sitioWeb.length > 80)) {
      return NextResponse.json({ error: "Algún campo supera el largo permitido" }, { status: 400 });
    }

    const prov = comoProvinciaId(body.provinciaId ? String(body.provinciaId).trim() : null);
    if (prov.error) {
      return NextResponse.json({ error: prov.error }, { status: 400 });
    }

    const ep = comoCodigoEndpoint(body.equivEndpoint ? String(body.equivEndpoint).trim() : null);
    if (ep.error) {
      return NextResponse.json({ error: ep.error }, { status: 400 });
    }

    // Sin el baile de MAX(id)+1: la clave la da la base y se devuelve con RETURNING.
    const creado = await ejecutar(
      `INSERT INTO centros_judiciales (nombre, provincia_id, unidad, sitio_web, codigo_endpoint)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [nombre, prov.valor, unidad, sitioWeb, ep.valor]
    );

    const id = num(creado.rows[0]?.id);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    if (esViolacionDeClaveForanea(err)) {
      return NextResponse.json({ error: "La provincia indicada no existe" }, { status: 400 });
    }
    return respuestaDeError("centros", err);
  }
}
