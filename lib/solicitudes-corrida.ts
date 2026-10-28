import { consultarUno, ejecutar, num } from "./db";

export type SolicitudCorrida = {
  id: number;
  estado: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  corridaId: number | null;
  error: string | null;
};

type FilaSolicitud = {
  id: number | string;
  estado: SolicitudCorrida["estado"];
  corrida_id: number | string | null;
  error: string | null;
};

function mapear(fila: FilaSolicitud): SolicitudCorrida {
  return {
    id: num(fila.id),
    estado: fila.estado,
    corridaId: fila.corrida_id === null ? null : num(fila.corrida_id),
    error: fila.error,
  };
}

export async function solicitarCorridaIndividual(
  expedienteId: number,
  usuarioId: number
): Promise<{ solicitud: SolicitudCorrida; existente: boolean } | null> {
  const insertada = await ejecutar(
    `INSERT INTO solicitudes_corrida (expediente_id, solicitada_por)
     SELECT e.id, $2
       FROM expedientes e
      WHERE e.id = $1
     ON CONFLICT (expediente_id)
       WHERE estado IN ('PENDING', 'RUNNING') AND expediente_id IS NOT NULL
     DO NOTHING
     RETURNING id, estado, corrida_id, error`,
    [expedienteId, usuarioId]
  );

  const nueva = insertada.rows[0] as FilaSolicitud | undefined;
  if (nueva) return { solicitud: mapear(nueva), existente: false };

  const actual = await consultarUno<FilaSolicitud>(
    `SELECT id, estado, corrida_id, error
       FROM solicitudes_corrida
      WHERE expediente_id = $1 AND estado IN ('PENDING', 'RUNNING')
      ORDER BY id DESC
      LIMIT 1`,
    [expedienteId]
  );
  return actual ? { solicitud: mapear(actual), existente: true } : null;
}

export async function solicitudCorridaPorId(id: number): Promise<SolicitudCorrida | null> {
  const fila = await consultarUno<FilaSolicitud>(
    `SELECT id, estado, corrida_id, error FROM solicitudes_corrida WHERE id = $1`,
    [id]
  );
  return fila ? mapear(fila) : null;
}

export async function reclamarSolicitudIndividual(): Promise<{
  id: number;
  expedienteId: number | null;
} | null> {
  const resultado = await ejecutar(
    `UPDATE solicitudes_corrida AS s
        SET estado = 'RUNNING', iniciada_en = now(), error = NULL
      WHERE s.id = (
        SELECT id
          FROM solicitudes_corrida
         WHERE estado = 'PENDING'
         ORDER BY creada_en, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING s.id, s.expediente_id`
  );
  const fila = resultado.rows[0] as { id: number | string; expediente_id: number | string | null } | undefined;
  return fila
    ? { id: num(fila.id), expedienteId: fila.expediente_id === null ? null : num(fila.expediente_id) }
    : null;
}

export async function finalizarSolicitudIndividual(
  id: number,
  estado: "DONE" | "FAILED",
  corridaId: number | null,
  error: string | null
): Promise<void> {
  await ejecutar(
    `UPDATE solicitudes_corrida
        SET estado = $2,
            corrida_id = $3,
            error = $4,
            finalizada_en = now()
      WHERE id = $1`,
    [id, estado, corridaId, error?.slice(0, 4000) ?? null]
  );
}
