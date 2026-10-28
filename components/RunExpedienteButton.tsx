"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Estado = "IDLE" | "PENDING" | "RUNNING" | "DONE" | "FAILED";

export default function RunExpedienteButton({
  expedienteId,
  expedienteNumero,
}: {
  expedienteId: number;
  expedienteNumero: string;
}) {
  const [solicitudId, setSolicitudId] = useState<number | null>(null);
  const [corridaId, setCorridaId] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado>("IDLE");
  const [error, setError] = useState("");

  useEffect(() => {
    if (solicitudId === null || (estado !== "PENDING" && estado !== "RUNNING")) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const consultarEstado = async () => {
      try {
        const response = await fetch(`/api/corridas/solicitudes/${solicitudId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo consultar el estado");
        if (cancelado) return;
        const solicitud = data.solicitud;
        setEstado(solicitud.estado);
        setCorridaId(solicitud.corridaId ?? null);
        setError(solicitud.estado === "FAILED" ? solicitud.error || "La corrida falló" : "");
        if (solicitud.estado === "PENDING" || solicitud.estado === "RUNNING") {
          timer = setTimeout(consultarEstado, 4000);
        }
      } catch (err) {
        if (cancelado) return;
        setError(err instanceof Error ? err.message : "No se pudo consultar el estado");
        timer = setTimeout(consultarEstado, 8000);
      }
    };

    timer = setTimeout(consultarEstado, 2000);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [solicitudId, estado]);

  async function ejecutar() {
    setSolicitudId(null);
    setEstado("PENDING");
    setCorridaId(null);
    setError("");
    try {
      const response = await fetch("/api/corridas/solicitudes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expedienteId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo encolar la corrida");
      setSolicitudId(data.solicitud.id);
      setCorridaId(data.solicitud.corridaId ?? null);
      setEstado(data.solicitud.estado);
    } catch (err) {
      setEstado("FAILED");
      setError(err instanceof Error ? err.message : "No se pudo encolar la corrida");
    }
  }

  const ocupado = estado === "PENDING" || estado === "RUNNING";
  const texto = estado === "PENDING" ? "En cola…" : estado === "RUNNING" ? "Consultando…" : estado === "DONE" ? "Correr otra vez" : estado === "FAILED" ? "Reintentar" : "Correr";

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={ejecutar}
        disabled={ocupado}
        title={`Consultar expediente ${expedienteNumero} en el Poder Judicial`}
      >
        {texto}
      </button>
      {corridaId !== null && estado === "DONE" && (
        <Link className="muted" style={{ fontSize: 11 }} href={`/corridas/${corridaId}`}>
          Ver corrida #{corridaId}
        </Link>
      )}
      {error && <span role="status" className="danger-num" style={{ maxWidth: 220, fontSize: 11 }}>{error}</span>}
    </div>
  );
}
