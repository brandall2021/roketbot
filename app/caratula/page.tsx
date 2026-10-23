"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { api } from "@/lib/client";

type Row = Record<string, any>;

const PAGE_SIZE = 25;

const EDITABLE_FIELDS = [
  "ExpdteCenJudId",
  "ExpdteUnidadJud",
  "ExpdteProvinciaNombre",
  "ExpdteNro",
  "ExpdteCaratula",
  "ExpdteActor",
  "ExpdteDemandado",
  "ExpdteFchUltMov",
  "ExpdteFchUltProc",
  "ExpdteUltMovDescripcion",
  "ExpdteLegajo",
  "ExpdteActualizado",
] as const;

const emptyForm = Object.fromEntries(EDITABLE_FIELDS.map((k) => [k, ""])) as Record<string, string>;

export default function CaratulaPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ rol: string } | null>(null);
  const [modal, setModal] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const isAdmin = me?.rol === "ADMIN";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    const { data, error } = await api<{ total: number; rows: Row[] }>(`/api/caratula?${params}`);
    setLoading(false);
    if (error || !data) return setError(error || "Error al cargar registros");
    setTotal(data.total);
    setRows(data.rows);
  }, [page, q]);

  useEffect(() => {
    fetchData();
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, [fetchData]);

  async function abrirEditar(id: number) {
    const { data, error } = await api<Row>(`/api/caratula/${id}`);
    if (error || !data) return setError(error || "No se pudo cargar el registro");
    setForm({
      ExpdteCenJudId: data.ExpdteCenJudId ?? "",
      ExpdteUnidadJud: data.ExpdteUnidadJud ?? "",
      ExpdteProvinciaNombre: data.ExpdteProvinciaNombre ?? "",
      ExpdteNro: data.ExpdteNro ?? "",
      ExpdteCaratula: data.ExpdteCaratula ?? "",
      ExpdteActor: data.ExpdteActor ?? "",
      ExpdteDemandado: data.ExpdteDemandado ?? "",
      ExpdteFchUltMov: data.ExpdteFchUltMov ?? "",
      ExpdteFchUltProc: data.ExpdteFchUltProc ?? "",
      ExpdteUltMovDescripcion: data.ExpdteUltMovDescripcion ?? "",
      ExpdteLegajo: data.ExpdteLegajo ?? "",
      ExpdteActualizado: data.ExpdteActualizado ?? "",
    });
    setModal(id);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (modal === null) return;
    setError(null);
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim()])
    );
    const { data, error } = await api(`/api/caratula/${modal}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (error || !data) return setError(error || "Error al actualizar");
    setModal(null);
    fetchData();
  }

  async function eliminar(id: number) {
    if (!confirm(`¿Eliminar el registro ${id}?`)) return;
    const { data, error } = await api(`/api/caratula/${id}`, { method: "DELETE" });
    if (error || !data) return setError(error || "Error al eliminar");
    fetchData();
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQ(searchTerm.trim());
  }

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 18 }}>ExpdtesCaratula</h2>
          <span className="badge soft">Solo lectura por defecto</span>
        </div>

        <form className="search-bar" onSubmit={buscar} style={{ marginBottom: 16 }}>
          <input
            className="search-big"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por ID, expediente, carátula, actor o demandado…"
          />
          <button className="btn" type="submit" disabled={loading}>
            Buscar
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearchTerm("");
              setQ("");
              setPage(1);
            }}
          >
            Limpiar
          </button>
          <span className="meta">{total.toLocaleString()} registros</span>
        </form>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && rows.length === 0 && <div className="empty">Sin resultados</div>}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table-desktop">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Expediente</th>
                  <th>Carátula</th>
                  <th>Actor</th>
                  <th>Demandado</th>
                  <th>Estado</th>
                  <th>Centro</th>
                  <th>Unidad</th>
                  <th>Provincia</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ExpdteId}>
                    <td className="mono">{row.ExpdteId}</td>
                    <td className="mono">{row.ExpdteNro ?? ""}</td>
                    <td>{row.ExpdteCaratula ?? ""}</td>
                    <td>{row.ExpdteActor ?? ""}</td>
                    <td>{row.ExpdteDemandado ?? ""}</td>
                    <td>{row.ExpdteActualizado ?? ""}</td>
                    <td>{row.CentroJudNombre ?? row.ExpdteCenJudId ?? ""}</td>
                    <td>{row.ExpdteUnidadJud ?? ""}</td>
                    <td>{row.ExpdteProvinciaNombre ?? ""}</td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => abrirEditar(row.ExpdteId)}>Editar</button>
                          <button className="btn btn-danger btn-sm" onClick={() => eliminar(row.ExpdteId)}>Eliminar</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Anterior
          </button>
          <span>
            Página {page} de {totalPages}
          </span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Siguiente →
          </button>
        </div>

        {modal !== null && (
          <div className="drawer-overlay" onClick={() => setModal(null)}>
            <aside className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>ExpdteId</div>
                  <h3 style={{ fontSize: 18 }}>{modal}</h3>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>✕</button>
              </div>
              <form className="drawer-body" onSubmit={guardar}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                  {EDITABLE_FIELDS.map((field) => (
                    <div className="field" key={field} style={{ marginBottom: 0 }}>
                      <label>{field}</label>
                      {field === "ExpdteLegajo" ? (
                        <textarea
                          rows={5}
                          value={form[field]}
                          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                        />
                      ) : (
                        <input
                          value={form[field]}
                          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button type="submit" className="btn">Guardar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
                </div>
              </form>
            </aside>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
