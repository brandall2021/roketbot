"""Envío de correo (reemplaza el sub-bot `EnvioCorreos`).

El mail no es el canal de verdad: el estado real vive en Postgres.
Si el envío falla, la notificación queda en la tabla `notificaciones`
como PENDIENTE y se puede reintentar.
"""

from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..config import settings

log = logging.getLogger(__name__)


def enviar(asunto: str, cuerpo_html: str, destinatarios: list[str] | None = None) -> bool:
    cfg = settings()
    if not cfg.mail_habilitado:
        log.warning("Mail deshabilitado: faltan SMTP_HOST / MAIL_DESTINATARIOS")
        return False

    destinos = destinatarios or cfg.destinatarios
    if not destinos:
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = asunto
    msg["From"] = cfg.smtp_from or cfg.smtp_user
    msg["To"] = ", ".join(destinos)
    msg.attach(MIMEText(cuerpo_html, "html", "utf-8"))

    try:
        if cfg.smtp_use_ssl:
            with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=30) as smtp:
                if cfg.smtp_user:
                    smtp.login(cfg.smtp_user, cfg.smtp_password)
                smtp.sendmail(msg["From"], destinos, msg.as_string())
        else:
            with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=30) as smtp:
                smtp.starttls()
                if cfg.smtp_user:
                    smtp.login(cfg.smtp_user, cfg.smtp_password)
                smtp.sendmail(msg["From"], destinos, msg.as_string())
    except (smtplib.SMTPException, OSError) as exc:
        log.error("No se pudo enviar el mail: %s", exc)
        return False

    log.info("Mail enviado a %s", ", ".join(destinos))
    return True


def plantilla_resumen(corrida) -> str:  # noqa: ANN001
    """Mismo espíritu que el mail del bot, pero armado desde Postgres."""
    filas = [
        ("Registros procesados", corrida.total),
        ("Con actualizaciones", corrida.cnt_si),
        ("Sin actualizaciones", corrida.cnt_no),
        ("No se pudo obtener", corrida.cnt_ko),
    ]
    cuerpo = "".join(
        f"<tr><td style='padding:8px 16px;background:#4c73f3;color:#fff'>{k}</td>"
        f"<td style='padding:8px 16px'>{v}</td></tr>"
        for k, v in filas
    )
    return (
        "<p>Buenos días:</p>"
        "<p>Resumen de la corrida de consulta de expedientes.</p>"
        "<table style='font-size:inherit;border-collapse:collapse'>"
        f"{cuerpo}</table><p>Saludos.</p>"
    )
