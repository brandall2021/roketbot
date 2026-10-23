import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_INTERNO,
  ErrorDePeticion,
  comoCodigoEndpoint,
  comoId,
  comoProvinciaId,
  conflicto,
  esViolacionDeClaveForanea,
  esViolacionDeUnicidad,
  escaparCelulaCsv,
  filaCsv,
  respuestaDeError,
} from "@/lib/rutas";

/**
 * Helpers de la capa HTTP. Lo que más importa: el escapado de CSV (un padrón del
 * Poder Judicial se abre en Excel y una celda `=...` se ejecuta) y que un error de
 * Postgres nunca llegue al navegador con su mensaje en texto.
 */

describe("escaparCelulaCsv", () => {
  it("pone comillas y dobla las comillas internas", () => {
    expect(escaparCelulaCsv('Ana "La Jefa" Gomez')).toBe('"Ana ""La Jefa"" Gomez"');
  });

  it("prefija con apostrofo toda celda que Excel interpretaría como fórmula", () => {
    for (const inicio of ["=1+1", "+1+1", "-1+1", "@SUM(1+1)"]) {
      expect(escaparCelulaCsv(inicio)).toBe(`"'${inicio}"`);
    }
  });

  it("TAB y CR al inicio también son fórmula", () => {
    expect(escaparCelulaCsv("\t=cmd")).toBe(`"'=cmd"`);
    expect(escaparCelulaCsv("\r=cmd")).toBe(`"'=cmd"`);
  });

  it("no toca un valor que arranca normal (ni un número negativo en el medio)", () => {
    expect(escaparCelulaCsv("762/22")).toBe('"762/22"');
    expect(escaparCelulaCsv("Gomez - Ana")).toBe('"Gomez - Ana"');
    expect(escaparCelulaCsv("https://x/a.pdf")).toBe('"https://x/a.pdf"');
  });

  it("null, undefined y vacío salen como celda vacía, no como `null` literal", () => {
    expect(escaparCelulaCsv(null)).toBe('""');
    expect(escaparCelulaCsv(undefined)).toBe('""');
    expect(escaparCelulaCsv("")).toBe('""');
    expect(escaparCelulaCsv(0)).toBe('"0"');
  });

  it("un salto de línea dentro de la celda no parte el CSV en dos filas", () => {
    expect(escaparCelulaCsv("linea1\nlinea2")).toBe('"linea1 linea2"');
    expect(escaparCelulaCsv("linea1\r\nlinea2")).toBe('"linea1 linea2"');
  });

  it("los números de Postgres (agregates en string) se escriben igual", () => {
    expect(escaparCelulaCsv("123")).toBe('"123"');
    expect(escaparCelulaCsv(123)).toBe('"123"');
  });
});

describe("filaCsv", () => {
  it("une con el separador de la app (;) y escapa cada celda", () => {
    expect(filaCsv(["762/22", 'Ana "La Jefa"', "=HYPERLINK(\"http://evil\")"])).toBe(
      '"762/22";"Ana ""La Jefa""";"\'=HYPERLINK(""http://evil"")"'
    );
  });

  it("permite otro separador para quien abra el archivo con coma", () => {
    expect(filaCsv(["a", "b"], ",")).toBe('"a","b"');
  });
});

describe("validación numérica de maestros", () => {
  it(`codigo_endpoint: hasta 4 dígitos o mensaje legible`, () => {
    expect(comoCodigoEndpoint(null)).toEqual({ valor: null });
    expect(comoCodigoEndpoint("")).toEqual({ valor: null });
    expect(comoCodigoEndpoint("27")).toEqual({ valor: 27 });
    for (const malo of ["27.5", "abc", "12345", "-1", "1e3"]) {
      expect(comoCodigoEndpoint(malo).valor).toBeNull();
      expect(comoCodigoEndpoint(malo).error).toMatch(/hasta 4 dígitos/);
    }
  });

  it("provinciaId: entero positivo, o null si viene vacío", () => {
    expect(comoProvinciaId(null)).toEqual({ valor: null });
    expect(comoProvinciaId("3")).toEqual({ valor: 3 });
    for (const malo of ["0", "-2", "1.5", "novecientos", "Infinity"]) {
      expect(comoProvinciaId(malo).valor).toBeNull();
      expect(comoProvinciaId(malo).error).toMatch(/provinciaId inválido/);
    }
  });

  it("comoId acepta sólo enteros positivos y tolera espacios", () => {
    expect(comoId("12")).toBe(12);
    expect(comoId(" 12 ")).toBe(12);
    for (const malo of ["", " ", "0", "-1", "1.5", "NaN", "abc", undefined, null]) {
      expect(comoId(malo)).toBeNull();
    }
  });
});

describe("mapeo de errores de Postgres", () => {
  const error = (code?: string) => Object.assign(new Error("duplicate key value ..."), { code });

  it("reconoce SQLSTATE 23505 y 23503 por código, nunca por el texto", () => {
    expect(esViolacionDeUnicidad(error("23505"))).toBe(true);
    expect(esViolacionDeUnicidad(error("23503"))).toBe(false);
    expect(esViolacionDeClaveForanea(error("23503"))).toBe(true);
    expect(esViolacionDeClaveForanea(error("23505"))).toBe(false);
    expect(esViolacionDeUnicidad({})).toBe(false);
    expect(esViolacionDeClaveForanea(undefined)).toBe(false);
    // Un mensaje que mencione la restricción no alcanza: hay que comparar el código.
    expect(esViolacionDeUnicidad(new Error("violación de UNIQUE 23505"))).toBe(false);
  });

  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("un error inesperado responde genérico y loguea con el nombre de la ruta", async () => {
    const res = respuestaDeError("expedientes", error("57014"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: ERROR_INTERNO });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain("[api/expedientes]");
  });

  it("jamás filtra el mensaje de Postgres al cliente", async () => {
    const err = Object.assign(new Error('relation "expdtescaratula" does not exist'), {
      code: "42P01",
      detail: "secrets of the database",
    });
    const body = await respuestaDeError("centros", err).json();
    expect(body).toEqual({ error: ERROR_INTERNO });
    expect(JSON.stringify(body)).not.toContain("does not exist");
  });

  it("ErrorDePeticion es un 400 con su mensaje legible", async () => {
    const res = respuestaDeError("caratula/[id]", new ErrorDePeticion("El endpoint debe ser un número"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "El endpoint debe ser un número" });
  });

  it("conflicto responde 409 con el mensaje propio y loguea el real", async () => {
    const res = conflicto("provincias", error("23505"), "Ya existe una provincia con ese nombre");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Ya existe una provincia con ese nombre" });
    expect(spy.mock.calls[0][0]).toContain("[api/provincias] conflicto de unicidad");
  });
});
