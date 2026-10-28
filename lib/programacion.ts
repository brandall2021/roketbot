import { ejecutar, consultarUno, fecha, num } from "./db";

export type ProgramacionCorridas = {
  habilitada: boolean;
  intervaloSegundos: number;
  proximaEjecucion: string | null;
};

type FilaProgramacion = {
  habilitada: boolean;
  intervalo_segundos: number | string;
  proxima_ejecucion: unknown;
};

function mapear(fila: FilaProgramacion): ProgramacionCorridas {
  return {
    habilitada: fila.habilitada,
    intervaloSegundos: num(fila.intervalo_segundos),
    proximaEjecucion: fecha(fila.proxima_ejecucion),
  };
}

export async function leerProgramacionCorridas(): Promise<ProgramacionCorridas> {
  const fila = await consultarUno<FilaProgramacion>(
    `SELECT habilitada, intervalo_segundos, proxima_ejecucion
       FROM programacion_corridas
      WHERE id = 1`
  );
  if (!fila) throw new Error("No existe la programación de corridas; aplique las migraciones");
  return mapear(fila);
}

export async function guardarProgramacionCorridas(
  habilitada: boolean,
  intervaloSegundos: number,
  usuarioId: number | null
): Promise<ProgramacionCorridas> {
  const resultado = await ejecutar(
    `UPDATE programacion_corridas
        SET habilitada = $1,
            intervalo_segundos = $2,
            proxima_ejecucion = CASE
              WHEN $1 THEN now() + ($2 * interval '1 second')
              ELSE NULL
            END,
            actualizado_en = now(),
            actualizado_por = $3
      WHERE id = 1
      RETURNING habilitada, intervalo_segundos, proxima_ejecucion`,
    [habilitada, intervaloSegundos, usuarioId]
  );
  const fila = resultado.rows[0] as FilaProgramacion | undefined;
  if (!fila) throw new Error("No existe la programación de corridas; aplique las migraciones");
  return mapear(fila);
}

/** Reclamo atómico: dos instancias del worker no toman la misma ejecución. */
export async function reclamarCorridaProgramada(): Promise<boolean> {
  const resultado = await ejecutar(
    `UPDATE programacion_corridas
        SET proxima_ejecucion = now() + (intervalo_segundos * interval '1 second')
      WHERE id = 1
        AND habilitada = TRUE
        AND proxima_ejecucion <= now()
      RETURNING id`
  );
  return resultado.rowCount > 0;
}

/** Evita una corrida de recuperación inmediata si la anterior duró más que el intervalo. */
export async function programarSiguienteTrasCorrida(): Promise<void> {
  await ejecutar(
    `UPDATE programacion_corridas
        SET proxima_ejecucion = now() + (intervalo_segundos * interval '1 second')
      WHERE id = 1 AND habilitada = TRUE`
  );
}
