import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { consultarUno } from "@/lib/db";
import { consultasDeExpediente, movimientosDe } from "@/lib/corridas";
import { sesionRequerida } from "@/lib/sesion";
import { Badge, fmtHora } from "@/components/CorridasUI";

export const dynamic = "force-dynamic";

type Ficha = Record<string, unknown>;

/**
 * Ficha de un expediente con su historial de movimientos.
 *
 * Es lo que el bot resolvía descargando el `Historia` en XML: acá los movimientos
 * ya están en `movimientos`, deduplicados por huella, así que la ficha se arma con
 * dos lecturas locales y sin ir al PJud. Visible para cualquier usuario con sesión
 * (el listado de expedientes también lo es); el seguimiento de corridas queda para
 * el rol ADMIN.
 */
export default async function ExpedienteFichaPage({ params }: { params: { id: string } }) {
  sesionRequerida();

  const id = Number(String(params.id ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [ficha, movimientos, consultas] = await Promise.all([
    consultarUno<Ficha>(
      `SELECT id, numero, jurisdiccion, caratula, actor, demandado, estado, estado_nombre,
              actualizado, fch_ult_mov::text AS fch_ult_mov, ult_mov_desc, documento,
              fch_ult_proc::text AS fch_ult_proc, origen_carga, creado_por_usuario,
              centro_judicial, unidad_judicial, provincia, total_movimientos
         FROM vista_expedientes
        WHERE id = $1`,
      [id]
    ),
    movimientosDe(id, 100),
    consultasDeExpediente(id, 20),
  ]);

  if (!ficha) notFound();

  const ultimaConsulta = consultas[0] ?? null;

  return (
    <AppShell>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>{String(ficha.numero)}</h2>
          <span className="muted">{text(ficha.caratula) || "sin carátula"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge valor={text(ficha.actualizado)} />
          <Link className="btn btn-ghost btn-sm" href="/expedientes">
            Volver
          </Link>
        </div>
      </div>

      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <tbody>
            <Campo etiqueta="Centro judicial" valor={text(ficha.centro_judicial)} />
            <Campo etiqueta="Unidad" valor={text(ficha.unidad_judicial)} />
            <Campo etiqueta="Provincia" valor={text(ficha.provincia)} />
            <Campo etiqueta="Actor" valor={text(ficha.actor)} />
            <Campo etiqueta="Demandado" valor={text(ficha.demandado)} />
            <Campo
              etiqueta="Estado procesal"
              valor={`${text(ficha.estado)}${text(ficha.estado_nombre) ? ` · ${text(ficha.estado_nombre)}` : ""}`}
            />
            <Campo etiqueta="Jurisdicción (PJud)" valor={text(ficha.jurisdiccion)} />
            <Campo etiqueta="Último movimiento" valor={text(ficha.fch_ult_mov)} />
            <Campo etiqueta="Descripción" valor={text(ficha.ult_mov_desc)} />
            <Campo
              etiqueta="Última consulta"
              valor={ultimaConsulta ? `${fmtHora(ultimaConsulta.inicio)} · ${ultimaConsulta.resultado}` : "nunca consultado"}
            />
            <Campo etiqueta="Movimientos registrados" valor={text(ficha.total_movimientos)} />
            <Campo
              etiqueta="Origen de la carga"
              valor={text(ficha.origen_carga) ? `${text(ficha.origen_carga)} (${text(ficha.creado_por_usuario) || "—"})` : "padrón heredado"}
            />
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 16, marginBottom: 8 }}>Movimientos</h3>
      {movimientos.length === 0 ? (
        <div className="empty">Este expediente todavía no tiene movimientos en la base.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Documento</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m, i) => (
                <tr key={`${m.fecha ?? "sn"}-${m.histid ?? i}`}>
                  <td style={{ whiteSpace: "nowrap" }}>{text(m.fecha)}</td>
                  <td>{text(m.dscr)}</td>
                  <td>{enlace(m.link)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: 16, margin: "18px 0 8px" }}>Consultas</h3>
      {consultas.length === 0 ? (
        <div className="empty">Ninguna corrida tocó este expediente todavía.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Corrida</th>
                <th>Inicio</th>
                <th>Resultado</th>
                <th>Mov. nuevos</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {consultas.map((c) => (
                <tr key={c.corrida_id}>
                  <td>
                    <Link href={`/corridas/${c.corrida_id}`}>#{c.corrida_id}</Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtHora(c.inicio)}</td>
                  <td>
                    <Badge valor={c.resultado} />
                  </td>
                  <td>{c.movimientos_nuevos}</td>
                  <td className="muted">{c.motivo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <tr>
      <th style={{ width: 220, textAlign: "left" }}>{etiqueta}</th>
      <td>{valor || "—"}</td>
    </tr>
  );
}

function text(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "number") return String(valor);
  return String(valor).trim();
}

/**
 * El link del PJud es un enlace relativo a su propio dominio y caduca: se muestra
 * como texto y sólo se vuelve clickeable si viene absoluto (https).
 */
function enlace(link?: string | null) {
  const url = text(link);
  if (!url) return <span className="muted">—</span>;
  if (!/^https?:\/\//i.test(url)) return <span className="muted">{url}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer nofollow">
      abrir
    </a>
  );
}
