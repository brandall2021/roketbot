-- Señal del worker para que el panel pueda probar que está vivo sin consultar al PJud.
BEGIN;

ALTER TABLE programacion_corridas
  ADD COLUMN IF NOT EXISTS worker_ultimo_pulso TIMESTAMPTZ;

COMMIT;
