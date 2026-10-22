"""Carga del padrón de expedientes a Postgres.

El sistema es autónomo: la lista vive en `expedientes`. Hay tres entradas:

  * importar_archivo()            CSV o XLSX (lo más simple para arrancar)
  * importar_desde_sqlserver()    una sola vez, desde la LAN, leyendo
                                  LegajoExpdtes igual que el bot
  * upsert_expediente()           usado por ambos

`importar_desde_sqlserver` es opcional y requiere `pip install pyodbc`
más el driver ODBC de SQL Server. No se ejecuta desde Dokploy: el SQL
Server es de red local.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CentroJudicial, Expediente, Movimiento

log = logging.getLogger(__name__)

ALIAS_NUMERO = {"numero", "nro", "nro_expediente", "expdtenro", "expediente", "expdte_nro"}
ALIAS_JURISDICCION = {"jurisdiccion", "jurisdicción", "jurisdiccion_id", "centrojudequivendpoint"}
ALIAS_CENTRO = {"centro", "centro_judicial", "centrojudicial", "centrojud"}
ALIAS_ESTADO = {"estado", "expdteestado"}


def _normalizar(clave: str) -> str:
    return clave.strip().lower().replace(" ", "_")


def upsert_expediente(
    session: Session,
    numero: str,
    jurisdiccion: int = 11,
    centro_id: int | None = None,
    caratula: str | None = None,
    estado: str = "ACT",
) -> tuple[Expediente, bool]:
    """Crea o actualiza. Devuelve (expediente, creado)."""
    numero = numero.strip()
    existente = session.scalar(
        select(Expediente).where(
            Expediente.numero == numero, Expediente.jurisdiccion == jurisdiccion
        )
    )
    if existente:
        if caratula:
            existente.caratula = caratula
        existente.estado = estado
        return existente, False

    nuevo = Expediente(
        numero=numero,
        jurisdiccion=jurisdiccion,
        centro_id=centro_id,
        caratula=caratula,
        estado=estado,
    )
    session.add(nuevo)
    session.flush()
    return nuevo, True


def importar_archivo(session: Session, ruta: str | Path) -> dict[str, int]:
    """Importa CSV/XLSX. Devuelve {'creados': n, 'actualizados': n, 'ignorados': n}."""
    ruta = Path(ruta)
    if not ruta.exists():
        raise FileNotFoundError(ruta)

    filas = _leer_xlsx(ruta) if ruta.suffix.lower() in {".xlsx", ".xlsm"} else _leer_csv(ruta)

    creados = actualizados = ignorados = 0
    for fila in filas:
        datos = {_normalizar(k): v for k, v in fila.items() if k is not None}
        numero = next((str(datos[x]).strip() for x in ALIAS_NUMERO if datos.get(x)), "")
        if not numero:
            ignorados += 1
            continue

        jurisdiccion = 11
        for alias in ALIAS_JURISDICCION:
            valor = datos.get(alias)
            if valor not in (None, ""):
                try:
                    jurisdiccion = int(float(str(valor)))
                    break
                except ValueError:
                    pass

        estado = "ACT"
        for alias in ALIAS_ESTADO:
            if datos.get(alias):
                estado = str(datos[alias]).strip().upper()[:8]
                break

        _, creado = upsert_expediente(
            session, numero=numero, jurisdiccion=jurisdiccion, estado=estado
        )
        creados += int(creado)
        actualizados += int(not creado)

    session.commit()
    log.info(
        "Importación: %s creados, %s actualizados, %s ignorados",
        creados,
        actualizados,
        ignorados,
    )
    return {"creados": creados, "actualizados": actualizados, "ignorados": ignorados}


def _leer_csv(ruta: Path) -> list[dict]:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            with ruta.open("r", encoding=encoding, newline="") as fh:
                muestra = fh.read(4096)
                fh.seek(0)
                dialecto = csv.Sniffer().sniff(muestra, delimiters=",;\t|")
                return list(csv.DictReader(fh, dialect=dialecto))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"No se pudo leer {ruta}: encoding desconocido")


def _leer_xlsx(ruta: Path) -> list[dict]:
    from openpyxl import load_workbook

    wb = load_workbook(ruta, read_only=True, data_only=True)
    hoja = wb.active
    filas = hoja.iter_rows(values_only=True)
    encabezados = [str(c) if c is not None else "" for c in next(filas)]
    datos = [dict(zip(encabezados, fila, strict=False)) for fila in filas]
    wb.close()
    return datos


SQL_CENTROS = """
    SELECT CentroJudId, CentroJudNombre, CentroJudEquivEndpoint
    FROM LegajoExpdtes.dbo.CentrosJudiciales
