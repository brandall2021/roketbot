"""Crea la base de datos si no existe.

Uso:
    python scripts/create_db.py

Lee ADMIN_DATABASE_URL (o DATABASE_URL) del entorno/.env. La base destino
sale de la ruta de esa URL. Es idempotente.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import psycopg  # noqa: E402

from expedientes.config import settings  # noqa: E402


def main() -> int:
    url = os.environ.get("ADMIN_DATABASE_URL") or settings().database_url
    # SQLAlchemy usa postgresql+psycopg://; psycopg quiere postgresql://
    dsn = url.replace("postgresql+psycopg://", "postgresql://")
    parsed = urlparse(dsn)
    destino = parsed.path.lstrip("/") or "rocketbot"

    if not parsed.hostname:
        print("URL inválida")
        return 1

    admin = dsn.rsplit("/", 1)[0] + "/postgres"
    with psycopg.connect(admin, connect_timeout=10, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (destino,))
            if cur.fetchone():
                print(f"La base '{destino}' ya existe.")
                return 0
            cur.execute(f'CREATE DATABASE "{destino}"')
            print(f"Base '{destino}' creada.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
