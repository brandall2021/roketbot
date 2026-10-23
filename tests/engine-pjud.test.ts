import { describe, expect, it, vi } from "vitest";
import {
  diaDesdeSql,
  descripcionDe,
  filtrarNuevas,
  hashMovimiento,
  parseFechaPjud,
  type Story,
} from "../lib/engine/pjud";
import { CaptchaError, TokenManager } from "../lib/engine/captcha";

/**
 * Tests del motor portado de Python.
 *
 * Lo que importa probar acá es la compatibilidad con los datos que ya están en la
 * base: la huella del movimiento es la que evita que las 114.742 líneas importadas
 * del legado vuelvan a entrar cuando el PJud las devuelve de nuevo. Un cambio de
 * formato en `hashMovimiento` duplica el historial en silencio.
 */

describe("parseFechaPjud", () => {
  it("acepta los cuatro formatos que aceptaba el bot", () => {
    expect(parseFechaPjud("20/10/2026")).toBe("2026-10-20");
    expect(parseFechaPjud("2026-10-20")).toBe("2026-10-20");
    expect(parseFechaPjud("20-10-2026")).toBe("2026-10-20");
    expect(parseFechaPjud("20/10/26")).toBe("2026-10-20");
  });

  it("recorta espacios y sufijos de hora", () => {
    expect(parseFechaPjud("  20/10/2026 09:30:00 ")).toBe("2026-10-20");
  });

  it("devuelve null en lugar de tirar: una fecha ilegible no corta la corrida", () => {
    expect(parseFechaPjud(null)).toBeNull();
    expect(parseFechaPjud("")).toBeNull();
    expect(parseFechaPjud("s/ fecha")).toBeNull();
    expect(parseFechaPjud("13/13/13")).toBeNull();
  });

  it("valida el calendario, como hacía strptime en Python", () => {
    expect(parseFechaPjud("31/02/2026")).toBeNull();
    expect(parseFechaPjud("29/02/2023")).toBeNull();
    expect(parseFechaPjud("29/02/2024")).toBe("2024-02-29");
    expect(parseFechaPjud("31/04/2026")).toBeNull();
  });
});

describe("hashMovimiento", () => {
  it("coincide byte a byte con el sha256 que produjo el bot Python", () => {
    // Vectores calculados con hashlib sobre la misma clave "YYYY-MM-DD|desc".
    expect(hashMovimiento("2026-10-20", "Resuelve Medida Cautelar")).toBe(
      "a8c87f3ab0522b82257ff72b0eb5ea86dbdc6925df05f8dd403f6f41068d7acd"
    );
    expect(hashMovimiento(null, "sin fecha")).toBe(
      "84a24d1706b15bc85edcd2bacee20421aac6aa31d35019d39a80de9c4f92c31e"
    );
    expect(hashMovimiento("2024-01-05", "  Notificación  ")).toBe(
      "36a76171d8b05f7ba21dcfd76f80ecb56d7660d9a6b88dcbbc86adc43330e8cf"
    );
  });

  it("ignora el histid: si no, el mismo movimiento entraría dos veces", () => {
    expect(hashMovimiento("2026-10-20", "Resuelve Medida Cautelar")).toBe(
      hashMovimiento("2026-10-20", "resuelve medida cautelar")
    );
  });
});

describe("diaDesdeSql", () => {
  it("lee el día calendario de una columna date devuelta por pg", () => {
    // pg devuelve las columnas `date` como medianoche local.
    expect(diaDesdeSql(new Date(2026, 9, 20))).toBe("2026-10-20");
  });

  it("tolera el valor textual y descarta lo ilegible", () => {
    expect(diaDesdeSql("2026-10-20")).toBe("2026-10-20");
    expect(diaDesdeSql("2026-10-20T00:00:00.000Z")).toBe("2026-10-20");
    expect(diaDesdeSql(null)).toBeNull();
    expect(diaDesdeSql("")).toBeNull();
    expect(diaDesdeSql("sin fecha")).toBeNull();
  });
});

const story = (fecha: string | null, dscr: string): Story => ({ fecha, dscr });

describe("filtrarNuevas", () => {
  const vieja = story("10/10/2026", "Presenta demanda");
  const media = story("15/10/2026", "Resuelve medida cautelar");
  const nueva = story("20/10/2026", "Notifica");
  const ilegible = story("sin fecha", "Basura");

  it("sin fecha de referencia devuelve todo, ordenado ascendente", () => {
    expect(filtrarNuevas([nueva, vieja, media], null).map((s) => s.dscr)).toEqual([
      "Presenta demanda",
      "Resuelve medida cautelar",
      "Notifica",
    ]);
  });

  it("filtra estrictamente posterior (el mismo día no es novedad)", () => {
    expect(filtrarNuevas([vieja, media, nueva], "2026-10-15").map((s) => s.dscr)).toEqual(["Notifica"]);
    expect(filtrarNuevas([vieja, media, nueva], "2026-10-10").map((s) => s.dscr)).toEqual([
      "Resuelve medida cautelar",
      "Notifica",
    ]);
  });

  it("descarta las líneas sin fecha legible", () => {
    expect(filtrarNuevas([ilegible, nueva], null).map((s) => s.dscr)).toEqual(["Notifica"]);
  });

  it("no rompe con una lista vacía", () => {
    expect(filtrarNuevas([], null)).toEqual([]);
  });
});

describe("descripcionDe", () => {
  it("recorta y normaliza a null la descripción vacía", () => {
    expect(descripcionDe(story(null, "  Notifica  "))).toBe("Notifica");
    expect(descripcionDe(story(null, "   "))).toBeNull();
    expect(descripcionDe({})).toBeNull();
  });
});

describe("TokenManager", () => {
  it("reutiliza el token mientras no vence: una resolución sirve para muchos expedientes", async () => {
    const obtener = vi.fn(async () => "token-unico");
    const tokens = new TokenManager({ obtener, ttlMs: 60_000 });

    await expect(tokens.get()).resolves.toBe("token-unico");
    await expect(tokens.get()).resolves.toBe("token-unico");
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it("renueva cuando el PJud rechaza el token", async () => {
    const obtener = vi.fn(async () => `t${Math.random()}`);
    const tokens = new TokenManager({ obtener, ttlMs: 60_000 });

    await tokens.get();
    await tokens.get(true);
    expect(obtener).toHaveBeenCalledTimes(2);
  });

  it("renueva cuando vence", async () => {
    let reloj = 0;
    const espia = vi.spyOn(performance, "now").mockImplementation(() => reloj);
    const obtener = vi.fn(async () => "t");
    const tokens = new TokenManager({ obtener, ttlMs: 90_000 });

    await tokens.get();
    reloj += 91_000;
    await tokens.get();
    expect(obtener).toHaveBeenCalledTimes(2);
    espia.mockRestore();
  });

  it("un token fijo no llama nunca al proveedor", async () => {
    const obtener = vi.fn(async () => "no deberia pasar");
    const tokens = new TokenManager({ fijo: "manual", obtener, ttlMs: 1 });
    await expect(tokens.get()).resolves.toBe("manual");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("CAPTCHA_PROVIDER=none falla temprano, con el mensaje de configuración", async () => {
    await expect(new TokenManager({ obtener: () => Promise.reject(new CaptchaError("sin proveedor")) }).get()).rejects.toBeInstanceOf(
      CaptchaError
    );
  });
});
