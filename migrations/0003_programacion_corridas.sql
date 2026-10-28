-- Configuración persistente del worker, editable desde el panel de administración.
BEGIN;

CREATE TABLE IF NOT EXISTS programacion_corridas (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  habilitada            BOOLEAN NOT NULL DEFAULT TRUE,
  intervalo_segundos   INTEGER NOT NULL DEFAULT 3600
                        CHECK (intervalo_segundos BETWEEN 60 AND 2592000),
  proxima_ejecucion     TIMESTAMPTZ,
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);

INSERT INTO programacion_corridas
  (id, habilitada, intervalo_segundos, proxima_ejecucion)
VALUES
  (1, TRUE, 3600, now())
ON CONFLICT (id) DO NOTHING;

COMMIT;
