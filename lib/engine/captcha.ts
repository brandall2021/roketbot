import { decimal, entero, opcional } from "../config";

/**
 * Obtención del token reCAPTCHA que exige la API del PJud
 * (antes `services/captcha.py`).
 *
 * Proveedores intercambiables por configuración:
 *
 *   * twocaptcha  -> servicio pago, el que usa la corrida hoy
 *   * playwright  -> NO está portado: requeriría el binario de Chromium en la
 *                    imagen de producción. Se deja el aviso explícito para que
 *                    una mala configuración falle leyendo, no a las 3 minutos.
 *   * none        -> el sistema arranca, pero el worker avisa que no puede consultar.
 */

export class CaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaError";
  }
}

export type ConfigCaptcha = {
  proveedor: string;
  twocaptchaKey: string;
  sitekey: string;
  frontend: string;
  pollTimeoutMs: number;
  /** El token de reCAPTCHA dura ~2 minutos; se renueva solo durante la corrida. */
  ttlMs: number;
};

export function configCaptcha(): ConfigCaptcha {
  return {
    proveedor: opcional("CAPTCHA_PROVIDER", "none").toLowerCase().trim(),
    twocaptchaKey: opcional("TWOCAPTCHA_KEY"),
    // La sitekey es pública (viaja en el HTML del buscador); el default no es un secreto.
    sitekey: opcional("PJUD_SITEKEY", "6LeIn2IsAAAAAKF_7oDVKBPy-sAV2JwIRySx57H6"),
    frontend: opcional(
      "PJUD_FRONTEND",
      "https://consultaexpedientes.justucuman.gov.ar/documentos/buscador"
    ),
    pollTimeoutMs: Math.round(entero("TWOCAPTCHA_POLL_TIMEOUT_S", 120) * 1000),
    ttlMs: Math.round(decimal("CAPTCHA_TOKEN_TTL_S", 90) * 1000),
  };
}

const URL_IN = "https://2captcha.com/in.php";
const URL_RES = "https://2captcha.com/res.php";
const REINTENTOS_2CAPTCHA = 3;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function obtenerToken(cfg: ConfigCaptcha = configCaptcha()): Promise<string> {
  if (cfg.proveedor === "twocaptcha") return tokenTwocaptcha(cfg);
  if (cfg.proveedor === "playwright") return tokenPlaywright();
  throw new CaptchaError(
    "CAPTCHA_PROVIDER='none': configurá 'twocaptcha' para consultar el PJud."
  );
}

/** Errores transitorios del servicio, frente a errores de configuración. */
function reintentable(mensaje: string): boolean {
  const claves = ["UNSOLVABLE", "CAPCHA_NOT_READY", "timeout", "TIMEOUT", "Error de red"];
  return claves.some((c) => mensaje.includes(c));
}

/**
 * Resuelve el captcha reintentante ante fallos transitorios.
 *
 * 2captcha devuelve ERROR_CAPTCHA_UNSOLVABLE de forma esporádica; abortar toda la
 * corrida por eso sería desperdiciar el trabajo ya hecho.
 */
async function tokenTwocaptcha(cfg: ConfigCaptcha): Promise<string> {
  let ultimo = "";
  for (let intento = 1; intento <= REINTENTOS_2CAPTCHA; intento++) {
    try {
      return await resolverTwocaptcha(cfg);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const tipo = e instanceof Error ? e.name : "Error";
      ultimo = `${tipo}: ${mensaje}`;
      // Un fallo de red se reintenta siempre; cualquier otro sólo si es transitorio.
      const transitorio = e instanceof TypeError || reintentable(mensaje);
      if (!transitorio) throw e instanceof CaptchaError ? e : new CaptchaError(ultimo);
      console.warn(`[captcha] 2captcha intento ${intento}/${REINTENTOS_2CAPTCHA} falló: ${ultimo}`);
      if (intento < REINTENTOS_2CAPTCHA) await dormir(5000 * intento);
    }
  }
  throw new CaptchaError(
    `2captcha no pudo resolver el captcha tras ${REINTENTOS_2CAPTCHA} intentos: ${ultimo}`
  );
}

async function resolverTwocaptcha(cfg: ConfigCaptcha): Promise<string> {
  if (!cfg.twocaptchaKey) throw new CaptchaError("Falta TWOCAPTCHA_KEY");

  const tarea = await postJson(
    URL_IN,
    {
      key: cfg.twocaptchaKey,
      method: "userrecaptcha",
      googlekey: cfg.sitekey,
      pageurl: cfg.frontend,
      invisible: 1,
      json: 1,
    },
    "form"
  );

  if (Number(tarea.status) !== 1) {
    throw new CaptchaError(`2captcha rechazó la tarea: ${JSON.stringify(tarea)}`);
  }
  const taskId = String(tarea.request);
  console.log(`[captcha] 2captcha: tarea ${taskId} encolada`);

  const limite = Date.now() + cfg.pollTimeoutMs;
  while (Date.now() < limite) {
    await dormir(5000);
    const pago = await postJson(
      URL_RES,
      { key: cfg.twocaptchaKey, action: "get", id: taskId, json: 1 },
      "query"
    );
    if (Number(pago.status) === 1) return String(pago.request);
    if (pago.request !== "CAPCHA_NOT_READY") {
      throw new CaptchaError(`2captcha falló: ${JSON.stringify(pago)}`);
    }
  }

  throw new CaptchaError("2captcha: timeout esperando el token");
}

/**
 * `form` para in.php (POST urlencoded) y `query` para res.php (GET). Ambos
 * devuelven JSON; una respuesta no JSON es un error de servicio, no de datos.
 */
async function postJson(
  url: string,
  params: Record<string, string | number>,
  modo: "form" | "query"
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(modo === "form" ? url : `${url}?${qs.toString()}`, {
      method: modo === "form" ? "POST" : "GET",
      headers: modo === "form" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: modo === "form" ? qs.toString() : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    throw new CaptchaError(`Error de red con 2captcha: ${mensaje}`);
  }

  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new CaptchaError(`Respuesta inválida de 2captcha (HTTP ${res.status})`);
  }
}

async function tokenPlaywright(): Promise<never> {
  throw new CaptchaError(
    "El proveedor 'playwright' no está portado a Node en este sistema: requiere el " +
      "navegador headless en la imagen. Usá CAPTCHA_PROVIDER=twocaptcha."
  );
}

/**
 * Administra el token durante una corrida: lo reutiliza mientras sea válido (una
 * resolución sirve para muchos expedientes) y lo renueva sólo cuando vence o cuando
 * el PJud lo rechaza.
 */
export class TokenManager {
  private valor: string | null = null;
  private desde = 0;
  private readonly fijo?: string;
  private readonly ttlMs: number;
  private readonly obtener: () => Promise<string>;

  constructor(opts: { fijo?: string | null; ttlMs?: number; obtener?: () => Promise<string> } = {}) {
    // El token fijo es para pruebas y para `corrida --token`; no vence nunca.
    this.fijo = opts.fijo || undefined;
    this.ttlMs = opts.ttlMs ?? configCaptcha().ttlMs;
    this.obtener = opts.obtener ?? (() => obtenerToken());
  }

  async get(forzar = false): Promise<string> {
    if (this.fijo) return this.fijo;
    const vencido = this.valor === null || performance.now() - this.desde > this.ttlMs;
    if (forzar || vencido) {
      this.valor = await this.obtener();
      this.desde = performance.now();
      console.log("[captcha] token de captcha renovado");
    }
    const valor = this.valor;
    if (valor === null) throw new CaptchaError("el proveedor de captcha no devolvió un token");
    return valor;
  }
}
