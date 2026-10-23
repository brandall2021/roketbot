import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  consultar: vi.fn(),
  consultarUno: vi.fn(),
  ejecutar: vi.fn(),
  enTransaccion: vi.fn(),
  txQuery: vi.fn(),
}));

/**
 * La base va entera de mock: acá no hay PostgreSQL ni Docker, y ningún test puede
 * pedirle una conexión. Se re-implementan `num`/`fecha` (son puras) y se tapán las
 * cuatro funciones que hablan con `pg`.
 */
vi.mock("@/lib/db", () => ({
  consultar: db.consultar,
  consultarUno: db.consultarUno,
  ejecutar: db.ejecutar,
  enTransaccion: db.enTransaccion,
  num: (valor: unknown) => {
    if (typeof valor === "number") return valor;
    const n = Number(valor ?? 0);
    return Number.isFinite(n) ? n : 0;
  },
  fecha: (valor: unknown) => {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(String(valor));
    return Number.isNaN(d.getTime()) ? String(valor) : d.toISOString();
  },
  pool: vi.fn(),
  conCliente: vi.fn(),
  cerrarPool: vi.fn(),
  estanSanos: vi.fn(),
  default: {
    consultar: db.consultar,
    consultarUno: db.consultarUno,
    ejecutar: db.ejecutar,
    enTransaccion: db.enTransaccion,
  },
}));

import {
  actualizarEnMasa,
  actualizarExpediente,
  caratulaAuto,
  cargarLote,
  darAlta,
  limpiar,
  parseFecha,
  registrarCarga,
  resolverCentro,
  validar,
  type CargaInput,
} from "@/lib/expedientes";

/* -------------------------------------------------------------------------- */
/* Lógica pura                                                                 */
/* -------------------------------------------------------------------------- */

describe("parseFecha", () => {
  it("lee DD/MM/AAAA en el orden argentino, no estadounidense", () => {
    // `new Date("12/03/2024")` daría 3 de diciembre: el padrón invertía día y mes.
    expect(parseFecha("12/03/2024")).toBe("2024-03-12");
  });

  it("devuelve cadena AAAA-MM-DD, no Date", () => {
    // Un Date a medianoche UTC se serializa con los componentes LOCALES de pg: en un
    // contenedor con TZ=-03 el día se guardaba uno antes. La cadena no tiene zona.
    expect(parseFecha("12/03/2024")).not.toBeInstanceOf(Date);
    expect(typeof parseFecha("12/03/2024")).toBe("string");
  });

  it("acepta día y mes de un dígito", () => {
    expect(parseFecha("1/9/2024")).toBe("2024-09-01");
    expect(parseFecha("2026-1-2")).toBe("2026-01-02");
  });

  it("DD/MM/AA se expande al siglo 2000", () => {
    expect(parseFecha("20/10/26")).toBe("2026-10-20");
  });

  it("ISO AAAA-MM-DD también entra (es lo que devuelve el PJud)", () => {
    expect(parseFecha("2026-10-20")).toBe("2026-10-20");
  });

  it("ignora el horario pegado a la fecha", () => {
    expect(parseFecha("12/03/2024 10:30:00")).toBe("2024-03-12");
  });

  it("rechaza fechas que no existen en el calendario", () => {
    // Era el agujero del port: Date.UTC rollea 31/02 a 03/03 y 13/13 a 2014-01-13, así
    // que el CSV guardaba una fecha inventada sin avisar.
    expect(parseFecha("31/02/2024")).toBeNull();
    expect(parseFecha("13/13/13")).toBeNull();
    expect(parseFecha("29/02/2023")).toBeNull();
    expect(parseFecha("29/02/2024")).toBe("2024-02-29");
  });

  it("null, vacío y basura no dan una fecha inventada", () => {
    expect(parseFecha(null)).toBeNull();
    expect(parseFecha(undefined)).toBeNull();
    expect(parseFecha("   ")).toBeNull();
    expect(parseFecha("sin fecha")).toBeNull();
    expect(parseFecha("hola mundo")).toBeNull();
  });

  it("recorta antes de parsear", () => {
    expect(parseFecha("  12/03/2024  ")).toBe("2024-03-12");
  });
});

