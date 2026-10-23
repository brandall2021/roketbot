/**
 * Alta del administrador inicial (reemplaza scripts/seed.js de SQL Server).
 *
 * Idempotente: existe el usuario → no lo toca (y mucho menos le cambia la
 * contraseña). Las credenciales entran por entorno; si no se ponen, se niega en
 * producción en vez de crear un `admin/admin123` que queda vivo para siempre.
 *
 *   npm run seed        (ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_NOMBRE)
 */
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { connectionString, esProduccion, opcional } from "../lib/config";

const DEBILES = ["admin", "admin123", "password", "12345678", "juridico", "cambiar"];

async function main() {
  const username = opcional("ADMIN_USERNAME", "admin").toLowerCase();
  const nombre = opcional("ADMIN_NOMBRE", "Administrador");
  const password = opcional("ADMIN_PASSWORD", "");

  if (esProduccion() && (!password || DEBILES.includes(password.toLowerCase()))) {
    throw new Error(
      "ADMIN_PASSWORD es obligatoria y no puede ser una de las conocidas. " +
        "Generá una fuerte antes de crear el administrador."
    );
  }
  if (!password) throw new Error("Falta ADMIN_PASSWORD");
  if (password.length < 10) throw new Error("ADMIN_PASSWORD debe tener al menos 10 caracteres");

  const rol = (opcional("ADMIN_ROL", "ADMIN") || "ADMIN").toUpperCase();
  if (!["ADMIN", "USER"].includes(rol)) throw new Error(`ADMIN_ROL inválido: ${rol}`);

  const pool = new Pool({ connectionString: connectionString() });
  try {
    const existente = await pool.query<{ id: number }>(
      "SELECT id FROM usuarios WHERE username = $1",
      [username]
    );
    if (existente.rowCount && existente.rows[0]) {
      console.log(`[seed] el usuario "${username}" ya existe (id ${existente.rows[0].id}): se deja como está`);
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const creado = await pool.query<{ id: number }>(
      `INSERT INTO usuarios (username, password_hash, nombre, rol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [username, hash, nombre, rol]
    );
    console.log(
      creado.rowCount
        ? `[seed] administrador "${username}" creado (id ${creado.rows[0].id})`
        : `[seed] "${username}" ya existía`
    );

    const total = await pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM usuarios");
    console.log(`[seed] usuarios registrados: ${total.rows[0]?.n ?? 0}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[seed] FALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
