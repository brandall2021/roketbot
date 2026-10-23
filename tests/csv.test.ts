import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvActualizar, parseCsvPreview } from "@/lib/csv";

/**
 * Parseo de CSV, pura lógica de archivo: nada de esto necesita base de datos.
 *
 * Se prueban los dos formatos que sube la gente desde el Poder Judicial, porque los
 * encabezados cambian de un reporte a otro y el legada ya toleraba varios alias.
 */

function csv(...lineas: string[]): Buffer {
  return Buffer.from(lineas.join("\n"), "utf8");
}

describe("parseCsvActualizar", () => {
  it("mantiene los alias del legado y sólo toma los tres campos del update", async () => {
    const r = await parseCsvActualizar(
      csv(
        "CentroJudId,Centro Judicial,Unidad Judicial,Expdte,Actor,Demandado,CodEstado,Estado atraves de expdte",
        "12,Capital,Unidad 1,EXP-001,Ana,Gomez,ACT,Activo"
      )
    );

    expect(r.total).toBe(1);
    expect(r.records[0]).toEqual({ expdte: "EXP-001", codEstado: "ACT", estado: "Activo" });
    expect(r.errors).toEqual([]);
    // Actor/demandado/centro NO viajan: un update masivo no toca datos de partes.
    expect(Object.keys(r.records[0])).toEqual(["expdte", "codEstado", "estado"]);
  });

  it("acepta el encabezado corto `Estado` para las dos columnas", async () => {
    const r = await parseCsvActualizar(csv("Expdte,CodEstado,Estado", "EXP-001,ACT,Activo"));
    expect(r.errors).toHaveLength(0);
    expect(r.records[0]).toEqual({ expdte: "EXP-001", codEstado: "ACT", estado: "Activo" });
  });

  it("si falta CodEstado lo toma de `Estado` (como hacía el legado)", async () => {
    const r = await parseCsvActualizar(csv("Expediente,Estado", "EXP-001,INA"));
    expect(r.records[0]).toEqual({ expdte: "EXP-001", codEstado: "INA", estado: "INA" });
  });

  it("recorta los valores y trata vacíos como ausentes", async () => {
    const r = await parseCsvActualizar(csv("Expdte,CodEstado,Estado", "  EXP-001  ,  ACT  ,   "));
    expect(r.records[0]).toEqual({ expdte: "EXP-001", codEstado: "ACT", estado: null });
    expect(r.errors).toEqual(["Fila 1: falta Estado"]);
  });

  it("reporta por número de fila qué campo falta (texto idéntico al legado)", async () => {
    const r = await parseCsvActualizar(csv("Expdte,CodEstado,Estado", ",ACT,", "EXP-9,,"));
    expect(r.errors).toEqual([
      "Fila 1: falta Expdte",
      "Fila 1: falta Estado",
      "Fila 2: falta CodEstado",
      "Fila 2: falta Estado",
    ]);
    expect(r.total).toBe(2);
    // A "EXP-9" no le falta el número: sólo se avisa lo que realmente falta.
    expect(r.records[1]).toEqual({ expdte: "EXP-9", codEstado: null, estado: null });
  });

  it("ignora mayúsculas y espacios en el encabezado", async () => {
    const r = await parseCsvActualizar(csv(" EXPDTE , CodEstado , ESTADO ATRAVES DE EXPDTE ", "1/1,ACT,Activo"));
    expect(r.records[0]).toEqual({ expdte: "1/1", codEstado: "ACT", estado: "Activo" });
  });

  it("el preview muestra cinco filas pero `total` cuenta todas", async () => {
    const lineas = ["Expdte,CodEstado,Estado"];
    for (let i = 1; i <= 8; i++) lineas.push(`EXP-${i},ACT,Activo`);
    const r = await parseCsvActualizar(csv(...lineas));
    expect(r.total).toBe(8);
    expect(r.rows).toHaveLength(5);
    expect(r.columns).toEqual(["Expdte", "CodEstado", "Estado"]);
  });

  it("sin filas de datos devuelve todo vacío en vez de explotar", async () => {
    const r = await parseCsvActualizar(csv("Expdte,CodEstado,Estado"));
    expect(r).toMatchObject({ total: 0, records: [], errors: [], rows: [] });
  });

  it("tolera `;` y CRLF, que es lo que sale de Excel en español", async () => {
    const r = await parseCsvActualizar(Buffer.from("Expdte;CodEstado;Estado\r\nEXP-1;ACT;Activo\r\n", "utf8"));
    expect(r.records[0]).toEqual({ expdte: "EXP-1", codEstado: "ACT", estado: "Activo" });
  });
});

describe("parseCsv (importación de expedientes)", () => {
  it("mapea las cabeceras legadas a las columnas nuevas", async () => {
    const r = await parseCsv(
      csv(
        "Expdte,Centro Judicial,Unidad Judicial,Actor,Demandado,Fecha,Descripcion,Documento,Fecha Procesado,Estado,Estado Actualizado,Carátula",
        "762/22,Capital,Unidad 1,Ana,Gomez,31/01/2026,Cargo de causa,https://x/1,01/02/2026,ACT,SI,Ana C/ Gomez"
      )
    );

    expect(r.errors).toEqual([]);
    expect(r.records[0]).toMatchObject({
      expdte: "762/22",
      centroJudicial: "Capital",
      unidadJudicial: "Unidad 1",
      fecha: "31/01/2026",
      documento: "https://x/1",
      // `Estado` (legado) es el procesal ACT/INA; el SI/NO/KO viene de `Estado Actualizado`.
      estadoProcesal: "ACT",
      estado: "SI",
      caratula: "Ana C/ Gomez",
    });
  });

  it("dos cabeceras para el mismo campo: gana la primera y la otra se pierde", async () => {
    // Era así en el legado y conviene que quede escrito: un archivo que traiga
    // `Estado` y `Estado Procesal` a la vez sólo usa `Estado`.
    const r = await parseCsv(csv("Expdte,Estado,Estado Procesal", "1/1,ACT,INA"));
    expect(r.records[0]).toMatchObject({ expdte: "1/1", estadoProcesal: "ACT" });
  });

  it("sin columna mapeada el campo queda null, no `undefined`", async () => {
    const r = await parseCsv(csv("Expdte,Actor", "1/1,Ana"));
    expect(r.records[0].caratula).toBeNull();
    expect(r.records[0]).toMatchObject({ expdte: "1/1", actor: "Ana" });
  });

  it("toda fila sin expediente es un error con su número de fila", async () => {
    const r = await parseCsv(csv("Expdte,Actor", ",Ana", "2/2,Beto"));
    expect(r.errors).toEqual(["Fila 1: falta el expediente (columna no mapeada o vacía)"]);
    expect(r.records).toHaveLength(2);
  });

  it("respeta un mapeo explícito de columnas", async () => {
    const r = await parseCsv(csv("expediente_viejo,quien", "1/1,Ana"), {
      expdte: "expediente_viejo",
      actor: "quien",
    });
    expect(r.records[0]).toMatchObject({ expdte: "1/1", actor: "Ana" });
  });

  it("el preview deja ver las columnas reales del archivo", async () => {
    const p = await parseCsvPreview(csv("Expdte,Quien sabe", "1/1,Ana"));
    expect(p).toMatchObject({ total: 1, errors: [], columns: ["Expdte", "Quien sabe"] });
    expect(p.rows[0]).toEqual({ Expdte: "1/1", "Quien sabe": "Ana" });
  });
});
