"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import KpiCards, { type Kpis } from "@/components/KpiCards";
import DocumentoCell, { docHref } from "@/components/DocumentoCell";
import { api } from "@/lib/client";
import { buildEstadoSummary } from "@/lib/dashboard-data.js";

type Row = Record<string, any>;
type Source = "vista" | "cargados";
type ChartData = {
  estados: { name: string; value: number }[];
  documentos: { name: string; value: number }[];
  porMes: { mes: string; total: number }[];
  estadoResumen?: { activo: number; inactivo: number };
};

const PAGE_SIZE = 20;

const SECONDARY_FILTERS = [
  { key: "centro", label: "Centro Judicial" },
  { key: "unidad", label: "Unidad Judicial" },
  { key: "expdte", label: "Expediente" },
  { key: "actor", label: "Actor" },
  { key: "demandado", label: "Demandado" },
  { key: "descripcion", label: "Descripción" },
];

const DATE_FILTERS = [
  { key: "fechaProcesadoDesde", label: "Fecha procesado desde" },
  { key: "fechaProcesadoHasta", label: "Fecha procesado hasta" },
] as const;

const SORTABLE = [
  { key: "expediente", label: "Expediente" },
  { key: "actor", label: "Actor" },
  { key: "demandado", label: "Demandado" },
  { key: "unidad", label: "Unidad" },
  { key: "fecha", label: "Último movimiento" },
  { key: "fechaprocesado", label: "Fecha procesado" },
  { key: "estado", label: "Estado" },
  { key: "documento", label: "Documento" },
];

