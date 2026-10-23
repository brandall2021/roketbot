import { createHash } from "node:crypto";
import { decimal, opcional } from "../config";

/**
 * Cliente de la API pública del Poder Judicial de Tucumán (antes `services/pjud.py`).
 *
 * El flujo es el del bot, con errores explícitos:
 *   1) GET /api/proceedings?jurisdiction=..&number=..&captcha=TOKEN   -> procid
 *   2) GET /api/proceedings/history?jurisdiction=..&proceeding=procid -> stories
 *
 * Lo puro (parseo de fecha, huella del movimiento, filtrado de nuevos) está
 * separado del transporte para poder probarlo sin red, igual que en Python.
 *
 * FECHAS: se trabaja con cadenas `YYYY-MM-DD` ("Día"), nunca con `Date`. Un `Date`
 * trae zona horaria, y acá lo que compara es el día calendario: `fch_ult_mov` es
 * columna `date` y pg la devuelve como medianoche local, mientras que una fecha del
 * PJud parseada es medianoche UTC. Mezclarlos da desfases de un día según dónde
 * esté corriendo el proceso. Con cadenas, la comparación lexicográfica es el
 * ordering del calendario y la huella queda estable.
 */

export class PjudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PjudError";
  }
}

/** El PJud rechazó el token: seguir consultando solo llenaría KO falsos. */
export class CaptchaInvalido extends PjudError {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaInvalido";
  }
}

export type Story = {
  fecha?: string | null;
  dscr?: string | null;
  texto?: string | null;
  link?: string | null;
  histid?: string | number | null;
};

export type Dia = string;

const FORMATOS: { re: RegExp; toma: (m: RegExpExecArray) => [string, string, string] }[] = [
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, toma: (m) => [m[3], m[2], m[1]] },
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, toma: (m) => [m[1], m[2], m[3]] },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})/, toma: (m) => [m[3], m[2], m[1]] },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, toma: (m) => [`20${m[3]}`, m[2], m[1]] },
];

function pa(valor: string): string {
  return valor.length < 2 ? `0${valor}` : valor;
}

/**
 * Fechas del PJud a `YYYY-MM-DD`. Devuelve null en vez de tirar: una fecha
 * ilegible en una línea de historial no tiene que tumbar la corrida, el movimiento
 * simplemente no se puede fechar y se descarta.
 *
 * La validación de calendario importa: `13/13/13` tiene forma de fecha y Python la
 * rechazaba en `strptime`. Sin el chequeo entraría `"2013-13-13"` en una columna
 * `date`, Postgres la tira y el expediente entero pasa a KO por una línea basura.
 */
export function parseFechaPjud(valor?: string | null): Dia | null {
  if (!valor) return null;
  const limpio = String(valor).trim().slice(0, 10);
  for (const f of FORMATOS) {
    const m = f.re.exec(limpio);
    if (!m) continue;
    const [anio, mes, dia] = f.toma(m);
    const y = Number(anio);
    const mo = Number(mes);
    const d = Number(dia);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const fecha = new Date(Date.UTC(y, mo - 1, d));
    if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== mo - 1 || fecha.getUTCDate() !== d) {
      continue;
    }
    return `${anio}-${pa(mes)}-${pa(dia)}`;
  }
  return null;
}

/**
 * Valor de una columna `date`/`timestamptz` leída de pg a Día calendario.
 * `pg` entrega `Date` en medianoche local para `date`, así que hay que leer los
 * componentes locales; si ya viene como texto (el export CSV, una vista con
 * to_char) se toma el prefijo ISO.
 */
