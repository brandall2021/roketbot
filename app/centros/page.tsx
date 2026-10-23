"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import AdminGuard from "@/components/AdminGuard";
import { api } from "@/lib/client";

type Centro = {
  CentroJudId: number;
  nombre: string | null;
  provinciaId: string | null;
  provinciaNombre: string | null;
  unidad: string | null;
  sitioWeb: string | null;
  equivEndpoint: string | null;
};

type Provincia = { id: string; nombre: string };

const emptyForm = { nombre: "", provinciaId: "", unidad: "", sitioWeb: "", equivEndpoint: "" };

export default function CentrosPage() {
  const [centros, setCentros] = useState<Centro[]>([]);
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [me, setMe] = useState<{ rol: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"nuevo" | null | number>(null);
  const [form, setForm] = useState(emptyForm);
  const isAdmin = me?.rol === "ADMIN";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [c, p] = await Promise.all([
      api<{ centros: Centro[] }>("/api/centros"),
      api<{ provincias: Provincia[] }>("/api/provincias"),
    ]);
    setLoading(false);
    if (c.error || !c.data) return setError(c.error || "Error al cargar centros");
    if (p.error || !p.data) return setError(p.error || "Error al cargar provincias");
    setCentros(c.data.centros);
    setProvincias(p.data.provincias);
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, [fetchData]);

  function abrirNuevo() {
    setForm(emptyForm);
    setModal("nuevo");
  }

  function abrirEditar(c: Centro) {
    setForm({
      nombre: c.nombre ?? "",
      provinciaId: c.provinciaId ?? "",
      unidad: c.unidad ?? "",
      sitioWeb: c.sitioWeb ?? "",
      equivEndpoint: c.equivEndpoint ?? "",
    });
    setModal(c.CentroJudId);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      nombre: form.nombre,
      provinciaId: form.provinciaId || undefined,
      unidad: form.unidad || undefined,
      sitioWeb: form.sitioWeb || undefined,
      equivEndpoint: form.equivEndpoint || undefined,
    };
    if (modal === "nuevo") {
      const { data, error } = await api("/api/centros", { method: "POST", body: JSON.stringify(body) });
      if (error || !data) return setError(error || "Error al crear centro");
    } else if (typeof modal === "number") {
      const { data, error } = await api(`/api/centros/${modal}`, { method: "PUT", body: JSON.stringify(body) });
      if (error || !data) return setError(error || "Error al actualizar centro");
    }
    setModal(null);
    fetchData();
  }

  async function eliminar(c: Centro) {
    if (!confirm(`¿Eliminar el centro "${c.nombre}" (id ${c.CentroJudId})?`)) return;
    setError(null);
    const { data, error } = await api(`/api/centros/${c.CentroJudId}`, { method: "DELETE" });
    if (error || !data) return setError(error || "Error al eliminar");
    fetchData();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Centros Judiciales</h2>
          <button className="btn btn-sm" onClick={abrirNuevo}>
            + Nuevo centro
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && centros.length === 0 && <div className="empty">Sin centros</div>}

        {centros.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre</th>
                  <th>Provincia</th>
                  <th>Unidad</th>
                  <th>Sitio web</th>
                  <th>Endpoint</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {centros.map((c) => (
                  <tr key={c.CentroJudId}>
                    <td className="mono">{c.CentroJudId}</td>
                    <td>{c.nombre}</td>
                    <td>{c.provinciaNombre}</td>
                    <td>{c.unidad}</td>
                    <td className="muted">{c.sitioWeb}</td>
                    <td className="mono">{c.equivEndpoint}</td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => abrirEditar(c)}>Editar</button>
                          <button className="btn btn-danger btn-sm" onClick={() => eliminar(c)}>Eliminar</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {modal !== null && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}
            onClick={() => setModal(null)}
          >
            <form
              className="toolbar"
              style={{ maxWidth: 500, width: "100%", marginBottom: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={guardar}
            >
              <h3 style={{ fontSize: 16, marginBottom: 14 }}>
                {modal === "nuevo" ? "Nuevo centro judicial" : `Editar centro (id ${modal})`}
              </h3>
              <div className="form-grid">
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Nombre *</label>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required maxLength={40} />
                </div>
                <div className="field">
                  <label>Provincia</label>
                  <select value={form.provinciaId} onChange={(e) => setForm({ ...form, provinciaId: e.target.value })}>
                    <option value="">— Sin provincia —</option>
                    {provincias.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Unidad</label>
                  <input value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} maxLength={40} />
                </div>
                <div className="field">
                  <label>Sitio web</label>
                  <input value={form.sitioWeb} onChange={(e) => setForm({ ...form, sitioWeb: e.target.value })} maxLength={80} />
                </div>
                <div className="field">
                  <label>Endpoint (4)</label>
                  <input value={form.equivEndpoint} onChange={(e) => setForm({ ...form, equivEndpoint: e.target.value })} maxLength={4} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="submit" className="btn">Guardar</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