describe("validar", () => {
  const base: CargaInput = { expdte: "762/22", estado: "SI", estadoProcesal: "ACT" };

  it("un registro sano pasa", () => {
    expect(validar(base)).toBeNull();
    expect(validar({ expdte: "1/20" })).toBeNull();
  });

  it("exige el número de expediente", () => {
    expect(validar({ ...base, expdte: "" })).toMatch(/falta el número/);
    expect(validar({ ...base, expdte: null })).toMatch(/falta el número/);
  });

  it("corta el expediente a 64 (longitud de la columna)", () => {
    expect(validar({ ...base, expdte: "X".repeat(65) })).toMatch(/supera 64/);
    expect(validar({ ...base, expdte: "X".repeat(64) })).toBeNull();
  });

  it("el estado SI/NO/KO se compara en mayúsculas y nada otra cosa", () => {
    expect(validar({ ...base, estado: "si" })).toBeNull();
    expect(validar({ ...base, estado: "KO" })).toBeNull();
    // El largo se chequea primero: un valor de más de 4 caracteres se rechaza por
    // largo (es la longitud de la columna), antes de mirar el vocabulario.
    expect(validar({ ...base, estado: "OK" })).toMatch(/estado "OK" inválido/);
    expect(validar({ ...base, estado: "MAYBE" })).toMatch(/estado \(SI\/NO\/KO\) supera 4 caracteres/);
    expect(validar({ ...base, estado: "SISSSS" })).toMatch(/supera 4 caracteres/);
  });

  it("el estado procesal sólo admite ACT/INA", () => {
    expect(validar({ ...base, estadoProcesal: "ina" })).toBeNull();
    expect(validar({ ...base, estadoProcesal: "PENDIENTE" })).toMatch(/supera 8 caracteres/);
    expect(validar({ ...base, estadoProcesal: "ACTIVO" })).toMatch(/estado procesal "ACTIVO" inválido/);
  });

  it("los largotes de carátula y documento se rechazan antes del INSERT", () => {
    expect(validar({ ...base, caratula: "C".repeat(401) })).toMatch(/carátula supera 400/);
    expect(validar({ ...base, documento: "h".repeat(2001) })).toMatch(/documento \(URL\) supera 2000/);
    expect(validar({ ...base, estadoProcesalNombre: "N".repeat(41) })).toMatch(/nombre del estado/);
  });

  it("una fecha que no se puede parsear es error de fila, no un NULL silencioso", () => {
    expect(validar({ ...base, fecha: "13/13/13" })).toMatch(/fecha de movimiento inválida/);
    expect(validar({ ...base, fechaProcesado: "sin fecha" })).toMatch(/fecha procesado inválida/);
    // Vacía sí es válida: la columna es nullable y "sin fecha" es un estado legítimo.
    expect(validar({ ...base, fecha: "", fechaProcesado: "  " })).toBeNull();
    expect(validar({ ...base, fecha: "12/03/2024", fechaProcesado: "2024-03-13" })).toBeNull();
  });
});

