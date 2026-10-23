/**
 * Runner de migraciones: aplica `migrations/*.sql` en orden, una vez, y deja
 * registro en `schema_migrations`.
 *
 * Sin dependencias de migración (no hay Alembic ni Prisma acá): son archivos SQL
 * leídos tal cual. Cada archivo trae su propio BEGIN/COMMIT, así que el runner no
 * abre transacción: envuelve el contenido de un archivo en una transacción propia
 * rompería el control de quien escribió el SQL (por ejemplo, un CREATE INDEX
 * CONCURRENTLY).
 *
 * Uso:
 *   npm run migrate            aplica las pendientes
 *   npm run migrate -- status  muestra el estado sin tocar nada
 *   npm run migrate -- --dry   muestra qué aplicaría, sin aplicar
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { connectionString } from "../lib/config";

const DIR = path.join(process.cwd(), "migrations");

type Estado = { id: string; aplicado: boolean; sql: string };

async function main() {
  const argumentos = process.argv.slice(2);
  const soloEstado = argumentos.includes("status");
  const simulacro = argumentos.includes("--dry") || argumentos.includes("--dry-run");

  const archivos = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!archivos.length) throw new Error(`No hay archivos .sql en ${DIR}`);

  const pool = new Pool({ connectionString: connectionString() });
  const client = await pool.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id         TEXT PRIMARY KEY,
         aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );

    const aplicados = new Set(
      (await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map(
        (r) => r.id
      )
    );

    const estados: Estado[] = archivos.map((f) => ({
      id: f,
      aplicado: aplicados.has(f),
      sql: readFileSync(path.join(DIR, f), "utf8"),
    }));

    if (soloEstado) {
      for (const e of estados) console.log(`${e.aplicado ? "x" : "-"} ${e.id}`);
      console.log(`${estados.filter((e) => e.aplicado).length}/${estados.length} aplicadas`);
      return;
    }

    const pendientes = estados.filter((e) => !e.aplicado);
    if (!pendientes.length) {
      console.log(`[migrate] esquema al día (${estados.length} migraciones)`);
      return;
    }

    for (const m of pendientes) {
      if (simulacro) {
        console.log(`[migrate] (dry) aplicaría ${m.id}`);
        continue;
      }
      console.log(`[migrate] aplicando ${m.id}`);
      // Un archivo = un golpe. Si algo cae a mitad, no se registra y queda
      // reejecutable: los archivos son idempotentes (IF NOT EXISTS / IF EXISTS).
      await client.query(m.sql);
      await client.query(
        "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
        [m.id]
      );
      console.log(`[migrate] OK ${m.id}`);
    }

    if (!simulacro) console.log(`[migrate] ${pendientes.length} migraciones aplicadas`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[migrate] FALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
