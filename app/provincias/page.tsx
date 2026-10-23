"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { api } from "@/lib/client";

type Provincia = { id: string; nombre: string };

export default function ProvinciasPage() {
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [me, setMe] = useState<{ rol: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"nuevo" | null | string>(null);
  const [nombre, setNombre] = useState("");
  const isAdmin = me?.rol === "ADMIN";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await api<{ provincias: Provincia[] }>("/api/provincias");
    setLoading(false);
    if (error || !data) return setError(error || "Error al cargar provincias");
    setProvincias(data.provincias);
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, [fetchData]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Ingresá un nombre");
    if (modal === "nuevo") {
      const { data, error } = await api("/api/provincias", { method: "POST", body: JSON.stringify({ nombre }) });
      if (error || !data) return setError(error || "Error al crear provincia");
    } else if (typeof modal === "string") {
      const { data, error } = await api(`/api/provincias/${modal}`, { method: "PUT", body: JSON.stringify({ nombre }) });
      if (error || !data) return setError(error || "Error al actualizar provincia");
    }
    setModal(null);
    setNombre("");
    fetchData();
  }

  async function eliminar(p: Provincia) {
    if (!confirm(`¿Eliminar la provincia "${p.nombre}"?`)) return;
    setError(null);
    const { data, error } = await api(`/api/provincias/${p.id}`, { method: "DELETE" });
    if (error || !data) return setError(error || "Error al eliminar");
    fetchData();
  }

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Provincias</h2>
          <button className="btn btn-sm" onClick={() => { setNombre(""); setModal("nuevo"); }}>
            + Nueva provincia
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && provincias.length === 0 && <div className="empty">Sin provincias</div>}

        {provincias.length > 0 && (
          <div className="table-wrap" style={{ maxWidth: 700 }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {provincias.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id.trim()}</td>
                    <td>{p.nombre}</td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setNombre(p.nombre); setModal(p.id); }}>Editar</button>
                          <button className="btn btn-danger btn-sm" onClick={() => eliminar(p)}>Eliminar</button>
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
              style={{ maxWidth: 420, width: "100%", marginBottom: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={guardar}
            >
              <h3 style={{ fontSize: 16, marginBottom: 14 }}>
                {modal === "nuevo" ? "Nueva provincia" : `Editar provincia (${modal})`}
              </h3>
              <div className="field">
                <label>Nombre *</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={40} autoFocus />
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