describe("caratulaAuto / limpiar", () => {
  it("arma la carátula legacy `Actor C/ Demandado`", () => {
    expect(caratulaAuto({ actor: "Ana", demandado: "Gomez" })).toBe("Ana C/ Gomez");
  });

  it("sin demandado no deja `C/ ` colgando al final", () => {
    expect(caratulaAuto({ actor: "Ana" })).toBe("Ana C/");
    expect(caratulaAuto({})).toBe("C/");
  });

  it("limpiar recorta y convierte null en ''", () => {
    expect(limpiar("  hola \n")).toBe("hola");
    expect(limpiar(null)).toBe("");
    expect(limpiar(undefined)).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Escritura sobre Postgres (mockeada)                                         */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  vi.clearAllMocks();
  db.enTransaccion.mockImplementation(async (fn: (tx: { query: typeof db.txQuery }) => Promise<unknown>) =>
    fn({ query: db.txQuery })
  );
});

const centro = {
  id: 3,
  nombre: "Capital",
  unidad: "Unidad 1",
  codigo_endpoint: 27,
  provincia: "Tucumán",
};

describe("resolverCentro", () => {
  it("resuelve por id propio, legado o código de endpoint con un solo parámetro", async () => {
    db.consultarUno.mockResolvedValue(centro);
    const r = await resolverCentro({ cenJudId: "27" });
    expect(r.centro).toMatchObject({ id: 3, jurisdiccion: 27, provincia: "Tucumán" });

    const [sql, valores] = db.consultarUno.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("c.id = $1 OR c.legado_id = $1 OR c.codigo_endpoint = $1");
    expect(valores).toEqual([27]);
    expect(sql).not.toContain("27");
  });

  it("un id no numérico se rechaza antes de tocar la base", async () => {
    const r = await resolverCentro({ cenJudId: "Capital" });
    expect(r.centro).toBeNull();
    expect(r.error).toMatch(/ID de centro judicial inválido/);
    expect(db.consultarUno).not.toHaveBeenCalled();
  });

  it("sin id busca por nombre y unidad, con los valores posicionales", async () => {
    db.consultarUno.mockResolvedValue(centro);
    const r = await resolverCentro({ centroJudicial: " Capital ", unidadJudicial: "Unidad 1" });
    expect(r.centro?.nombre).toBe("Capital");
    const [, valores] = db.consultarUno.mock.calls[0] as unknown as [string, unknown[]];
    expect(valores).toEqual(["Capital", "Unidad 1"]);
  });

  it("centro inexistente o falta el nombre devuelven error legible", async () => {
    db.consultarUno.mockResolvedValue(null);
    expect((await resolverCentro({ centroJudicial: "Nosuch" })).error).toMatch(/no encontrado/);
    expect((await resolverCentro({})).error).toMatch(/falta el centro judicial/);
  });
});

describe("darAlta", () => {
  it("inserta con la jurisdicción del centro y devuelve el id de RETURNING", async () => {
    db.consultarUno.mockResolvedValue(centro);
    db.consultar.mockResolvedValue([{ id: "42" }]);

    const r = await darAlta({ expdte: "762/22", actor: "Ana", estado: "si", cenJudId: "27" }, 9, "MANUAL");

    expect(r).toEqual({ insertado: true, duplicado: false, id: 42 });
    const [sql, valores] = db.consultar.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO expedientes");
    expect(sql).toContain("ON CONFLICT (numero, jurisdiccion) DO NOTHING");
    expect(sql).toContain("RETURNING id");
    expect(valores[0]).toBe("762/22");
    expect(valores[1]).toBe(27);
    expect(valores).toContain("SI");
    expect(valores).toContain(9);
  });

  it("conflicto de unicidad = duplicado, no error", async () => {
    db.consultarUno.mockResolvedValue(centro);
    db.consultar.mockResolvedValue([]);
    expect(await darAlta({ expdte: "762/22", cenJudId: "27" }, 9, "CSV")).toEqual({
      insertado: false,
      duplicado: true,
    });
  });

  it("un registro inválido o un centro irresoluble no llegan al INSERT", async () => {
    expect(await darAlta({ expdte: "" }, 9, "MANUAL")).toMatchObject({ insertado: false, error: expect.stringMatching(/falta el número/) });
    db.consultarUno.mockResolvedValue(null);
    expect(await darAlta({ expdte: "1/1", cenJudId: "999" }, 9, "MANUAL")).toMatchObject({
      error: expect.stringMatching(/centro judicial no encontrado/),
    });
    expect(db.consultar).not.toHaveBeenCalled();
  });

  it("el estado procesal y su nombre caen al default ACT/ACTIVO como el legado", async () => {
    db.consultarUno.mockResolvedValue(centro);
    db.consultar.mockResolvedValue([{ id: 1 }]);
    await darAlta({ expdte: "762/22", cenJudId: "27" }, 9, "MANUAL");
    const [, valores] = db.consultar.mock.calls[0] as unknown as [string, unknown[]];
    expect(valores[13]).toBe("ACT");
    expect(valores[14]).toBe("ACTIVO");
  });
});

describe("cargarLote", () => {
  it("cuenta insertados y duplicados por rowCount y acumula errores sin cortar el lote", async () => {
    db.consultarUno.mockResolvedValue(centro);
    db.txQuery
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const r = await cargarLote(
      [
        { expdte: "1/1", cenJudId: "27" },
        { expdte: "2/2", cenJudId: "27" },
        { expdte: "", cenJudId: "27" },
        { expdte: "4/4", cenJudId: "27" },
      ],
      9,
      "CSV"
    );

    expect(r.insertados).toBe(2);
    expect(r.duplicados).toBe(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toContain('Expediente "(sin número)"');
    expect(r.errores[0]).toMatch(/falta el número de expediente/);
    // Todo el lote va dentro de UNA transacción: medio archivo aplicado es peor que ninguno.
    expect(db.enTransaccion).toHaveBeenCalledTimes(1);
  });

  it("ninguna fila del CSV se interpola en el SQL", async () => {
    db.consultarUno.mockResolvedValue(centro);
    db.txQuery.mockResolvedValue({ rowCount: 1 });
    await cargarLote([{ expdte: "'; DROP TABLE expedientes; --", cenJudId: "27" }], 9, "CSV");
    const [sql, valores] = db.txQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain("DROP");
    expect(valores[0]).toBe("'; DROP TABLE expedientes; --");
  });
});

describe("actualizarEnMasa", () => {
  it("normaliza CodEstado/Estado a mayúsculas y actualiza sólo el estado procesal", async () => {
    db.txQuery.mockResolvedValue({ rowCount: 1 });
    const r = await actualizarEnMasa([{ expdte: " EXP-001 ", codEstado: " act ", estado: " inactivo " }]);

    expect(r).toEqual({ actualizados: 1, errores: [] });
    const [sql, valores] = db.txQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("SET estado = $2");
    expect(sql).toContain("estado_nombre = $3");
    expect(sql).toContain("WHERE numero = $1");
    expect(sql).not.toMatch(/ExpdteActor|ExpdteCenJudId|actor|centro_id/);
    expect(valores).toEqual(["EXP-001", "ACT", "INACTIVO"]);
  });

  it("exige CodEstado y Estado, igual que el legado", async () => {
    const r = await actualizarEnMasa([{ expdte: "EXP-001" }]);
    expect(r.actualizados).toBe(0);
    expect(r.errores[0]).toBe('Expediente "EXP-001": falta CodEstado o Estado');
    expect(db.txQuery).not.toHaveBeenCalled();
  });

  it("rechaza un código de estado que no sea ACT/INA", async () => {
    const r = await actualizarEnMasa([{ expdte: "EXP-001", codEstado: "XD", estado: "Raro" }]);
    expect(r.errores[0]).toMatch(/CodEstado "XD" inválido: usá ACT o INA/);
    expect(db.txQuery).not.toHaveBeenCalled();
  });

  it("un expediente inexistente se reporta y sigue con el resto (no se inventan filas)", async () => {
    db.txQuery.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1 });
    const r = await actualizarEnMasa([
      { expdte: "EXP-001", codEstado: "ACT", estado: "Activo" },
      { expdte: "EXP-002", codEstado: "INA", estado: "Inactivo" },
    ]);
    expect(r.actualizados).toBe(1);
    expect(r.errores).toEqual(['Expediente "EXP-001": no se encontró el expediente']);
    expect(db.txQuery).toHaveBeenCalledTimes(2);
  });
});

describe("registrarCarga", () => {
  it("guarda la auditoría del archivo y devuelve el id nuevo", async () => {
    db.consultar.mockResolvedValue([{ id: "5" }]);
    const id = await registrarCarga(
      {
        archivo: "padron.csv",
        tamano: 1024,
        filasLeidas: 10,
        insertados: 8,
        duplicados: 1,
        errores: ["e1", "e2"],
        origen: "CSV",
      },
      9
    );

    expect(id).toBe(5);
    const [sql, valores] = db.consultar.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO cargas");
    expect(sql).toContain("RETURNING id");
    expect(valores).toEqual(["padron.csv", 1024, 10, 8, 1, 0, 2, "e1\ne2", "CSV", 9]);
  });

  it("sin errores el detalle va null y el origen default es CSV", async () => {
    db.consultar.mockResolvedValue([{ id: 1 }]);
    await registrarCarga(
      { archivo: "a.csv", tamano: 1, filasLeidas: 1, insertados: 1, duplicados: 0, errores: [] },
      9
    );
    const [, valores] = db.consultar.mock.calls[0] as unknown as [string, unknown[]];
    expect(valores[6]).toBe(0);
    expect(valores[7]).toBeNull();
    expect(valores[8]).toBe("CSV");
  });

  it("recorta el nombre del archivo y el detalle para no pasarse de la columna", async () => {
    db.consultar.mockResolvedValue([{ id: 1 }]);
    await registrarCarga(
      {
        archivo: "x".repeat(400),
        tamano: 1,
        filasLeidas: 1,
        insertados: 0,
        duplicados: 0,
        errores: ["E".repeat(9000)],
      },
      9
    );
    const [, valores] = db.consultar.mock.calls[0] as unknown as [string, unknown[]];
    expect((valores[0] as string).length).toBe(255);
    expect((valores[7] as string).length).toBeLessThanOrEqual(8000);
  });
});

describe("actualizarExpediente", () => {
  it("sólo escribe columnas de la lista blanca, con placeholders posicionales", async () => {
    db.ejecutar.mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] });

    const r = await actualizarExpediente(7, {
      caratula: " Nueva ",
      estado: "KO",
      password_hash: "nope",
      "1=1": "nope",
    });

    expect(r).toEqual({ actualizados: 1, campos: ["caratula", "actualizado"] });
    const [sql, valores] = db.ejecutar.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toBe("UPDATE expedientes SET caratula = $2, actualizado = $3 WHERE id = $1");
    expect(valores).toEqual([7, "Nueva", "KO"]);
    expect(sql).not.toContain("password_hash");
    expect(sql).not.toContain("1=1");
  });

  it("los campos de fecha se normalizan a AAAA-MM-DD", async () => {
    db.ejecutar.mockResolvedValue({ rowCount: 1, rows: [] });
    await actualizarExpediente(7, { fecha: "12/03/2024", fechaProcesado: "2024-3-13" });
    const [, valores] = db.ejecutar.mock.calls[0] as unknown as [string, unknown[]];
    expect(valores[1]).toBe("2024-03-12");
    expect(valores[2]).toBe("2024-03-13");
  });

  it("una fecha ilegible rechaza el update en vez de borrar la columna", async () => {
    // `SET fch_ult_mov = NULL` por un typo en el formulario es pérdida de datos silenciosa.
    await expect(actualizarExpediente(7, { fecha: "31/02/2024" })).rejects.toThrow(/fecha inválida/);
    expect(db.ejecutar).not.toHaveBeenCalled();
  });

  it("cadena vacía = no tocar la columna; payload vacío = error explícito", async () => {
    await expect(actualizarExpediente(7, { caratula: "   ", actor: null as unknown as string })).rejects.toThrow(
      "No hay campos para actualizar"
    );
    expect(db.ejecutar).not.toHaveBeenCalled();
  });
});