export function diaDesdeSql(valor: unknown): Dia | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getFullYear()}-${pa(String(valor.getMonth() + 1))}-${pa(String(valor.getDate()))}`;
  }
  const texto = String(valor).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Huella estable de un movimiento, para no insertarlo dos veces.
 *
 * No depende del número de expediente (lo aporta la FK) ni del `histid`: el
 * historial importado del legado no lo tiene, y si lo incluyéramos el mismo
 * movimiento entraría dos veces (una desde el legado y otra desde la API).
 *
 * El formato (`YYYY-MM-DD|descripcion minúscula`) es idéntico al del bot para que
 * los 114.742 movimientos ya importados sigan siendo reconocidos como existentes.
 */
export function hashMovimiento(fecha: Dia | null, descripcion: string | null): string {
  const clave = [fecha ?? "", (descripcion ?? "").trim().toLowerCase()].join("|");
  return createHash("sha256").update(clave, "utf8").digest("hex");
}

/** Descripciones de story, recortadas como en el bot (null si queda vacía). */
export function descripcionDe(story: Story): string | null {
  const desc = String(story?.dscr ?? "").trim();
  return desc || null;
}

/** Movimientos posteriores a `desde`, ordenados ascendente. Con `desde` null, todos. */
export function filtrarNuevas(stories: Story[], desde: Dia | null): Story[] {
  const conFecha = (stories ?? [])
    .map((s) => ({ story: s, dia: parseFechaPjud(s.fecha) }))
    .filter((x): x is { story: Story; dia: Dia } => x.dia !== null)
    .filter((x) => !desde || x.dia > desde);
  return conFecha
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .map((x) => x.story);
}

export type ConfigPjud = {
  baseUrl: string;
  delayMs: number;
  timeoutMs: number;
};

export function configPjud(): ConfigPjud {
  return {
    // Ojo con el default: requerida() corta apenas arranca si falta DATABASE_URL,
    // pero la base del PJud no es un secreto y conviene que el sistema levante.
    baseUrl: opcional("PJUD_API_BASE", "https://conexpbe.justucuman.gov.ar/api/proceedings").replace(/\/+$/, ""),
    delayMs: Math.round(decimal("REQUEST_DELAY_S", 3) * 1000),
    timeoutMs: Math.round(decimal("REQUEST_TIMEOUT_S", 30) * 1000),
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PjudClient {
  private readonly cfg: ConfigPjud;

  constructor(cfg: ConfigPjud = configPjud()) {
    this.cfg = cfg;
  }

  /**
   * Pausa ANTES de cada request, deliberadamente: es el servidor del PJud, no
   * nuestro, y el bot convivía con este mismo límite (3s).
   */
  private async get(url: string, params: Record<string, string | number>): Promise<unknown> {
    if (this.cfg.delayMs > 0) await sleep(this.cfg.delayMs);

    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

    let res: Response;
    try {
      res = await fetch(`${url}?${qs.toString()}`, {
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        headers: {
          "User-Agent": "expedientes-unificado/0.2 (+sistema interno)",
          Accept: "application/json",
        },
      });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      throw new PjudError(`Error de red: ${mensaje}`);
    }

    let cuerpo: unknown = null;
    try {
      cuerpo = await res.json();
    } catch {
      cuerpo = null;
    }

    if (!res.ok) {
      // El PJud contesta 404 con un mensaje útil ("No se puede validar el captcha").
      const mensaje = mensajeDe(cuerpo);
      if (/captcha/i.test(mensaje)) throw new CaptchaInvalido(mensaje || "captcha inválido");
      const detalle = `HTTP ${res.status}`;
      throw new PjudError(mensaje ? `${detalle}: ${mensaje}` : detalle);
    }

    if (cuerpo === null) throw new PjudError(`Respuesta no JSON en ${url}`);
    return cuerpo;
  }

  /** Paso 1: número de expediente -> procid interno del PJud. */
  async buscarProcid(numero: string, jurisdiccion: number, token: string): Promise<number | string | null> {
    const payload = (await this.get(this.cfg.baseUrl, {
      jurisdiction: jurisdiccion,
      page: 1,
      unit: "",
      number: numero,
      actor: "",
      accused: "",
      captcha: token,
    })) as { data?: unknown };

    const data = payload?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    const primero = data[0] as { procid?: number | string } | null;
    if (!primero || typeof primero !== "object") return null;
    return primero.procid ?? null;
  }

  /** Paso 2: procid -> lista de movimientos (stories). */
  async historial(jurisdiccion: number, procid: number | string): Promise<Story[]> {
    const payload = (await this.get(`${this.cfg.baseUrl}/history`, {
      jurisdiction: jurisdiccion,
      proceeding: procid,
    })) as { data?: { stories?: unknown } };

    const stories = payload?.data?.stories;
    if (!Array.isArray(stories)) return [];
    return stories.filter((s): s is Story => !!s && typeof s === "object");
  }

  /** Flujo completo: [encontrado, movimientos nuevos]. */
  async consultar(
    numero: string,
    jurisdiccion: number,
    token: string,
    desde: Dia | null
  ): Promise<{ encontrado: boolean; nuevas: Story[] }> {
    const procid = await this.buscarProcid(numero, jurisdiccion, token);
    if (procid === null) return { encontrado: false, nuevas: [] };
    const stories = await this.historial(jurisdiccion, procid);
    return { encontrado: true, nuevas: filtrarNuevas(stories, desde) };
  }
}

function mensajeDe(cuerpo: unknown): string {
  if (!cuerpo || typeof cuerpo !== "object") return "";
  const m = (cuerpo as { message?: unknown }).message;
  return m === undefined || m === null ? "" : String(m);
}
