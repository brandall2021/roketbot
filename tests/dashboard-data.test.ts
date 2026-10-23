import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * `lib/dashboard-data.js` queda en CommonJS (lo consumen tanto la app de Next como
 * scripts sueltos), así que se carga con `createRequire` en vez de un `import`, que
 * es lo que rompe con `module.exports`.
 */
const require = createRequire(import.meta.url);

type Punto = { name: string; value: number; color: string };

const { buildEstadoChartData, buildEstadoSummary } = require("../lib/dashboard-data.js") as {
  buildEstadoChartData: (rows: { name: string; value: number | string }[]) => Punto[];
  buildEstadoSummary: (rows: { name: string; value: number | string }[]) => { activo: number; inactivo: number };
};

describe("buildEstadoChartData", () => {
  it("normaliza los estados conocidos y deja los demás tal cual", () => {
    const data = buildEstadoChartData([
      { name: "ACTIVO", value: 4 },
      { name: "PENDIENTE", value: 2 },
      { name: "", value: 1 },
    ]);
    expect(data.map((d) => d.name)).toEqual(["Activo", "PENDIENTE", "Sin estado"]);
    expect(data.map((d) => d.value)).toEqual([4, 2, 1]);
  });

  it("los estados SI/NO del legado (ExpdteActualizado) caen en Activo/Inactivo", () => {
    expect(buildEstadoChartData([{ name: "SI", value: 1 }])[0].name).toBe("Activo");
    expect(buildEstadoChartData([{ name: "NO", value: 1 }])[0].name).toBe("Inactivo");
    expect(buildEstadoChartData([{ name: "1", value: 1 }])[0].name).toBe("Activo");
    expect(buildEstadoChartData([{ name: "false", value: 1 }])[0].name).toBe("Inactivo");
  });

  it("colorea con la paleta cíclica, como espera DashboardCharts", () => {
    const data = buildEstadoChartData([
      { name: "a", value: 1 },
      { name: "b", value: 1 },
      { name: "c", value: 1 },
      { name: "d", value: 1 },
      { name: "e", value: 1 },
      { name: "f", value: 1 },
      { name: "g", value: 1 },
    ]);
    expect(data[0].color).toBe("#3b82f6");
    expect(data[1].color).toBe("#22c55e");
    expect(data[6].color).toBe(data[0].color);
  });

  it("acepta los conteos que llegan de Postgres como string", () => {
    // `COUNT(*)` es BIGINT y pg lo manda texto: sin Number() el gráfico muestra NaN.
    const data = buildEstadoChartData([{ name: "Activo", value: "17" }]);
    expect(data[0].value).toBe(17);
    expect(data[0].value).toBeTypeOf("number");
  });

  it("una fila sin valor es 0, no undefined", () => {
    expect(buildEstadoChartData([{ name: "Activo", value: undefined as unknown as number }])[0].value).toBe(0);
  });
});

describe("buildEstadoSummary", () => {
  it("mapea activo e inactivo", () => {
    expect(
      buildEstadoSummary([
        { name: "ACTIVO", value: 7 },
        { name: "INACTIVO", value: 3 },
      ])
    ).toEqual({ activo: 7, inactivo: 3 });
  });

  it("si falta alguno, devuelve 0 (la KPI no puede quedar en undefined)", () => {
    expect(buildEstadoSummary([{ name: "ACTIVO", value: 2 }])).toEqual({ activo: 2, inactivo: 0 });
    expect(buildEstadoSummary([])).toEqual({ activo: 0, inactivo: 0 });
  });

  it("toma el primer punto de cada estado normalizado (no suma duplicados)", () => {
    // Comportamiento real del módulo, que se conserva: `find` devuelve la primera
    // fila "Activo". Por eso la KPI de expedientes se calcula en SQL
    // (`COUNT(*) FILTER`) y no con esta función.
    expect(
      buildEstadoSummary([
        { name: "SI", value: 1 },
        { name: "Activo", value: 2 },
        { name: "KO", value: 4 },
      ])
    ).toEqual({ activo: 1, inactivo: 0 });
  });

  it("`KO` no es un estado conocido: queda afuera del resumen", () => {
    expect(buildEstadoSummary([{ name: "KO", value: 4 }])).toEqual({ activo: 0, inactivo: 0 });
  });
});
