import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ProgramacionCorridasForm from "@/components/ProgramacionCorridasForm";
import { sesionAdmin } from "@/lib/sesion";
import { leerProgramacionCorridas } from "@/lib/programacion";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Programar corridas · Expedientes" };

export default async function ProgramacionCorridasPage() {
  sesionAdmin();
  const programacion = await leerProgramacionCorridas();

  return (
    <AppShell>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Programar corridas</h2>
          <p className="muted">El worker consulta esta configuración en PostgreSQL; no hace falta dejar esta página abierta.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/corridas">Ver historial</Link>
      </div>
      <ProgramacionCorridasForm initial={programacion} />
    </AppShell>
  );
}
