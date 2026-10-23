-- Datos derivados que la base del bot no tenía y que el panel de juridico muestra.
-- Idempotente: cada UPDATE filtra por "todavía vacío", así que se puede reejecutar
-- y no pisa lo que un usuario cargó después.

BEGIN;

-- Provincia: el padrón importado es íntegro del Poder Judicial de Tucumán, y el
-- bot nunca trajo el maestro de Provincias. Se crea la provincia y se asocian los
-- centros que no tienen, para que los maestros de juridico arranquen con datos.
INSERT INTO provincias (nombre) VALUES ('Tucumán') ON CONFLICT (nombre) DO NOTHING;

UPDATE centros_judiciales
SET provincia_id = (SELECT id FROM provincias WHERE nombre = 'Tucumán')
WHERE provincia_id IS NULL;

UPDATE expedientes
SET provincia = 'Tucumán'
WHERE provincia IS NULL OR TRIM(provincia) = '';

-- Documento: en la vista goolge2 era el enlace del movimiento más reciente.
-- Acá se deriva de movimientos.link (origen legado o PJud) una sola vez.
UPDATE expedientes e
SET documento = m.link
FROM (
  SELECT DISTINCT ON (expediente_id) expediente_id, link
  FROM movimientos
  WHERE link IS NOT NULL AND TRIM(link) <> ''
  ORDER BY expediente_id, fecha DESC NULLS LAST, id DESC
) m
WHERE m.expediente_id = e.id
  AND (e.documento IS NULL OR TRIM(e.documento) = '');

-- Nombre legible del estado procesal (en el legado era ExpdteEstadoNombre).
UPDATE expedientes
SET estado_nombre = CASE UPPER(TRIM(estado))
  WHEN 'ACT' THEN 'ACTIVO'
  WHEN 'INA' THEN 'INACTIVO'
  ELSE NULL
END
WHERE (estado_nombre IS NULL OR TRIM(estado_nombre) = '')
  AND estado IS NOT NULL;

COMMIT;
