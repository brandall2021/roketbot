"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { api } from "@/lib/client";

type Usuario = {
  id: number;
  username: string;
  nombre: string;
  rol: string;
  created_at: string;
};

const ROLES = ["ADMIN", "USER"];

const emptyForm = { username: "", nombre: "", rol: "USER", password: "" };

export default function UsuariosPage() {
  const [users, setUsers] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"nuevo" | null | number>(null); // number = editando id
  const [form, setForm] = useState(emptyForm);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await api<{ users: Usuario[] }>("/api/usuarios");
    setLoading(false);
    if (error || !data) {
      setError(error || "Error al cargar usuarios");
      return;
    }
    setUsers(data.users);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function abrirNuevo() {
    setForm(emptyForm);
    setModal("nuevo");
  }

  function abrirEditar(u: Usuario) {
    setForm({ username: u.username, nombre: u.nombre, rol: u.rol, password: "" });
    setModal(u.id);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (modal === "nuevo") {
      const { data, error } = await api("/api/usuarios", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (error || !data) {
        setError(error || "Error al crear usuario");
        return;
      }
    } else if (typeof modal === "number") {
      const { data, error } = await api(`/api/usuarios/${modal}`, {
        method: "PUT",
        body: JSON.stringify({
          nombre: form.nombre,
          rol: form.rol,
          password: form.password || undefined,
        }),
      });
      if (error || !data) {
        setError(error || "Error al actualizar usuario");
        return;
      }
    }

    setModal(null);
    fetchUsers();
  }

  async function eliminar(u: Usuario) {
    if (!confirm(`¿Eliminar el usuario "${u.username}"?`)) return;
    setError(null);
    const { data, error } = await api(`/api/usuarios/${u.id}`, { method: "DELETE" });
    if (error || !data) {
      setError(error || "Error al eliminar");
      return;
    }
    fetchUsers();
  }

  return (
    <AdminGuard>
      <AppShell>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>Usuarios</h2>
          <button className="btn btn-sm" onClick={abrirNuevo}>
            + Nuevo usuario
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="muted" style={{ padding: 12 }}>Cargando…</div>}

        {!loading && users.length === 0 && <div className="empty">Sin usuarios</div>}

        {users.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Creado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td>
                    <td>{u.nombre}</td>
                    <td>
                      <span className={`badge ${u.rol === "ADMIN" ? "warn" : ""}`}>{u.rol}</span>
                    </td>
                    <td className="muted">{new Date(u.created_at).toLocaleDateString("es-AR")}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => abrirEditar(u)}>
                          Editar
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => eliminar(u)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {modal !== null && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              zIndex: 50,
            }}
            onClick={() => setModal(null)}
          >
            <form
              className="toolbar"
              style={{ maxWidth: 460, width: "100%", marginBottom: 0 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={guardar}
            >
              <h3 style={{ fontSize: 16, marginBottom: 14 }}>
                {modal === "nuevo" ? "Nuevo usuario" : `Editar usuario (${form.username})`}
              </h3>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
                {modal === "nuevo" && (
                  <div className="field">
                    <label>Usuario *</label>
                    <input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      required
                      maxLength={80}
                    />
                  </div>
                )}
                <div className="field">
                  <label>Nombre *</label>
                  <input
                    value={form.nombre}
                    onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    required
                    maxLength={120}
                  />
                </div>
                <div className="field">
                  <label>Rol *</label>
                  <select
                    value={form.rol}
                    onChange={(e) => setForm({ ...form, rol: e.target.value })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{modal === "nuevo" ? "Contraseña *" : "Contraseña (vacía = no cambiar)"}</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={modal === "nuevo"}
                    minLength={6}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button type="submit" className="btn">
                  Guardar
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}
      </AppShell>
    </AdminGuard>
  );
}
