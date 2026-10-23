const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];

function normalizeEstado(value) {
  const v = String(value || "").trim().toUpperCase();
  if (!v) return "Sin estado";
  if (["ACTIVO", "ACTIVE", "SI", "1", "TRUE"].includes(v)) return "Activo";
  if (["INACTIVO", "INACTIVE", "NO", "0", "FALSE"].includes(v)) return "Inactivo";
  return String(value).trim();
}

function buildEstadoChartData(rows) {
  return rows.map((row, index) => ({
    name: normalizeEstado(row.name),
    value: Number(row.value || 0),
    color: PALETTE[index % PALETTE.length],
  }));
}

function buildEstadoSummary(rows) {
  const data = buildEstadoChartData(rows);
  const activo = data.find((item) => item.name === "Activo")?.value || 0;
  const inactivo = data.find((item) => item.name === "Inactivo")?.value || 0;
  return { activo, inactivo };
}

module.exports = { buildEstadoChartData, buildEstadoSummary };
