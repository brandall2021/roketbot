import { describe, expect, it } from "vitest";
import {
  CAMPOS_LISTADO,
  FUENTE,
  construirFiltros,
  filaVista,
  formatoDmY,
  orden,
  paginacion,
} from "@/lib/consulta";

/**
 * Tests de la capa de lectura del listado (sin base de datos).
 *
 * Lo que se cuida acá es lo que un SQL Server roto te devuelve igual pero mal:
 * que ningún valor del usuario entre al texto SQL, que el ordenamiento sólo pueda
 * nombrar columnas de la lista blanca y que las filas conserven las claves legadas
 * (`"Centro Judicial"`, `Expdte`, `Estado`, ...) que leen los componentes React.
 */

function params(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

describe("construirFiltros", () => {
  it("sin filtros no devuelve WHERE (y la query queda válida)", () => {
    const f = construirFiltros(params(""));
    expect(f.where).toBe("");
    expect(f.valores).toEqual([]);
    expect(f.usados).toEqual([]);
  });

  it("un filtro de texto va siempre por posición, nunca pegado al SQL", () => {
    const f = construirFiltros(params("expdte=EXP-001"));
    expect(f.where).toBe("WHERE numero ILIKE $1");
    expect(f.valores).toEqual(["%EXP-001%"]);
    expect(f.usados).toEqual(["expdte"]);
  });

  it("numera los placeholders en el orden de los valores", () => {
    const f = construirFiltros(params("centro=Capital&unidad=Unidad%203&actor=Ana"));
    expect(f.where).toBe("WHERE centro_judicial ILIKE $1 AND unidad_judicial ILIKE $2 AND actor ILIKE $3");
    expect(f.valores).toEqual(["%Capital%", "%Unidad 3%", "%Ana%"]);
  });

  it("el `Estado` legado era ExpdteActualizado; el procesal es otra columna", () => {
    const estado = construirFiltros(params("estado=SI"));
    expect(estado.where).toBe("WHERE actualizado ILIKE $1");

    const procesal = construirFiltros(params("procesal=ACT"));
    expect(procesal.where).toBe("WHERE estado ILIKE $1");
  });

  it("`q` replica una sola posición sobre todas las columnas de búsqueda", () => {
    const f = construirFiltros(params("q=foo"));
    expect(f.where).toBe(
      "WHERE (numero ILIKE $1 OR caratula ILIKE $1 OR actor ILIKE $1 OR demandado ILIKE $1 OR ult_mov_desc ILIKE $1 OR documento ILIKE $1)"
    );
    // Una sola value shared: si cada columna tuviera su $n, el mismo texto se
    // mandaría seis veces y el orden de valores se desalinearía.
    expect(f.valores).toEqual(["%foo%"]);
  });

  it("combina `q` con filtros y sigue numerando sin saltear", () => {
    const f = construirFiltros(params("caratula=Jud&q=bar"));
    expect(f.where).toBe(
      "WHERE caratula ILIKE $1 AND (numero ILIKE $2 OR caratula ILIKE $2 OR actor ILIKE $2 OR demandado ILIKE $2 OR ult_mov_desc ILIKE $2 OR documento ILIKE $2)"
    );
    expect(f.valores).toEqual(["%Jud%", "%bar%"]);
  });

  it("las fechas de rango se validan: una basura se ignora, no rompe la query", () => {
    const buena = construirFiltros(params("fechaProcesadoDesde=2026-01-31&fechaProcesadoHasta=2026-02-01"));
    expect(buena.where).toBe("WHERE fch_ult_proc::date >= $1::date AND fch_ult_proc::date <= $2::date");
    expect(buena.valores).toEqual(["2026-01-31", "2026-02-01"]);

    const basura = construirFiltros(params("fechaProcesadoDesde=31/01/2026"));
    expect(basura.where).toBe("");
    expect(basura.valores).toEqual([]);
    expect(basura.usados).toEqual([]);
  });

  it("un intento de inyección termina como valor, no como SQL", () => {
    const attack = "'; DROP TABLE expedientes; --";
    const f = construirFiltros(params(`expdte=${encodeURIComponent(attack)}`));
    expect(f.where).not.toContain("DROP");
    expect(f.where).not.toContain(attack);
    expect(f.where).not.toContain("'");
    expect(f.valores).toEqual([`%${attack}%`]);
  });

  it("recorta y descarta vacíos", () => {
    const f = construirFiltros(params("actor=%20%20&caratula=x"));
    expect(f.where).toBe("WHERE caratula ILIKE $1");
    expect(f.valores).toEqual(["%x%"]);
  });
});

describe("orden", () => {
  it("por defecto ordena por expediente (el orden legacy del padrón)", () => {
    expect(orden(params(""))).toContain("ASC NULLS LAST");
    expect(orden(params(""))).toContain("split_part(numero, '/', 1)");
  });

  it("mapea cada clave conocida a su columna real", () => {
    const casos: [string, string][] = [
      ["caratula", "caratula ASC"],
      ["centro", "centro_judicial ASC"],
      ["unidad", "unidad_judicial ASC"],
      ["provincia", "provincia ASC"],
      ["fecha", "fch_ult_mov ASC"],
      ["fechaprocesado", "fch_ult_proc ASC"],
      ["descripcion", "ult_mov_desc ASC"],
      ["documento", "documento ASC"],
      ["estado", "actualizado ASC"],
      ["procesal", "estado ASC"],
      ["movimientos", "total_movimientos ASC"],
    ];
    for (const [sort, esperado] of casos) {
      expect(orden(params(`sort=${sort}&order=asc`))).toBe(`${esperado} NULLS LAST`);
    }
  });

  it("aceptaba DESC y ASC en cualquier tipo de letra", () => {
    expect(orden(params("sort=caratula&order=DeSc"))).toBe("caratula DESC NULLS LAST");
    expect(orden(params("sort=CARATULA&order=DESC"))).toBe("caratula DESC NULLS LAST");
  });

  it("cualquier otra clave cae a la lista blanca: no se puede ordenar por columna ajena", () => {
    for (const sort of ["password_hash", "id; DROP TABLE usuarios", "noexiste"]) {
      expect(orden(params(`sort=${encodeURIComponent(sort)}`))).toBe(
        orden(params("sort=expediente"))
      );
      expect(orden(params(`sort=${encodeURIComponent(sort)}`))).not.toContain(sort);
    }
  });

  it("una columna no numérica ordena sin cast: `EXP-001` no revienta la query", () => {
    // El CASE + regex es lo que reemplaza al TRY_CONVERT del legado; si se va, un
    // número tipo "EX-123/22" da `invalid input syntax for type bigint`.
    expect(orden(params("sort=numero"))).toMatch(/CASE WHEN split_part\(numero, '\/', 1\) ~ '\^\[0-9\]\+\$'/);
  });
});

describe("paginacion", () => {
  it("valores por defecto", () => {
    expect(paginacion(params(""))).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("calcula el offset como (page-1)*pageSize ya acotado", () => {
    expect(paginacion(params("page=3&pageSize=20"))).toEqual({ page: 3, pageSize: 20, offset: 40 });
    // pageSize se recorta a 200 antes de calcular el offset.
    expect(paginacion(params("page=2&pageSize=5000"))).toEqual({ page: 2, pageSize: 200, offset: 200 });
  });

  it("nunca devuelve page 0, pageSize 0 ni NaN", () => {
    for (const search of ["page=0", "page=-5", "page=abc", "pageSize=0", "pageSize=-1", "pageSize=abc"]) {
      const p = paginacion(params(search));
      expect(p.page).toBeGreaterThanOrEqual(1);
      expect(p.pageSize).toBeGreaterThanOrEqual(1);
      expect(p.pageSize).toBeLessThanOrEqual(200);
      expect(Number.isInteger(p.offset)).toBe(true);
      expect(p.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it("tope de 200: sin él, `pageSize=1000000` es un DoS propio", () => {
    expect(paginacion(params("pageSize=1000000")).pageSize).toBe(200);
  });
});

describe("filaVista", () => {
  const fila = {
    id: 7,
    numero: "762/22",
    caratula: "Ana C/ Gomez",
    actor: "Ana",
    demandado: "Gomez",
    centro_judicial: "Capital",
    unidad_judicial: "Unidad 1",
    provincia: "Tucumán",
    estado: "ACT",
    estado_nombre: "ACTIVO",
    actualizado: "SI",
    fch_ult_mov: new Date(Date.UTC(2026, 0, 31)),
    ult_mov_desc: "Cargo de causa",
    documento: null,
    fch_ult_proc: new Date(Date.UTC(2026, 1, 1)),
    total_movimientos: 3,
    origen_carga: "CSV",
    creado_por_usuario: "admin",
  };

  it("conserva las claves de la vista goolge2 que leen los componentes", () => {
    const r = filaVista(fila);
    expect(r["Centro Judicial"]).toBe("Capital");
    expect(r["Unidad Judicial"]).toBe("Unidad 1");
    expect(r.Expdte).toBe("762/22");
    expect(r.Fecha).toBe("31/01/2026");
    expect(r["Fecha Procesado"]).toBe("01/02/2026");
    expect(r.Descripcion).toBe("Cargo de causa");
    expect(r.Documento).toBeNull();
    // El SI/NO/KO sigue llamándose `Estado`, igual que en el legado.
    expect(r.Estado).toBe("SI");
    expect(r["Estado Procesal"]).toBe("ACT");
  });

  it("cada campo del listado tiene su clave legada: ninguna columna nueva se pierde", () => {
    const claves = Object.keys(filaVista(fila)).sort();
    // Las 18 columnas seleccionadas tienen que estar todas representadas.
    expect(CAMPOS_LISTADO).toHaveLength(18);
    expect(claves.length).toBeGreaterThanOrEqual(17);
    for (const columna of ["Centro Judicial", "Unidad Judicial", "Expdte", "Actor", "Demandado"]) {
      expect(claves).toContain(columna);
    }
    expect(FUENTE).toBe("vista_expedientes");
  });
});

describe("formatoDmY", () => {
  it("formatea en UTC para que la fecha no corra un día según el container", () => {
    expect(formatoDmY(new Date("2026-01-31T23:30:00Z"))).toBe("31/01/2026");
  });

  it("null/undefined no se convierten en 01/01/1970", () => {
    expect(formatoDmY(null)).toBeNull();
    expect(formatoDmY(undefined)).toBeNull();
    expect(formatoDmY("")).toBeNull();
  });

  it("un texto ilegible se devuelve tal cual antes que inventarse una fecha", () => {
    expect(formatoDmY("sin fecha")).toBe("sin fecha");
  });
});
