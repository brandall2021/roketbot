"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";

type Resultado = {
  totalLeidos?: number;
  actualizados?: number;
  errores?: string[];
  error?: string;
};

type Preview = {
  columns: string[];
  rows: Record<string, string>[];
  total: number;
  errors: string[];
  error?: string;
};

const TEMPLATE_HEADER =
  "Expdte,CodEstado,Estado atraves de expdte";

export default function ActualizarExpedientesPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function descargarPlantilla() {
    const blob = new Blob(["\ufeff" + TEMPLATE_HEADER + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_actualizacion_expedientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function seleccionarArchivo(file: File) {
    if (!file) return;
    setLoading(true);
    setResultado(null);
    setPreview(null);
    setSelectedFile(file);
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/expedientes/actualizar/preview", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setPreview({ columns: [], rows: [], total: 0, errors: [], error: body.error });
      } else {
        setPreview(body);
      }
    } catch (e: any) {
      setPreview({ columns: [], rows: [], total: 0, errors: [], error: e.message });
    } finally {
      setLoading(false);
    }
  }

  function cambiarArchivo() {
    setPreview(null);
    setResultado(null);
    setSelectedFile(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function actualizar() {
    const file = selectedFile;
    if (!file) return;

    setUpdating(true);
    setResultado(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/expedientes/actualizar", { method: "POST", body: formData });
      const body = await res.json();
      setResultado(body);
    } catch (e: any) {
      setResultado({ error: e.message });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <AuthGuard>
      <AppShell>
        <div style={{ marginBottom: 16 }}>
          <Link href="/expedientes">← Volver al listado</Link>
        </div>

        <div className="toolbar" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16 }}>Actualizar CSV de expedientes</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            Subí un CSV con estas columnas: <code>Expdte</code>, <code>CodEstado</code> y <code>Estado atraves de expdte</code>.
            La app busca por <code>Expdte</code> y actualiza solo el código y nombre del estado.
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={descargarPlantilla}>
            Descargar plantilla
          </button>
        </div>

        {!preview ? (
          <div
            className={`drop ${dragging ? "over" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) seleccionarArchivo(f);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) seleccionarArchivo(f);
              }}
            />
            <div style={{ fontSize: 15, marginBottom: 6 }}>
              {fileName || "Arrastrá el archivo CSV acá o hacé clic para seleccionar"}
            </div>
            {loading && <div className="muted">Analizando archivo…</div>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span>
              <b>{fileName}</b>{" "}
              <span className="muted">
                ({preview.columns.length} columna{preview.columns.length === 1 ? "" : "s"} · {preview.total} registro
                {preview.total === 1 ? "" : "s"})
              </span>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={cambiarArchivo}>
              Cambiar archivo
            </button>
          </div>
        )}

        {preview?.error && <div className="alert error" style={{ marginTop: 16 }}>{preview.error}</div>}

        {preview && !preview.error && (
          <div className="toolbar" style={{ marginTop: 4 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>Vista previa</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Columnas detectadas:
              {preview.columns.map((c) => (
                <code key={c} style={{ marginLeft: 6, marginRight: 6 }}>
                  {c}
                </code>
              ))}
            </p>

            <p className="muted" style={{ marginBottom: 12 }}>
              Cada fila debe traer <code>Expdte</code>, <code>CodEstado</code> y <code>Estado atraves de expdte</code>.
            </p>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Expdte</th>
                    <th>CodEstado</th>
                    <th>Estado atraves de expdte</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i}>
                      <td>{row.Expdte ?? row.expdte ?? ""}</td>
                      <td>{row.CodEstado ?? row.codEstado ?? ""}</td>
                      <td>{row.Estado ?? row["Estado atraves de expdte"] ?? row.estado ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.errors.length > 0 && (
              <div className="alert error" style={{ marginTop: 16 }}>
                {preview.errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn" onClick={actualizar} disabled={updating || preview.errors.length > 0}>
                {updating ? "Actualizando…" : `Confirmar actualización de ${preview.total} registro${preview.total === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {resultado && !resultado.error && (
          <div className="alert ok" style={{ marginTop: 16 }}>
            Leídos: {resultado.totalLeidos} · Actualizados: {resultado.actualizados}
          </div>
        )}
        {resultado?.error && (
          <div className="alert error" style={{ marginTop: 16 }}>
            {resultado.error}
          </div>
        )}
        {resultado?.errores?.length ? (
          <div className="alert error" style={{ marginTop: 16 }}>
            {resultado.errores.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : null}
      </AppShell>
    </AuthGuard>
  );
}
