#!/bin/sh
# Entrypoint de la imagen unificada.
#
# Decide según el primer argumento:
#   server              -> migrar (si toca) y arrancar el panel
#   worker              -> arrancar el worker en bucle
#   cualquier comando   -> correrlo tal cual (migrate, seed, stats, sh, node ...)
#
# Las migraciones corren SIEMPRE antes del panel, y sólo desde el panel: si el worker
# también las corriera, dos contenedores que arrancan juntos ejecutarían ALTER TABLE
# en paralelo sobre las mismas tablas.

set -e

MIGRAR="${MIGRAR_AL_INICIAR:-1}"

case "${1:-server}" in
  server)
    if [ "$MIGRAR" = "1" ]; then
      echo "[entrypoint] aplicando migraciones"
      node dist/node/scripts/migrate.js || {
        echo "[entrypoint] las migraciones fallaron: se corta acá, no arranca un panel con esquema viejo"
        exit 1
      }
    else
      echo "[entrypoint] MIGRAR_AL_INICIAR=0: se saltea la migración"
    fi
    if [ "${SEED_AL_INICIAR:-0}" = "1" ]; then
      echo "[entrypoint] seed de administrador (idempotente)"
      node dist/node/scripts/seed.js || echo "[entrypoint] el seed falló; el panel arranca igual"
    fi
    exec node server.js
    ;;

  worker)
    # El worker NO migra: depende del esquema que dejó el panel. Si el panel todavía
    # no migró, la primera corrida falla y el bucle reintenta en el próximo ciclo.
    echo "[entrypoint] worker de corridas (cada ${WORKER_INTERVALO_S:-3600}s)"
    exec node dist/node/worker/cli.js worker
    ;;

  *)
    exec "$@"
    ;;
esac
