"""Configuración por variables de entorno (12-factor).

Todo secreto entra por entorno: en local desde `.env`, en Dokploy desde
las variables del servicio. Nunca hardcodeado ni commiteado.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Base de datos ---
    database_url: str = "postgresql+psycopg://localhost:5432/rocketbot"

    # --- API Poder Judicial ---
    pjud_api_base: str = "https://conexpbe.justucuman.gov.ar/api/proceedings"
    pjud_frontend: str = "https://consultaexpedientes.justucuman.gov.ar/documentos/buscador"
    pjud_sitekey: str = "6LeIn2IsAAAAAKF_7oDVKBPy-sAV2JwIRySx57H6"

    # --- Captcha: none | twocaptcha | playwright ---
    captcha_provider: str = "none"
    twocaptcha_key: str = ""
    twocaptcha_poll_timeout_s: int = 120

    # --- Ritmo de consulta ---
    request_delay_s: float = 3.0
    request_timeout_s: float = 30.0
    max_expedientes_per_run: int = 500

    # --- Mail (opcional) ---
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_ssl: bool = True
    mail_destinatarios: str = ""

    log_level: str = "INFO"

    @property
    def mail_habilitado(self) -> bool:
        return bool(self.smtp_host and self.mail_destinatarios)

    @property
    def destinatarios(self) -> list[str]:
        return [d.strip() for d in self.mail_destinatarios.split(",") if d.strip()]


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()
