"""Interfaz de línea de comandos.

    expedientes init-db
    expedientes import-csv padron.csv
    expedientes import-sqlserver --conn "DRIVER={ODBC Driver 18 for SQL Server};..."
    expedientes run --limit 50
    expedientes worker --interval 3600
    expedientes stats
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from sqlalchemy import func, select

from .config import settings
from .db import Base, SessionLocal, engine
from .models import CentroJudicial, Corrida, Expediente, Movimiento
from .services import ingest
from .worker import run_cycle, token_para_corrida

log = logging.getLogger("expedientes")


def _init_db() -> None:
    import expedientes.models  # noqa: F401  (registra las tablas en el metadata)

    Base.metadata.create_all(engine)
    print("Esquema creado/verificado.")


def _seed_demo() -> None:
    _init_db()
    with SessionLocal() as session:
        if not session.scalar(select(CentroJudicial).limit(1)):
            session.add_all(
                [
                    # Códigos nulos: los reales los trae el padrón del legado.
                    CentroJudicial(nombre="Demo Capital", codigo_endpoint=None),
                    CentroJudicial(nombre="Demo Monteros", codigo_endpoint=None),
                ]
            )
            session.commit()
        for numero in ("0001/2024", "0002/2024", "0003/2024"):
            ingest.upsert_expediente(session, numero=numero, jurisdiccion=11)
        session.commit()
    print("Datos de demostración cargados.")


def _stats() -> None:
    with SessionLocal() as session:
        total = session.scalar(select(func.count()).select_from(Expediente)) or 0
        movs = session.scalar(select(func.count()).select_from(Movimiento)) or 0
        corridas = session.scalar(select(func.count()).select_from(Corrida)) or 0
        por_resultado = dict(
            session.execute(
                select(Expediente.actualizado, func.count()).group_by(Expediente.actualizado)
            ).all()
        )
    print(f"Expedientes: {total}")
    print(f"Movimientos: {movs}")
    print(f"Corridas:    {corridas}")
    print(f"Resultados:  {por_resultado}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="expedientes", description=__doc__)
    sub = parser.add_subparsers(dest="comando", required=True)

    sub.add_parser("init-db", help="crea el esquema")
    sub.add_parser("seed-demo", help="carga datos de prueba")
    sub.add_parser("stats", help="resumen de la base")

    p_csv = sub.add_parser("import-csv", help="importa padrón desde CSV/XLSX")
    p_csv.add_argument("ruta")

    p_sql = sub.add_parser("import-sqlserver", help="importa desde LegajoExpdtes (LAN)")
    p_sql.add_argument("--conn", required=True, help="cadena ODBC de SQL Server")

    p_run = sub.add_parser("run", help="ejecuta una corrida")
    p_run.add_argument("--limit", type=int, default=None)
    p_run.add_argument("--token", default=None, help="token manual (evita el captcha)")
    p_run.add_argument("--notify", action="store_true")

    p_worker = sub.add_parser("worker", help="corre en bucle")
    p_worker.add_argument("--interval", type=int, default=3600, help="segundos entre corridas")
    p_worker.add_argument("--limit", type=int, default=None)
    p_worker.add_argument("--notify", action="store_true")

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, settings().log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    )

    if args.comando == "init-db":
        _init_db()
    elif args.comando == "seed-demo":
        _seed_demo()
    elif args.comando == "stats":
        _stats()
    elif args.comando == "import-csv":
        with SessionLocal() as session:
            resultado = ingest.importar_archivo(session, args.ruta)
        print(resultado)
    elif args.comando == "import-sqlserver":
        with SessionLocal() as session:
            resultado = ingest.importar_desde_sqlserver(session, args.conn)
        print(resultado)
    elif args.comando == "run":
        token = args.token or token_para_corrida()
        with SessionLocal() as session:
            corrida_id = run_cycle(session, token=token, limite=args.limit, notificar=args.notify)
        print(f"Corrida {corrida_id} finalizada.")
    elif args.comando == "worker":
        token = args.token if hasattr(args, "token") else None
        while True:
            try:
                with SessionLocal() as session:
                    corrida_id = run_cycle(
                        session,
                        token=token or token_para_corrida(),
                        limite=args.limit,
                        notificar=args.notify,
                    )
                print(f"Corrida {corrida_id} finalizada. Próxima en {args.interval}s.")
            except KeyboardInterrupt:
                raise
            except Exception as exc:  # noqa: BLE001
                log.exception("La corrida falló: %s", exc)
            time.sleep(args.interval)

    return 0


if __name__ == "__main__":
    sys.exit(main())
