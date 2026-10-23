import type { Metadata } from "next";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { listadoDeCorridas, resumenDeSistema } from "@/lib/corridas";
import { sesionAdmin } from "@/lib/sesion";
import { BadgeCorrida, BadgeResultado, fmtFecha, fmtHora } from "@/components/CorridasUI";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Corridas · Expedientes" };

/**
 * Seguimiento de las corridas del worker (reemplaza el `dashboard.html` del bot
 * FastAPI, que no tenía login).
 *
 * Es sólo lectura: quien dispara una corrida es el servicio `worker` o el CLI, no
 * el navegador. Una corrida real tarda minutos, gasta créditos de captcha y tiene
 * que quedar registrada aun si el usuario cierra la pestaña; un botón de "Ejecutar"
 * acá sería un request largo con un trabajo de fondo adentro.
 */
export default async function CorridasPage() {
  sesionAdmin();
  const [corridas, resumen] = await Promise.all([listadoDeCorridas(40), resumenDeSistema()]);

  return (
    <AppShell>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Corridas de consulta</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Cada corrida es un pasazo por el padrón contra la API del Poder Judicial. Los estados son{" "}
        <BadgeResultado valor="SI" /> con movimientos nuevos,{" "}
        <BadgeResultado valor="NO" /> sin novedades,{" "}
        <BadgeResultado valor="KO" /> no se pudo obtener.
      </p>

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <div className="kpi">
          <div className="num">{resumen.expedientes.toLocaleString("es-AR")}</div>
          <div className="label">expedientes</div>
          <div className="sub">{resumen.pendientes.toLocaleString("es-AR")} nunca consultados</div>
        </div>
        <div className="kpi">
          <div className="num">{resumen.movimientos.toLocaleString("es-AR")}</div>
          <div className="label">movimientos</div>
          <div className="sub">deduplicados por huella</div>
        </div>
        <div className="kpi">
          <div className="num">{resumen.corridas.toLocaleString("es-AR")}</div>
          <div className="label">corridas</div>
          <div className="sub">
            {resumen.ultimaCorrida ? `última #${resumen.ultimaCorrida.id}` : "sin corridas"}
          </div>
        </div>
        <div className="kpi">
          <div className="num danger-num">{(resumen.porResultado["KO"] ?? 0).toLocaleString("es-AR")}</div>
          <div className="label">expedientes en KO</div>
          <div className="sub">
            {resumen.ultimaCorrida ? (
              <Link href={`/corridas/${resumen.ultimaCorrida.id}?ko=1`}>ver los de la última corrida</Link>
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      {corridas.length === 0 ? (
        <div className="empty">Todavía no se corrió ninguna consulta al PJud.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Modo</th>
                <th>Estado</th>
                <th>Total</th>
                <th>SI</th>
                <th>NO</th>
                <th>KO</th>
                <th>Duración</th>
              </tr>
            </thead>
            <tbody>
              {corridas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/corridas/${c.id}`}>{c.id}</Link>
                  </td>
                  <td>{fmtHora(c.inicio)}</td>
                  <td>{fmtHora(c.fin)}</td>
                  <td>{c.modo || "—"}</td>
                  <td>
                    <BadgeCorrida valor={c.estado} />
                  </td>
                  <td>{c.total}</td>
                  <td>{c.si}</td>
                  <td>{c.no}</td>
                  <td>{c.ko}</td>
                  <td>{c.fin ? diff(c.inicio, c.fin) : c.estado === "RUNNING" ? "en curso" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Datos al {fmtFecha(new Date().toISOString())}. Esta pantalla no refresca sola: recargá para ver
        el avance de una corrida en curso.
      </p>
    </AppShell>
  );
}

function diff(inicio: string | null, fin: string | null): string {
  if (!inicio || !fin) return "—";
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  const seg = Math.round((ms % 60000) / 1000);
  return min > 0 ? `${min}m ${seg}s` : `${seg}s`;
}
