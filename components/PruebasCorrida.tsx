"use client";

import { useState } from "react";
import RunExpedienteButton from "@/components/RunExpedienteButton";

type EstadoWorker = {
  workerActivo: boolean;
  ultimoPulso: string | null;
  edadSegundos: number | null;
};

export default function PruebasCorrida() {
  const [id, setId] = useState("");
  const [worker, setWorker] = useState<EstadoWorker | null>(null);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState("");

  async function probarWorker() {
    setProbando(true);
    setWorker(null);
    setError("");
    try {
      const response = await fetch("/api/corridas/programacion/test", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo comprobar el worker");
      setWorker(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setProbando(false);
    }
  }

  const expedienteId = Number(id);
  const idValido = Number.isSafeInteger(expedienteId) && expedienteId > 0;

  return (
    <section className="card" style={{ maxWidth: 760, padding: 20, marginTop: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 8 }}>Pruebas</h3>

      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 18, marginBottom: 18 }}>
        <b>Test técnico (sin consulta al Poder Judicial)</b>
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          Comprueba la conexión a PostgreSQL y si el worker está enviando señales recientes.
          No consume CAPTCHA ni modifica expedientes.
        </p>
        <button className="btn btn-ghost" type="button" onClick={probarWorker} disabled={probando}>
          {probando ? "Comprobando…" : "Probar worker"}
        </button>
        {worker && (
          <span role="status" style={{ marginLeft: 12, color: worker.workerActivo ? "var(--ok)" : "var(--warn)" }}>
            {worker.workerActivo
              ? `Worker activo · último pulso hace ${worker.edadSegundos}s`
              : `Base conectada, pero no hay pulso reciente${worker.ultimoPulso ? ` (último hace ${worker.edadSegundos}s)` : ""}`}
          </span>
        )}
        {error && <span role="alert" className="danger-num" style={{ marginLeft: 12 }}>{error}</span>}
      </div>

      <b>Consulta real de prueba</b>
      <p className="muted" style={{ margin: "6px 0 12px" }}>
        Ejecuta una consulta real, puede consumir créditos CAPTCHA y guardar movimientos nuevos.
        Usa el ID interno del expediente, el que aparece en la URL de su ficha.
      </p>
      <div className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
        <label htmlFor="expediente-test-id">ID interno del expediente</label>
        <input
          id="expediente-test-id"
          type="number"
          min="1"
          step="1"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="Ej. 123"
        />
      </div>
      {idValido && (
        <RunExpedienteButton
          key={expedienteId}
          expedienteId={expedienteId}
          expedienteNumero={`ID ${expedienteId}`}
          botonInicial="Probar consulta real"
        />
      )}
    </section>
  );
}
