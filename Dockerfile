# syntax=docker/dockerfile:1
#
# Imagen única para las dos cosas que corre este proyecto:
#
#   * el panel web  -> docker-entrypoint.sh server   (Next standalone)
#   * el worker     -> docker-entrypoint.sh worker   (consulta al PJud)
#
# Un solo build y dos contenedores con el mismo image, cambiando sólo el comando.
# En Dokploy son dos servicios apuntando a la misma imagen; en docker-compose están
# como `app` y `worker`.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` y no `npm install`: el lockfile es la fuente de verdad de las versiones.
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# El worker se compila aparte (tsconfig.node.json, CommonJS) porque Node no resuelve
# los alias `@/` que usa Next; por eso los imports de worker/** son relativos.
RUN npm run build && npm run build:worker

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Zona horaria fija. Las fechas de calendario ya viajan como cadena `YYYY-MM-DD`
# (el parser de `lib/db.ts` y `type Dia` del motor), así que el día no depende del host;
# esto es por `timestamptz`: sin TZ el contenedor hereda el del servidor y las horas de
# las corridas se mostrarían distinto según la máquina. UTC = la hora que guarda Postgres.
ENV TZ=UTC

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# --- panel (standalone: server.js + node_modules trazado por Next: next, react, pg,
#     jsonwebtoken, pdfkit, csv-parse) ---
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# --- worker: código compilado + los dos paquetes que Next NO trazó ---
# `nodemailer` y `bcryptjs` no los importa ninguna ruta del sitio (sólo el worker y
# el seed), así que el trazado de Next los ignora y hay que copiarlos a mano. Son de
# cero dependencias, por eso alcanza con la carpeta.
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=deps /app/node_modules/nodemailer ./node_modules/nodemailer
COPY --from=deps /app/node_modules/bcryptjs ./node_modules/bcryptjs

# --- migraciones: las lee el runner de `dist/node/scripts/migrate.js` relativo al cwd ---
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations

COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# Sin comando: el entrypoint decide. `docker run ... node server.js` también funciona.
CMD ["server"]