function Th({
  sortKey,
  label,
  sort,
  onSort,
}: {
  sortKey: string;
  label: string;
  sort: { key: string; dir: "asc" | "desc" };
  onSort: (k: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button className={`th-sort ${active ? "active" : ""}`} onClick={() => onSort(sortKey)}>
        {label}
        {active && <span className="th-arrow">{sort.dir === "asc" ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );
}

export default function ExpedientesPage() {
  const [source, setSource] = useState<Source>("vista");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Row | null>(null);
  const [movimientos, setMovimientos] = useState<Row[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [charts, setCharts] = useState<ChartData | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "expediente",
    dir: "asc",
  });

  useEffect(() => {
    fetch("/api/expedientes/kpis", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setKpis)
      .catch(() => setKpis(null));
    fetch("/api/expedientes/charts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setCharts)
      .catch(() => setCharts(null));
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const f: Record<string, string> = {};
    for (const k of ["centro", "unidad", "expdte", "actor", "demandado", "descripcion", "estado", "fechaProcesadoDesde", "fechaProcesadoHasta"]) {
      const v = sp.get(k);
      if (v) f[k] = v;
    }
    if (Object.keys(f).length) setFilters(f);
    const qv = sp.get("q");
    if (qv) {
      setSearchTerm(qv);
      setQ(qv);
    }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    if (q) params.set("q", q);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (source === "cargados") params.set("origen", "");
    if (source === "vista") {
      params.set("sort", sort.key);
      params.set("order", sort.dir);
    }
    const url = source === "vista" ? "/api/expedientes" : "/api/expedientes/cargados";
    const { data, error } = await api<{ total: number; rows: Row[] }>(`${url}?${params}`);
    setLoading(false);
    if (error || !data) {
      setError(error || "Error al cargar");
      return;
    }
    setRows(data.rows);
    setTotal(data.total);
  }, [source, filters, q, page, sort]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  async function verDetalle(row: Row) {
    const centro = row["Centro Judicial"] || "";
    const unidad = row["Unidad Judicial"] || "";
    const params = new URLSearchParams();
    if (centro) params.set("centro", centro);
    if (unidad) params.set("unidad", unidad);
    const { data, error } = await api<{ expediente: Row; movimientos: Row[] }>(
      `/api/expedientes/${encodeURIComponent(row["Expdte"])}?${params}`
    );
    if (error || !data) {
      setError(error || "No se pudo cargar el detalle");
      return;
    }
    setDetalle(data.expediente);
    setMovimientos(data.movimientos ?? []);
  }

  function aplicarFiltro(k: string, v: string) {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setQ(searchTerm.trim());
    setPage(1);
  }

  function limpiar() {
    setFilters({});
    setSearchTerm("");
    setQ("");
    setPage(1);
    setSort({ key: "expediente", dir: "asc" });
  }

  function ordenar(key: string) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
    setPage(1);
  }

  function exportUrl(formato: "csv" | "pdf") {
    const params = new URLSearchParams();
    params.set("formato", formato);
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    if (q) params.set("q", q);
    params.set("sort", sort.key);
    params.set("order", sort.dir);
    return `/api/expedientes/export?${params.toString()}`;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const estadoField = (
    <div className="field">
      <label>Estado</label>
      <input
        value={filters["estado"] || ""}
        onChange={(e) => aplicarFiltro("estado", e.target.value)}
        placeholder="Buscar estado…"
      />
    </div>
  );

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs" style={{ marginBottom: 0, flex: 1 }}>
            <button
              className={`tab ${source === "vista" ? "active" : ""}`}
              onClick={() => {
                setSource("vista");
                setPage(1);
              }}
            >
              {/* era "Base (goolge2)", la vista de SQL Server que ya no existe */}
              Padrón de expedientes
            </button>
            <button
              className={`tab ${source === "cargados" ? "active" : ""}`}
              onClick={() => {
                setSource("cargados");
                setPage(1);
              }}
            >
              Registros cargados
            </button>
          </div>
          <Link href="/expedientes/importar" className="btn btn-ghost btn-sm">
            Importar CSV
          </Link>
          <Link href="/expedientes/actualizar" className="btn btn-ghost btn-sm">
            Actualizar CSV
          </Link>
          {source === "vista" && (
            <>
              <a href={exportUrl("csv")} className="btn btn-ghost btn-sm" download>
                Exportar CSV
              </a>
              <a href={exportUrl("pdf")} className="btn btn-ghost btn-sm" download>
                Exportar PDF
              </a>
            </>
          )}
        </div>

        {source === "vista" && kpis && <KpiCards kpis={kpis} />}

        {source === "vista" && charts && (
          <div className="kpi-grid" style={{ marginTop: 12 }}>
            {(() => {
              const { activo, inactivo } = charts.estadoResumen ?? buildEstadoSummary(charts.estados);
              return (
                <>
                  <button
                    type="button"
                    className="kpi"
                    onClick={() => {
                      setSource("vista");
                      setFilters((f) => ({ ...f, estado: "ACTIVO" }));
                      setPage(1);
                    }}
                    style={{ textAlign: "left", border: 0, cursor: "pointer" }}
                  >
                    <div className="num ok-num">{activo.toLocaleString()}</div>
                    <div className="label">Estado activo</div>
                  </button>
                  <button
                    type="button"
                    className="kpi"
                    onClick={() => {
                      setSource("vista");
                      setFilters((f) => ({ ...f, estado: "INACTIVO" }));
                      setPage(1);
                    }}
                    style={{ textAlign: "left", border: 0, cursor: "pointer" }}
                  >
                    <div className="num warn-num">{inactivo.toLocaleString()}</div>
                    <div className="label">Estado inactivo</div>
                  </button>
                </>
              );
            })()}
          </div>
        )}

        <form className="search-bar" onSubmit={buscar}>
          <input
            className="search-big"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por expediente, actor, demandado o documento…"
          />
          <button className="btn" type="submit" disabled={loading}>
            Buscar
          </button>
          <button
            type="button"
            className={`btn btn-ghost ${showFilters ? "active" : ""}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filtros
          </button>
          <button type="button" className="btn btn-ghost" onClick={limpiar}>
            Limpiar
          </button>
          <span className="meta">{total.toLocaleString()} registros</span>
        </form>

        {showFilters && (
          <div className="toolbar">
            <div className="form-grid">
              {SECONDARY_FILTERS.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    value={filters[f.key] || ""}
                    onChange={(e) => aplicarFiltro(f.key, e.target.value)}
                    placeholder={`Filtrar por ${f.label.toLowerCase()}…`}
                  />
                </div>
              ))}
              {DATE_FILTERS.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input
                    type="date"
                    value={filters[f.key] || ""}
                    onChange={(e) => aplicarFiltro(f.key, e.target.value)}
                  />
                </div>
              ))}
              {estadoField}
              </div>
            </div>
        )}

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && rows.length === 0 && <div className="empty">Sin resultados</div>}

        {rows.length > 0 && (
          <>
              <div className="table-wrap">
                <table className="table-desktop">
                <thead>
                  <tr>
                      {source === "vista" ? (
                        SORTABLE.map((s) => (
                          <Th key={s.key} sortKey={s.key} label={s.label} sort={sort} onSort={ordenar} />
                        ))
                      ) : (
                      <>
                        <th>Expediente</th>
                        <th>Actor</th>
                        <th>Demandado</th>
                        <th>Unidad</th>
                        <th>Último movimiento</th>
                        <th>Fecha procesado</th>
                        <th>Estado</th>
                        <th>Documento</th>
                      </>
                    )}
                    {source === "cargados" && <th>Origen</th>}
                    {source === "vista" && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="mono">
                        {/* El drawer muestra los últimos movimientos; la ficha es la
                            vista completa (historial + consultas al PJud), server-rendered. */}
                        {row["Id"] ? (
                          <Link href={`/expedientes/${row["Id"]}`}>
                            {row["Expdte"] ?? ""}
                          </Link>
                        ) : (
                          String(row["Expdte"] ?? "")
                        )}
                      </td>
                      <td>{row["Actor"] ?? ""}</td>
                      <td>{row["Demandado"] ?? ""}</td>
                      <td>
                        {row["Unidad Judicial"] ?? ""}
                        {row["Centro Judicial"] && (
                          <div className="subtext">{row["Centro Judicial"]}</div>
                        )}
                      </td>
                      <td>{row["Fecha"] ?? ""}</td>
                      <td>{row["Fecha Procesado"] ?? ""}</td>
                      <td>
                        {row["Estado"] ?? "—"}
                      </td>
                      <td>
                        <DocumentoCell doc={row["Documento"]} />
                      </td>
                      {source === "cargados" && (
                        <td>
                          <span className={`badge ${row["Origen"] === "MANUAL" ? "" : "ok"}`}>
                            {row["Origen"]}
                          </span>
                        </td>
                      )}
                      {source === "vista" && (
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => verDetalle(row)}>
                            Ver
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="card-list">
                {rows.map((row, i) => (
                  <div className="card" key={i}>
                    <div className="card-head">
                      <span className="mono" style={{ fontWeight: 600 }}>{row["Expdte"] ?? ""}</span>
                      <span className="badge soft">{row["Estado"] || "—"}</span>
                    </div>
                    <div className="card-row">
                      <span>Actor</span>
                      <span>{row["Actor"] || "—"}</span>
                    </div>
                    <div className="card-row">
                      <span>Demandado</span>
                      <span>{row["Demandado"] || "—"}</span>
                    </div>
                    <div className="card-row">
                      <span>Unidad</span>
                      <span>
                        {row["Unidad Judicial"] || "—"}
                        {row["Centro Judicial"] && <div className="subtext">{row["Centro Judicial"]}</div>}
                      </span>
                    </div>
                    <div className="card-row">
                      <span>Último movimiento</span>
                      <span>{row["Fecha"] || "—"}</span>
                    </div>
                    {source === "cargados" && (
                      <div className="card-row">
                        <span>Origen</span>
                        <span>{row["Origen"] || "—"}</span>
                      </div>
                    )}
                    <div className="card-actions">
                      <DocumentoCell doc={row["Documento"]} />
                      {source === "vista" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => verDetalle(row)}>
                          Ver
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Anterior
              </button>
              <span>
                Página {page} de {totalPages}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente →
              </button>
            </div>
          </>
        )}

        {detalle && (
          <div className="drawer-overlay" onClick={() => setDetalle(null)}>
            <aside className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Expediente</div>
                  <h3 style={{ fontSize: 18 }}>{detalle["Expdte"]}</h3>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetalle(null)}>
                  ✕
                </button>
              </div>
              <div className="drawer-body">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                  {[
                    ["Centro Judicial", detalle["Centro Judicial"] || "—"],
                    ["Unidad Judicial", detalle["Unidad Judicial"] || "—"],
                    ["Actor", detalle["Actor"] || "—"],
                    ["Demandado", detalle["Demandado"] || "—"],
                    ["Estado", detalle["Estado"] || "—"],
                    ["Último movimiento", detalle["Fecha"] || "—"],
                    ["Fecha procesado", detalle["Fecha Procesado"] || "—"],
                    [
                      "Documento",
                      detalle["Documento"] ? (
                        <a href={docHref(detalle["Documento"])} target="_blank" rel="noreferrer">
                          Abrir documento
                        </a>
                      ) : (
                        <span className="badge soft">Sin documento</span>
                      ),
                    ],
                    ["Descripción", detalle["Descripcion"] || "—"],
                    [
                      "Historia",
                      movimientos.length > 0 ? (
                        <div className="xml-pre">
                          {movimientos.map((m, i) => (
                            <div key={m.id ?? i} style={{ marginBottom: 8 }}>
                              <b>{m.fecha || "—"}</b>
                              {m.descripcion ? ` — ${m.descripcion}` : ""}
                              {m.texto ? <div>{m.texto}</div> : null}
                              {m.link ? (
                                <a href={docHref(String(m.link))} target="_blank" rel="noreferrer">
                                  Ver documento
                                </a>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">Sin historia</span>
                      ),
                    ],
                  ].map(([label, value]) => (
                    <div className="field" key={String(label)}>
                      <label>{label}</label>
                      <div>{value as any}</div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