"""

SQL_EXPEDIENTES = """
    SELECT EC.ExpdteId, EC.ExpdteNro, CJ.CentroJudEquivEndpoint,
           EC.ExpdteCaratula, EC.ExpdteActor, EC.ExpdteDemandado,
           EC.ExpdteFchUltMov, EC.ExpdteUltMovDescripcion,
           EC.ExpdteEstado, EC.ExpdteActualizado, EC.ExpdteFchUltProc
    FROM LegajoExpdtes.dbo.ExpdtesCaratula EC
    LEFT JOIN LegajoExpdtes.dbo.CentrosJudiciales CJ
        ON EC.ExpdteCenJudId = CJ.CentroJudId
"""

SQL_LINEAS = """
    SELECT ExpdteId, ExpdteLinFecha, ExpdteLinDescripcionActo, ExpdteLinDoc
    FROM LegajoExpdtes.dbo.ExpdtesLineas
"""


def _int_o_none(valor: object) -> int | None:
    if valor is None:
        return None
    texto = str(valor).strip()
    if not texto:
        return None
    try:
        return int(float(texto))
    except ValueError:
        return None


def _a_datetime(valor: object):
    """SQL Server devuelve date; el modelo usa timestamptz."""
    from datetime import UTC, datetime

    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=UTC)
    return datetime(valor.year, valor.month, valor.day, tzinfo=UTC)  # type: ignore[attr-defined]


def importar_desde_sqlserver(
    session: Session,
    connection_string: str,
    *,
    incluir_historial: bool = True,
) -> dict[str, int]:
    """Migración desde LegajoExpdtes (correr en la LAN, no en Dokploy).

    Importa, en este orden:
      1. centros judiciales (con su código de endpoint y su id legado)
      2. expedientes (carátula completa, actor, demandado, último movimiento)
      3. historial de líneas, deduplicado (el legado tiene duplicados reales)

    Es idempotente: se puede volver a correr sin duplicar nada.
    """
    try:
        import pyodbc
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Falta pyodbc: pip install pyodbc") from exc

    from sqlalchemy import update
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    resumen = {
        "centros": 0,
        "creados": 0,
        "actualizados": 0,
        "movimientos": 0,
        "lineas_duplicadas": 0,
    }

    with pyodbc.connect(connection_string, timeout=20) as conn:
        cur = conn.cursor()

        # ---- 1. Centros judiciales -------------------------------------
        centros_por_legado: dict[int, int] = {}
        centros_por_endpoint: dict[int, int] = {}
        existentes = {c.legado_id: c for c in session.scalars(select(CentroJudicial))}
        for legado_id, nombre, endpoint in cur.execute(SQL_CENTROS).fetchall():
            legado_id = int(legado_id)
            codigo = _int_o_none(endpoint)
            centro = existentes.get(legado_id)
            if centro is None:
                centro = CentroJudicial(
                    nombre=str(nombre or "").strip() or f"Centro {legado_id}",
                    codigo_endpoint=codigo,
                    legado_id=legado_id,
                )
                session.add(centro)
                session.flush()
            else:
                centro.nombre = str(nombre or "").strip() or centro.nombre
                centro.codigo_endpoint = codigo
            centros_por_legado[legado_id] = centro.id
            if codigo is not None:
                centros_por_endpoint[codigo] = centro.id
        session.commit()
        resumen["centros"] = len(centros_por_legado)

        # ---- 2. Expedientes --------------------------------------------
        actuales = {
            (e.numero, e.jurisdiccion): e.id
            for e in session.scalars(select(Expediente))
        }
        legacy_a_nuevo: dict[int, int] = {}
        nuevos: list[dict] = []
        cambios: list[dict] = []

        for fila in cur.execute(SQL_EXPEDIENTES).fetchall():
            (
                legado_id,
                numero,
                endpoint,
                caratula,
                actor,
                demandado,
                fch_ult_mov,
                ult_mov_desc,
                estado,
                actualizado,
                fch_ult_proc,
            ) = fila
            numero = str(numero or "").strip()
            if not numero:
                continue
            codigo = _int_o_none(endpoint)
            jurisdiccion = codigo or 0
            datos = {
                "numero": numero,
                "jurisdiccion": jurisdiccion,
                "centro_id": centros_por_endpoint.get(codigo) if codigo else None,
                "caratula": str(caratula or "").strip() or None,
                "actor": str(actor or "").strip() or None,
                "demandado": str(demandado or "").strip() or None,
                "fch_ult_mov": fch_ult_mov,
                "ult_mov_desc": str(ult_mov_desc or "").strip() or None,
                "estado": str(estado or "ACT").strip()[:8],
                "actualizado": str(actualizado or "").strip()[:4] or None,
                "fch_ult_proc": _a_datetime(fch_ult_proc),
            }
            existente = actuales.get((numero, jurisdiccion))
            if existente:
                legacy_a_nuevo[int(legado_id)] = existente
                cambios.append({**datos, "id": existente})
            else:
                nuevos.append(datos)

        insertados_nuevos = 0
        for lote_inicio in range(0, len(nuevos), 2000):
            lote = nuevos[lote_inicio : lote_inicio + 2000]
            filas = session.execute(
                pg_insert(Expediente)
                .values(lote)
                .on_conflict_do_nothing(constraint="uq_expediente_numero_jurisdiccion")
                .returning(Expediente.id, Expediente.numero, Expediente.jurisdiccion)
            ).all()
            insertados_nuevos += len(filas)
            for nuevo_id, numero, jurisdiccion in filas:
                actuales[(numero, jurisdiccion)] = nuevo_id
        session.commit()
        resumen["creados"] = insertados_nuevos

        # El mapeo legado -> nuevo se completa con los recién insertados.
        for fila in cur.execute(SQL_EXPEDIENTES).fetchall():
            legado_id = int(fila[0])
            if legado_id in legacy_a_nuevo:
                continue
            numero = str(fila[1] or "").strip()
            codigo = _int_o_none(fila[2])
            nuevo_id = actuales.get((numero, codigo or 0))
            if nuevo_id:
                legacy_a_nuevo[legado_id] = nuevo_id

        if cambios:
            for lote_inicio in range(0, len(cambios), 2000):
                session.execute(
                    update(Expediente),
                    cambios[lote_inicio : lote_inicio + 2000],
                    execution_options={"synchronize_session": False},
                )
            session.commit()
        resumen["actualizados"] = len(cambios)

        # ---- 3. Historial ----------------------------------------------
        if incluir_historial:
            from datetime import date as _date

            from .pjud import hash_movimiento

            lineas = cur.execute(SQL_LINEAS).fetchall()
            ya_insertados: set[tuple[int, str]] = set()
            for lote_inicio in range(0, len(lineas), 5000):
                movimientos: list[dict] = []
                for legado_exp, fch, descripcion, link in lineas[lote_inicio : lote_inicio + 5000]:
                    nuevo_id = legacy_a_nuevo.get(int(legado_exp))
                    if not nuevo_id:
                        continue
                    fecha = fch if isinstance(fch, _date) else None
                    desc = str(descripcion or "").strip() or None
                    huella = hash_movimiento(fecha, desc)
                    clave = (nuevo_id, huella)
                    if clave in ya_insertados:
                        resumen["lineas_duplicadas"] += 1
                        continue
                    ya_insertados.add(clave)
                    enlace = str(link).strip() if link else ""
                    movimientos.append(
                        {
                            "expediente_id": nuevo_id,
                            "fecha": fecha,
                            "descripcion": desc,
                            "link": enlace or None,
                            "origen": "legado",
                            "hash_unico": huella,
                        }
                    )

                if movimientos:
                    insertadas = session.execute(
                        pg_insert(Movimiento)
                        .values(movimientos)
                        .on_conflict_do_nothing(constraint="uq_movimiento_expediente_hash")
                        .returning(Movimiento.id)
                    ).all()
                    session.commit()
                    resumen["movimientos"] += len(insertadas)

    log.info("Importación del legado: %s", resumen)
    return resumen
