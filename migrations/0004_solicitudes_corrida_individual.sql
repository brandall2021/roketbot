-- Cola persistente para ejecutar un expediente desde el panel sin mantener
-- abierta una petición web durante la consulta al Poder Judicial.
BEGIN;

CREATE TABLE IF NOT EXISTS solicitudes_corrida (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expediente_id   INTEGER REFERENCES expedientes(id) ON DELETE SET NULL,
  solicitada_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                  CHECK (estado IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  corrida_id      BIGINT,
  error           TEXT,
  creada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciada_en     TIMESTAMPTZ,
  finalizada_en   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_solicitudes_corrida_cola
  ON solicitudes_corrida (estado, creada_en, id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitudes_corrida_activa_expediente
  ON solicitudes_corrida (expediente_id)
  WHERE estado IN ('PENDING', 'RUNNING') AND expediente_id IS NOT NULL;

COMMIT;
