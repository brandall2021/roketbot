/**
 * Configuración por variables de entorno (12-factor), igual que en el bot Python.
 *
 * Todo secreto entra por el entorno: en local desde `.env` (lo carga Next) y en
 * Dokploy desde las variables del servicio. Nada hardcodeado ni commiteado.
 *
 * El worker corre como proceso aparte, sin el runtime de Next, así que esta capa
 * no importa nada de `next/*`: es TypeScript puro sobre `process.env`.
 */

/** Clave requerida: falla temprano y nombrándola, en vez de arrancar roto. */
export function requerida(nombre: string): string {
  const valor = (process.env[nombre] ?? "").trim();
  if (!valor) throw new Error(`${nombre} environment variable is required`);
  return valor;
}

export function opcional(nombre: string, porDefecto = ""): string {
  const valor = (process.env[nombre] ?? "").trim();
  return valor || porDefecto;
}

export function entero(nombre: string, porDefecto: number): number {
  const valor = (process.env[nombre] ?? "").trim();
  if (!valor) return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número (llegó "${valor}")`);
  return Math.trunc(n);
}

export function decimal(nombre: string, porDefecto: number): number {
  const valor = (process.env[nombre] ?? "").trim();
  if (!valor) return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número (llegó "${valor}")`);
  return n;
}

export function booleano(nombre: string, porDefecto: boolean): boolean {
  const valor = (process.env[nombre] ?? "").trim().toLowerCase();
  if (!valor) return porDefecto;
  return ["1", "true", "si", "sí", "yes"].includes(valor);
}

/**
 * Acepta el formato de SQLAlchemy que usaba el bot (`postgresql+psycopg://...`)
 * y el estándar de pg (`postgresql://...`). El driver del bot ya no existe, así
 * que hay que limpiar el prefijo antes de conectar.
 */
export function connectionString(): string {
  const url = requerida("DATABASE_URL");
  return url.replace(/^postgresql\+[a-z_]+:\/\//i, "postgresql://");
}

export function esProduccion(): boolean {
  return process.env.NODE_ENV === "production";
}
