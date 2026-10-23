import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { itemsDeCorrida, corridaPorId } from "@/lib/corridas";
import { sesionAdmin } from "@/lib/sesion";
import { Badge, BadgeCorrida, BadgeResultado, fmtDuracion, fmtHora } from "@/components/CorridasUI";

export const dynamic = "force-dynamic";

/**
 * Detalle de una corrida: qué expediente dio SI / NO / KO y por qué.
 *
 * Es la pantalla que responde "¿qué falló hoy?" sin tener que pelar logs del
 * worker. Con `?ko=1` queda filtrada sólo por los fallados, que es la lista que
 * después se reprocesa con `npm run` -> `tsx worker/cli.ts retry-ko --corrida N`.
 */
export default async function CorridaDetallePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ko?: string };
}) {
  sesionAdmin();

  const id = Number(String(params.id ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) notFound();

  const soloKo = searchParams.ko === "1";
  const [corrida, items] = await Promise.all([
    corridaPorId(id),
    itemsDeCorrida(id, { soloKo, limite: 500 }),
  ]);
  if (!corrida) notFound();

  return (
    <AppShell>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>Corrida #{corrida.id}</h2>
          <span className="muted">
            {fmtHora(corrida.inicio)} → {fmtHora(corrida.fin)} · modo {corrida.modo || "—"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <BadgeCorrida valor={corrida.estado} />
          <Link className="btn btn-ghost btn-sm" href="/corridas">
            Volver
          </Link>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="num">{corrida.total}</div>
          <div className="label">programados</div>
        </div>
        <div className="kpi">
          <div className="num ok-num">{corrida.si}</div>
          <div className="label">con movimientos nuevos</div>
        </div>
        <div className="kpi">
          <div className="num warn-num">{corrida.no}</div>
          <div className="label">sin novedades</div>
        </div>
        <div className="kpi">
          <div className="num danger-num">{corrida.ko}</div>
          <div className="label">no se pudo obtener</div>
          <div className="sub">
            <Link href={`/corridas/${corrida.id}?ko=1`}>{soloKo ? "mostrando sólo KO" : "ver sólo los KO"}</Link>
          </div>
        </div>
      </div>

      {corrida.error && (
        <div className="alert error" style={{ marginBottom: 14 }}>
          La corrida se abortó: {corrida.error}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Se corta a propósito: seguir sin token válido llenaría el padrón de KO falsos.
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          {soloKo ? "Esta corrida no dejó expedientes en KO." : "Todavía no hay expedientes procesados."}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Expediente</th>
                <th>Resultado</th>
                <th>Mov. nuevos</th>
                <th>Duración</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.expediente_id ? (
                      <Link href={`/expedientes/${it.expediente_id}`}>{it.numero ?? it.expediente_id}</Link>
                    ) : (
                      <span className="muted">archivo borrado</span>
                    )}
                  </td>
                  <td>
                    <BadgeResultado valor={it.resultado} />
                  </td>
                  <td>{it.movimientos_nuevos}</td>
                  <td>{fmtDuracion(it.duracion_ms)}</td>
                  <td className="muted" style={{ maxWidth: 460 }}>
                    {it.motivo ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
        Se muestran los primeros {items.length} registros de la corrida. Para reprocesar los fallados:{" "}
        <code>tsx worker/cli.ts retry-ko --corrida {corrida.id}</code>. El <Badge valor="RUNNING" /> se
        ve hasta que el worker cierra la corrida.
      </p>
    </AppShell>
  );
}
