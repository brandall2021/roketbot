"use client";

import { useState } from "react";
import type { ProgramacionCorridas } from "@/lib/programacion";

const INTERVALOS = [
  { segundos: 3600, etiqueta: "Cada hora" },
  { segundos: 10800, etiqueta: "Cada 3 horas" },
  { segundos: 21600, etiqueta: "Cada 6 horas" },
  { segundos: 43200, etiqueta: "Cada 12 horas" },
  { segundos: 86400, etiqueta: "Cada 24 horas" },
];

export default function ProgramacionCorridasForm({ initial }: { initial: ProgramacionCorridas }) {
  const [habilitada, setHabilitada] = useState(initial.habilitada);
  const [intervalo, setIntervalo] = useState(initial.intervaloSegundos);
  const [proxima, setProxima] = useState(initial.proximaEjecucion);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState(false);
  const opciones = INTERVALOS.some((opcion) => opcion.segundos === intervalo)
    ? INTERVALOS
    : [...INTERVALOS, { segundos: intervalo, etiqueta: `Cada ${Math.round(intervalo / 60)} minutos` }];

  async function guardar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGuardando(true);
    setMensaje("");
    setError(false);
    try {
      const response = await fetch("/api/corridas/programacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habilitada, intervaloSegundos: intervalo }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la programación");
      setProxima(data.programacion.proximaEjecucion);
      setMensaje(habilitada ? "Programación guardada." : "Programación pausada.");
    } catch (err) {
      setError(true);
      setMensaje(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 760, padding: 20 }}>
      <form onSubmit={guardar}>
        <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
          <input
            type="checkbox"
            checked={habilitada}
            onChange={(event) => setHabilitada(event.target.checked)}
          />
          <span>Activar corridas automáticas</span>
        </label>

        <div className="field" style={{ maxWidth: 360, marginBottom: 16 }}>
          <label htmlFor="intervalo-corridas">Periodicidad</label>
          <select
            id="intervalo-corridas"
            value={intervalo}
            onChange={(event) => setIntervalo(Number(event.target.value))}
            disabled={!habilitada}
          >
            {opciones.map((opcion) => (
              <option key={opcion.segundos} value={opcion.segundos}>{opcion.etiqueta}</option>
            ))}
          </select>
        </div>

        <p className="muted" style={{ marginBottom: 18 }}>
          Al guardar, la próxima corrida queda programada para un intervalo después del guardado.
          El worker debe estar activo para ejecutarla. Las corridas recorren los expedientes pendientes
          hasta el límite configurado en el servicio.
        </p>

        <button className="btn" type="submit" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar programación"}
        </button>

        {mensaje && (
          <span role="status" style={{ marginLeft: 12, color: error ? "var(--danger)" : "var(--ok)" }}>
            {mensaje}
          </span>
        )}
      </form>

      <div className="muted" style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 14 }}>
        Estado: <b>{habilitada ? "Automático activado" : "Pausado"}</b>
        {habilitada && proxima && (
          <> · Próxima corrida: <b>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(proxima))}</b></>
        )}
      </div>
    </section>
  );
}
