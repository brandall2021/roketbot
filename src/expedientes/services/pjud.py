"""Cliente de la API pública del Poder Judicial de Tucumán.

Replica el flujo del bot Rocketbot, pero con manejo de errores explícito:

    1) GET /api/proceedings?jurisdiction=..&number=..&captcha=TOKEN  -> procid
    2) GET /api/proceedings/history?jurisdiction=..&proceeding=procid -> stories

Las funciones puras (parse_fecha, hash_movimiento, filtrar_nuevas) están
separadas del transporte HTTP para poder testearlas sin red.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)


class PjudError(RuntimeError):
    """Error al consultar la API del PJud."""


class CaptchaInvalido(PjudError):
    """El PJud rechazó el token. No tiene sentido seguir con la corrida."""


# --------------------------------------------------------------------------
# Helpers puros
# --------------------------------------------------------------------------
_FORMATOS_FECHA = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y")


def parse_fecha(valor: str | None) -> date | None:
    """Convierte las fechas del PJud (DD/MM/YYYY o YYYY-MM-DD) a date."""
    if not valor:
        return None
    limpio = str(valor).strip()[:10]
    for fmt in _FORMATOS_FECHA:
        try:
            return datetime.strptime(limpio, fmt).date()
        except ValueError:
            continue
    log.warning("Fecha no reconocida: %r", valor)
    return None


def hash_movimiento(fecha: date | None, descripcion: str | None) -> str:
    """Huella estable de un movimiento, para no insertarlo dos veces.

    No depende del número de expediente (lo aporta la FK). Tampoco del
    `histid`: el historial importado del legado no lo tiene, y si lo
    incluyéramos el mismo movimiento entraría dos veces (una desde el legado
    y otra desde la API).
    """
    partes = [
        fecha.isoformat() if fecha else "",
        (descripcion or "").strip().lower(),
    ]
    return hashlib.sha256("|".join(partes).encode("utf-8")).hexdigest()


def filtrar_nuevas(
    stories: list[dict[str, Any]], desde: date | None
) -> list[dict[str, Any]]:
    """Devuelve los movimientos posteriores a `desde` (ordenados asc).

    Si `desde` es None (expediente sin historial previo), devuelve todos.
    """
    nuevas: list[dict[str, Any]] = []
    for story in stories or []:
        f = parse_fecha(story.get("fecha"))
        if f is None:
            continue
        if desde is None or f > desde:
            nuevas.append(story)
    nuevas.sort(key=lambda s: parse_fecha(s.get("fecha")) or date.min)
    return nuevas


# --------------------------------------------------------------------------
# Cliente HTTP
# --------------------------------------------------------------------------
class PjudClient:
    def __init__(
        self,
        base_url: str | None = None,
        delay_s: float | None = None,
        timeout_s: float | None = None,
    ) -> None:
        cfg = settings()
        self.base_url = (base_url or cfg.pjud_api_base).rstrip("/")
        self.delay_s = cfg.request_delay_s if delay_s is None else delay_s
        self.timeout_s = timeout_s or cfg.request_timeout_s
        self._http = httpx.Client(
            timeout=self.timeout_s,
            headers={
                "User-Agent": "expedientes-pjud/0.1 (+sistema interno)",
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> PjudClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        # Pausa deliberada: no saturar el servidor del PJud.
        if self.delay_s:
            time.sleep(self.delay_s)
        try:
            resp = self._http.get(url, params=params)
        except httpx.HTTPError as exc:
            raise PjudError(f"Error de red: {exc}") from exc

        if resp.status_code >= 400:
            # El PJud devuelve 404 con un mensaje útil (p. ej. captcha inválido).
            mensaje = ""
            try:
                cuerpo = resp.json()
                if isinstance(cuerpo, dict):
                    mensaje = str(cuerpo.get("message") or "")
            except ValueError:
                pass
            if "captcha" in mensaje.lower():
                raise CaptchaInvalido(mensaje)
            detalle = f"HTTP {resp.status_code}"
            raise PjudError(f"{detalle}: {mensaje}" if mensaje else detalle)
        try:
            return resp.json()
        except ValueError as exc:
            raise PjudError(f"Respuesta no JSON en {url}") from exc

    def buscar_procid(
        self, numero: str, jurisdiccion: int, token: str
    ) -> int | str | None:
        """Paso 1: número de expediente -> procid interno del PJud."""
        payload = self._get(
            self.base_url,
            {
                "jurisdiction": jurisdiccion,
                "page": 1,
                "unit": "",
                "number": numero,
                "actor": "",
                "accused": "",
                "captcha": token,
            },
        )
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            return None
        primero = data[0]
        if not isinstance(primero, dict):
            return None
        return primero.get("procid")

    def historial(self, jurisdiccion: int, procid: int | str) -> list[dict[str, Any]]:
        """Paso 2: procid -> lista de movimientos (stories)."""
        payload = self._get(
            f"{self.base_url}/history",
            {"jurisdiction": jurisdiccion, "proceeding": procid},
        )
        data = payload.get("data")
        if not isinstance(data, dict):
            return []
        stories = data.get("stories") or []
        return [s for s in stories if isinstance(s, dict)]

    def consultar(
        self, numero: str, jurisdiccion: int, token: str, desde: date | None
    ) -> tuple[bool, list[dict[str, Any]]]:
        """Flujo completo. Devuelve (encontrado, movimientos_nuevos)."""
        procid = self.buscar_procid(numero, jurisdiccion, token)
        if procid is None:
            return False, []
        stories = self.historial(jurisdiccion, procid)
        return True, filtrar_nuevas(stories, desde)
