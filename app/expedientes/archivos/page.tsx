"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { api } from "@/lib/client";

type Carga = {
  id: number;
  archivo: string;
  tamano: number | null;
  filas_leidas: number;
  insertados: number;
  duplicados: number;
  errores: number;
  detalle_errores: string | null;
  origen: string;
  creado_en: string;
  usuario: string | null;
};

const PAGE_SIZE = 20;

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtFecha(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ArchivosPage() {
  const [q, setQ] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [rows, setRows] = useState<Carga[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Carga | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    const { data, error } = await api<{ total: number; rows: Carga[] }>(
      `/api/expedientes/cargas?${params}`
    );
    setLoading(false);
    if (error || !data) {
      setError(error || "Error al cargar");
      return;
    }
    setRows(data.rows);
    setTotal(data.total);
  }, [q, desde, hasta, page]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQ(searchTerm);
  }

  function limpiar() {
    setSearchTerm("");
    setQ("");
    setDesde("");
    setHasta("");
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ marginBottom: 16 }}>
          <Link href="/expedientes">← Volver al listado</Link>
        </div>

        <div className="toolbar" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16 }}>Archivos subidos</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            Registro de cada archivo CSV importado: quién lo subió, cuándo y el resultado de la carga
            (leídos, insertados, duplicados y errores).
          </p>
        </div>

        <form className="search-bar" onSubmit={buscar}>
          <input
            className="search-big"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre de archivo o usuario…"
          />
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button className="btn" type="submit" disabled={loading}>
            Buscar
          </button>
          <button type="button" className="btn btn-ghost" onClick={limpiar}>
            Limpiar
          </button>
          <span className="meta">{total.toLocaleString()} cargas</span>
        </form>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && rows.length === 0 && <div className="empty">Sin resultados</div>}

        {rows.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table-desktop">
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Tamaño</th>
                    <th>Usuario</th>
                    <th>Fecha</th>
                    <th>Leídos</th>
                    <th>Insertados</th>
                    <th>Duplicados</th>
                    <th>Errores</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.archivo}</td>
                      <td>{fmtBytes(row.tamano)}</td>
                      <td>{row.usuario || "—"}</td>
                      <td>{fmtFecha(row.creado_en)}</td>
                      <td className="mono">{row.filas_leidas}</td>
                      <td className="mono">{row.insertados}</td>
                      <td className="mono">{row.duplicados}</td>
                      <td className="mono">
                        {row.errores > 0 ? (
                          <span className="badge warn">{row.errores}</span>
                        ) : (
                          <span className="badge ok">0</span>
                        )}
                      </td>
                      <td>
                        {row.detalle_errores ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => setDetalle(row)}>
                            Ver errores
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>Sin errores</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pager">
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
                  <div className="muted" style={{ fontSize: 12 }}>Carga #{detalle.id}</div>
                  <h3 style={{ fontSize: 18 }}>{detalle.archivo}</h3>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setDetalle(null)}>
                  ✕
                </button>
              </div>
              <div className="drawer-body">
                <dl className="dl">
                  <dt>Usuario</dt>
                  <dd>{detalle.usuario || "—"}</dd>
                  <dt>Fecha</dt>
                  <dd>{fmtFecha(detalle.creado_en)}</dd>
                  <dt>Tamaño</dt>
                  <dd>{fmtBytes(detalle.tamano)}</dd>
                  <dt>Filas leídas</dt>
                  <dd>{detalle.filas_leidas}</dd>
                  <dt>Insertados</dt>
                  <dd>{detalle.insertados}</dd>
                  <dt>Duplicados</dt>
                  <dd>{detalle.duplicados}</dd>
                  <dt>Errores</dt>
                  <dd>{detalle.errores}</dd>
                </dl>
                {detalle.detalle_errores && (
                  <div className="field" style={{ marginTop: 16 }}>
                    <label>Detalle de errores</label>
                    <pre className="xml-pre">{detalle.detalle_errores}</pre>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
