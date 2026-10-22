"""Importa el padrón real desde el SQL Server legado (LegajoExpdtes).

Se corre **una sola vez y en la red local**, porque el SQL Server no es
accesible desde internet. Después de esto, Postgres es la fuente de verdad y
el sistema funciona autónomo.

Las credenciales no van por parámetro ni se imprimen: se leen del mismo
`config.ini` que usa Rocketbot (solo lectura, no se modifica).

Uso:
    python scripts/importar_padron.py
    python scripts/importar_padron.py --config "D:\\ruta\\config.ini"
    python scripts/importar_padron.py --sin-historial   # solo carátulas
"""

from __future__ import annotations

import argparse
import configparser
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from expedientes.db import SessionLocal  # noqa: E402
from expedientes.services.ingest import importar_desde_sqlserver  # noqa: E402

CONFIG_POR_DEFECTO = Path(r"C:\ConsultaExpedientesDB\config.ini")


def construir_connection_string(ruta_config: Path) -> str:
    cp = configparser.ConfigParser()
    if not cp.read(ruta_config, encoding="utf-8"):
        raise FileNotFoundError(f"No se pudo leer {ruta_config}")
    if "COMUN" not in cp:
        raise KeyError(f"{ruta_config} no tiene la sección [COMUN]")

    c = cp["COMUN"]
    return (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={c['servidor']};DATABASE={c['database']};"
        f"UID={c['user_db']};PWD={c['pass_db']};"
        "TrustServerCertificate=yes;Encrypt=no;"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=CONFIG_POR_DEFECTO)
    parser.add_argument(
        "--sin-historial",
        action="store_true",
        help="no importar ExpdtesLineas (solo carátulas)",
    )
    args = parser.parse_args()

    conexion = construir_connection_string(args.config)
    print(f"Importando desde {args.config} ...")

    with SessionLocal() as session:
        resumen = importar_desde_sqlserver(
            session, conexion, incluir_historial=not args.sin_historial
        )

    print("\nResultado:")
    for clave, valor in resumen.items():
        print(f"  {clave:20s} {valor}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
