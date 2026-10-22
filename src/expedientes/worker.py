"""Worker: una corrida de consulta contra la API del PJud.

Equivale al bot `ExtraccionDb`, con tres diferencias deliberadas:

  1. Idempotencia: un movimiento no se inserta dos veces (UNIQUE + hash).
  2. Aislamiento: si un expediente falla, la corrida sigue y queda el motivo.
  3. Todo el estado se persiste en Postgres, no en logs de texto.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import settings
from .models import Corrida, CorridaItem, Expediente, Movimiento
from .services.captcha import obtener_token
from .services.mailer import enviar, plantilla_resumen
from .services.pjud import CaptchaInvalido, PjudClient, hash_movimiento, parse_fecha

log = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(UTC)


def elegir_expedientes(session: Session, limite: int) -> list[Expediente]:
    """Primero los nunca consultados; después los más viejos."""
    stmt = (
        select(Expediente)
        .where(Expediente.estado == "ACT")
        .order_by(Expediente.fch_ult_proc.asc().nullsfirst(), Expediente.id.asc())
        .limit(limite)
    )
    return list(session.scalars(stmt))


def procesar_expediente(
    session: Session,
    client: PjudClient,
    expediente: Expediente,
    token: str,
) -> tuple[str, str | None, int]:
    """Consulta un expediente. Devuelve (resultado, motivo, insertados)."""
    encontrado, nuevas = client.consultar(
        expediente.numero, expediente.jurisdiccion, token, expediente.fch_ult_mov
    )

    if not encontrado:
        expediente.actualizado = "KO"
        expediente.fch_ult_proc = utcnow()
        return "KO", "el endpoint no devolvió datos para el expediente", 0

    if not nuevas:
        expediente.actualizado = "NO"
        expediente.fch_ult_proc = utcnow()
        return "NO", None, 0

    insertados = 0
    for story in nuevas:
        fecha = parse_fecha(story.get("fecha"))
        descripcion = str(story.get("dscr") or "").strip()
        histid = story.get("histid")
        huella = hash_movimiento(fecha, descripcion)

        ya_existe = session.scalar(
            select(Movimiento.id).where(
                Movimiento.expediente_id == expediente.id,
                Movimiento.hash_unico == huella,
            )
        )
        if ya_existe:
            continue

        session.add(
            Movimiento(
                expediente_id=expediente.id,
                fecha=fecha,
                descripcion=descripcion or None,
                texto=str(story.get("texto") or "") or None,
                link=str(story.get("link") or "") or None,
                histid=str(histid) if histid is not None else None,
                hash_unico=huella,
            )
        )
        insertados += 1

    ultima = nuevas[-1]
    fecha_ultima = parse_fecha(ultima.get("fecha"))
    if fecha_ultima:
        expediente.fch_ult_mov = fecha_ultima
    desc_ultima = str(ultima.get("dscr") or "").strip()
    if desc_ultima:
        expediente.ult_mov_desc = desc_ultima

    # Si todo lo que vino ya estaba registrado, no es una actualización real.
    resultado = "SI" if insertados else "NO"
    expediente.actualizado = resultado
    expediente.fch_ult_proc = utcnow()
    return resultado, None, insertados


def run_cycle(
    session: Session,
    *,
    token: str,
    limite: int | None = None,
    notificar: bool = False,
    modo: str = "pjud",
) -> int:
    """Ejecuta una corrida completa y devuelve el id de la corrida."""
    cfg = settings()
    limite = limite or cfg.max_expedientes_per_run

    corrida = Corrida(modo=modo, estado="RUNNING")
    session.add(corrida)
    session.commit()
    corrida_id = corrida.id

    expedientes = elegir_expedientes(session, limite)
    session.execute(
        update(Corrida).where(Corrida.id == corrida_id).values(total=len(expedientes))
    )
    session.commit()
    log.info("Corrida %s: %s expedientes a procesar", corrida_id, len(expedientes))

    conteo = {"SI": 0, "NO": 0, "KO": 0}
    error_corrida: str | None = None

    with PjudClient() as client:
        for indice, expediente in enumerate(expedientes, start=1):
            expediente_id = expediente.id
            numero = expediente.numero
            inicio = time.perf_counter()
            try:
                resultado, motivo, insertados = procesar_expediente(
                    session, client, expediente, token
                )
                session.commit()
            except CaptchaInvalido as exc:
                # El token no sirve: no tiene sentido seguir marcando todo KO.
                session.rollback()
                error_corrida = f"token rechazado por el PJud: {exc}"
                log.error("%s — se aborta la corrida %s", error_corrida, corrida_id)
                break
            except Exception as exc:  # noqa: BLE001 - un fallo no corta la corrida
                session.rollback()
                resultado, motivo, insertados = "KO", f"{type(exc).__name__}: {exc}", 0
                log.exception("Expediente %s falló", numero)
                fallido = session.get(Expediente, expediente_id)
                if fallido:
                    fallido.actualizado = "KO"
                    fallido.fch_ult_proc = utcnow()
                    session.commit()

            conteo[resultado] = conteo.get(resultado, 0) + 1
            session.add(
                CorridaItem(
                    corrida_id=corrida_id,
                    expediente_id=expediente_id,
                    resultado=resultado,
                    motivo=motivo,
                    movimientos_nuevos=insertados,
                    duracion_ms=int((time.perf_counter() - inicio) * 1000),
                )
            )
            session.commit()

            if indice % 100 == 0:
                log.info(
                    "Corrida %s: %s/%s (SI=%s NO=%s KO=%s)",
                    corrida_id,
                    indice,
                    len(expedientes),
                    conteo["SI"],
                    conteo["NO"],
                    conteo["KO"],
                )

    session.execute(
        update(Corrida)
        .where(Corrida.id == corrida_id)
        .values(
            fin=utcnow(),
            estado="FAILED" if error_corrida else "DONE",
            error=error_corrida,
            cnt_si=conteo["SI"],
            cnt_no=conteo["NO"],
            cnt_ko=conteo["KO"],
        )
    )
    session.commit()

    corrida = session.get(Corrida, corrida_id)
    log.info(
        "Corrida %s %s: %s SI / %s NO / %s KO",
        corrida_id,
        corrida.estado if corrida else "?",
        conteo["SI"],
        conteo["NO"],
        conteo["KO"],
    )

    if notificar and corrida:
        enviar(
            asunto=f"Expedientes: corrida {corrida_id} finalizada",
            cuerpo_html=plantilla_resumen(corrida),
        )

    return corrida_id


def token_para_corrida() -> str:
    """Obtiene el token una vez por corrida y lo reutiliza."""
    return obtener_token()
