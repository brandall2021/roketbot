-- Unificación roketbot + juridico sobre PostgreSQL.
--
-- Este archivo es IDEMPOTENTE a propósito: la base `rocketbot` ya existe en
-- Dokploy con el padrón importado (7.801 expedientes y 114.742 movimientos), así
-- que la migración corre tanto sobre esa base con datos como sobre una vacía, y
-- se puede volver a ejecutar sin romper nada. Por eso todo es CREATE ... IF NOT
-- EXISTS / ALTER TABLE ... ADD COLUMN IF NOT EXISTS, y las vistas con OR REPLACE.
--
-- Equivalencias con lo que había antes:
--   roketbot (Postgres)     -> se conserva tal cual: expedientes, movimientos,
--                              centros_judiciales, corridas, corrida_items,
--                              tokens_captcha, notificaciones.
--   LegajoExpdtes (SQL Server)
--     dbo.ExpdtesCaratula    -> expedientes (una sola tabla, sin MAX+1: id es identity)
--     dbo.ExpdtesLineas      -> movimientos (con UNIQUE que el legado no tenía)
--     dbo.CentrosJudiciales  -> centros_judiciales
--     dbo.Provincias         -> provincias (tabla nueva)
--   juridico (tablas propias)
--     dbo.app_usuarios       -> usuarios
--     dbo.app_cargas         -> cargas
--     dbo.app_expedientes    -> desaparece: era una copia de auditoría de lo insertado
--                              en ExpdtesCaratula. Acá el registro ES la fila de
--                              `expedientes`, marcada con origen_carga y creado_por.

BEGIN;

-- ---------------------------------------------------------------------------
-- Nombres
-- ---------------------------------------------------------------------------
-- Las tablas del bot ya estaban en minúscula; las nuevas siguen la misma
-- convención para que no haya que citar identificadores en las queries.

-- ---------------------------------------------------------------------------
-- Provincias (maestro de juridico)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provincias (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------------
-- Usuarios de la app (antes dbo.app_usuarios en SQL Server)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       VARCHAR(80)  NOT NULL UNIQUE,
  password_hash  VARCHAR(200) NOT NULL,
  nombre         VARCHAR(120) NOT NULL,
  rol            VARCHAR(20)  NOT NULL DEFAULT 'USER' CHECK (rol IN ('ADMIN', 'USER')),
  activo         BOOLEAN      NOT NULL DEFAULT TRUE,
  ultimo_acceso  TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_usuarios_rol ON usuarios (rol);

-- ---------------------------------------------------------------------------
-- Centros judiciales: se agregan los campos que tenía el maestro de SQL Server
-- ---------------------------------------------------------------------------
ALTER TABLE centros_judiciales ADD COLUMN IF NOT EXISTS unidad     VARCHAR(120);
ALTER TABLE centros_judiciales ADD COLUMN IF NOT EXISTS sitio_web   TEXT;
ALTER TABLE centros_judiciales ADD COLUMN IF NOT EXISTS provincia_id INTEGER REFERENCES provincias(id);

-- ---------------------------------------------------------------------------
-- Expedientes: columnas que juridico mostraba y al bot le faltaban
-- ---------------------------------------------------------------------------
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS unidad_judicial VARCHAR(120);
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS provincia       VARCHAR(80);
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS estado_nombre   VARCHAR(40);   -- ACTIVO / INACTIVO
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS documento       TEXT;          -- enlace del último movimiento
-- De dónde salió la fila: PJUD (consulta al endpoint), LEGADO (importación del
-- SQL Server), CSV, MANUAL o MASIVO (bulk update). Null = heredada del padrón
-- sin origen conocido.
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS origen_carga    VARCHAR(10);
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS creado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE expedientes ADD COLUMN IF NOT EXISTS carga_en        TIMESTAMPTZ;

-- Semántica de las dos columnas de estado, que son fácil de confundir:
--   estado      = estado procesal (ACT / INA) -> por esto el worker elige a consultar
--   actualizado = resultado de la última consulta al PJud (SI / NO / KO)
COMMENT ON COLUMN expedientes.estado IS 'Estado procesal: ACT o INA';
COMMENT ON COLUMN expedientes.actualizado IS 'Resultado de la última consulta: SI, NO o KO';

-- ---------------------------------------------------------------------------
-- Auditoría de archivos subidos (antes dbo.app_cargas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cargas (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archivo         VARCHAR(255) NOT NULL,
  tamano          BIGINT,
  filas_leidas    INTEGER NOT NULL DEFAULT 0,
  insertados      INTEGER NOT NULL DEFAULT 0,
  duplicados      INTEGER NOT NULL DEFAULT 0,
  actualizados    INTEGER NOT NULL DEFAULT 0,
  errores         INTEGER NOT NULL DEFAULT 0,
  detalle_errores TEXT,
  origen          VARCHAR(10) NOT NULL DEFAULT 'CSV',
  creado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cargas_creado_en ON cargas (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_cargas_creado_por ON cargas (creado_por);

-- ---------------------------------------------------------------------------
-- updated_at: en el bot lo mantenía SQLAlchemy; sin Python hay que mantenerlo
-- desde la base, si no las corridas y ediciones quedan con la fecha vieja.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expedientes_updated_at ON expedientes;
CREATE TRIGGER trg_expedientes_updated_at
  BEFORE UPDATE ON expedientes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Vista de listado: deja el expediente plano (centro, unidad, provincia) para
-- que las queries del panel no repitan el join en cada filtro, KPI y gráfico.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vista_expedientes AS
SELECT
  e.id,
  e.numero,
  e.jurisdiccion,
  e.caratula,
  e.actor,
  e.demandado,
  e.estado,
  e.estado_nombre,
  e.actualizado,
  e.fch_ult_mov,
  e.ult_mov_desc,
  e.documento,
  e.fch_ult_proc,
  e.origen_carga,
  e.creado_por,
  u.username                          AS creado_por_usuario,
  e.centro_id,
  COALESCE(NULLIF(TRIM(c.nombre), ''), 'Sin centro')  AS centro_judicial,
  COALESCE(NULLIF(TRIM(e.unidad_judicial), ''),
           NULLIF(TRIM(c.unidad), ''),
           'Sin unidad')              AS unidad_judicial,
  COALESCE(NULLIF(TRIM(e.provincia), ''),
           NULLIF(TRIM(p.nombre), ''),
           'Sin provincia')           AS provincia,
  c.codigo_endpoint                   AS centro_codigo_endpoint,
  (SELECT COUNT(*) FROM movimientos m WHERE m.expediente_id = e.id) AS total_movimientos
FROM expedientes e
LEFT JOIN centros_judiciales c ON c.id = e.centro_id
LEFT JOIN provincias p        ON p.id = c.provincia_id
LEFT JOIN usuarios u          ON u.id = e.creado_por;

COMMIT;
