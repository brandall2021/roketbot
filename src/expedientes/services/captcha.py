"""Obtención del token reCAPTCHA que exige la API del PJud.

Dos proveedores intercambiables por configuración:

  * twocaptcha  -> servicio pago (el que usa hoy Rocketbot)
  * playwright  -> resuelve el captcha en un navegador headless e intercepta
                   el token de la request. No tiene costo por consulta.

`none` deja el sistema arrancable para desarrollo, pero el worker avisa
que no puede consultar.
"""

from __future__ import annotations

import logging
import time

import httpx

from ..config import settings

log = logging.getLogger(__name__)


class CaptchaError(RuntimeError):
    pass


def obtener_token() -> str:
    proveedor = settings().captcha_provider.lower().strip()
    if proveedor == "twocaptcha":
        return _token_twocaptcha()
    if proveedor == "playwright":
        return _token_playwright()
    raise CaptchaError(
        "CAPTCHA_PROVIDER='none': configurá 'twocaptcha' o 'playwright' para consultar."
    )


# --------------------------------------------------------------------------
# 2captcha
# --------------------------------------------------------------------------
def _token_twocaptcha() -> str:
    cfg = settings()
    if not cfg.twocaptcha_key:
        raise CaptchaError("Falta TWOCAPTCHA_KEY")

    with httpx.Client(timeout=30) as http:
        resp = http.post(
            "https://2captcha.com/in.php",
            data={
                "key": cfg.twocaptcha_key,
                "method": "userrecaptcha",
                "googlekey": cfg.pjud_sitekey,
                "pageurl": cfg.pjud_frontend,
                "invisible": 1,
                "json": 1,
            },
        )
        payload = _json(resp)
        if payload.get("status") != 1:
            raise CaptchaError(f"2captcha rechazó la tarea: {payload}")
        task_id = payload["request"]
        log.info("2captcha: tarea %s encolada", task_id)

        limite = time.monotonic() + cfg.twocaptcha_poll_timeout_s
        while time.monotonic() < limite:
            time.sleep(5)
            payload = _json(
                http.get(
                    "https://2captcha.com/res.php",
                    params={
                        "key": cfg.twocaptcha_key,
                        "action": "get",
                        "id": task_id,
                        "json": 1,
                    },
                )
            )
            if payload.get("status") == 1:
                return str(payload["request"])
            if payload.get("request") != "CAPCHA_NOT_READY":
                raise CaptchaError(f"2captcha falló: {payload}")

    raise CaptchaError("2captcha: timeout esperando el token")


def _json(resp: httpx.Response) -> dict:
    try:
        return resp.json()
    except ValueError as exc:
        raise CaptchaError(f"Respuesta inválida de 2captcha: {resp.text[:200]}") from exc


# --------------------------------------------------------------------------
# Playwright (experimental)
# --------------------------------------------------------------------------
def _token_playwright() -> str:
    """Abre el buscador, hace una consulta y captura el token de la API.

    Requiere: pip install playwright && playwright install chromium
    Es el mismo enfoque del prototipo `consulta_expedientes.py`, pero acá
    el token se devuelve al worker en vez de quedar en un script aparte.
    """
    cfg = settings()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover
        raise CaptchaError(
            "Playwright no instalado: pip install playwright && playwright install chromium"
        ) from exc

    capturado: dict[str, str | None] = {"token": None}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_context().new_page()

            def on_request(request) -> None:  # noqa: ANN001
                if "api/proceedings" in request.url and "captcha=" in request.url:
                    from urllib.parse import parse_qs, urlparse

                    token = parse_qs(urlparse(request.url).query).get("captcha", [None])[0]
                    if token:
                        capturado["token"] = token

            page.on("request", on_request)
            page.goto(cfg.pjud_frontend, wait_until="networkidle", timeout=45_000)
            # TODO: ajustar selectores cuando se valide contra el sitio real.
            page.wait_for_timeout(3_000)
            if not capturado["token"]:
                raise CaptchaError(
                    "Playwright no pudo capturar el token: revisar los selectores del buscador."
                )
            return str(capturado["token"])
        finally:
            browser.close()
