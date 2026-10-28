# Expedientes del Poder Judicial de Tucumán

Un solo proyecto donde antes había dos:

- **juridico** (Next.js): el panel web — login con usuarios y roles, importación de
  CSV, grilla de expedientes con filtros, KPIs, gráficos, export a CSV y PDF, y los
  maestros de centros, provincias y carátula.
- **roketbot** (Python + FastAPI): el motor que consulta el padrón al Poder Judicial
  (PJud), resuelve el captcha, guarda los movimientos nuevos y deja registro de cada
  corrida.

Hoy es **Next.js + PostgreSQL**. El Python se portó a TypeScript (`lib/engine/` y
`worker/`), el `dashboard.html` de FastAPI se borró y el SQL Server quedó afuera: la
base de verdad es la que ya tenía el bot en Dokploy, con el padrón importado
(17 centros, 7.801 expedientes, 114.742 movimientos).

**Este repo (`brandall2021/roketbot`) es el proyecto unificado.** El árbol Python siguió
viviendo acá hasta la unificación: el código viejo no se borró de la historia, está en
`main` hasta el tag **`python-legado`** (`git checkout python-legado` lo levanta intacto,
con su `pyproject.toml`, sus migrations de Alembic y su dashboard de FastAPI). `main` de
ahora es la app de Next. El panel que estaba en `brandall2021/juridico` quedó ahí como
historia del port; el deploy se hace desde este repo.

---

## Stack

Next.js 14 · React 18 · TypeScript 5 · PostgreSQL 16 (`pg`) · bcryptjs + JWT en cookie ·
nodemailer · pdfkit · recharts · vitest · Docker.

No hay ORM: las queries van en SQL directo sobre un pool de `pg` (`lib/db.ts`), y el
esquema se administra con `migrations/*.sql`.

---

## Arquitectura

```
app/                     Capa HTTP de Next (páginas + rutas de API)
  api/**                 24 rutas, todas sobre PostgreSQL
  corridas/**            seguimiento de corridas (rol ADMIN, sólo lectura)
  expedientes/[id]       ficha de un expediente con sus movimientos
worker/                  Procesos de Node, sin Next
  corrida.ts             un ciclo: abrir corrida -> consultar -> cerrar corrida
  cli.ts                 run | worker | retry-ko | stats
lib/
  engine/                Motor portado del bot (sin dependencias de Next)
    pjud.ts              cliente del PJud: formatos de fecha, huellas, filtrado
    captcha.ts           2captcha + TokenManager (TTL y renovación)
    ingest.ts            lecturas/alta: pendientes, movimientos, resultado
  db.ts                  pool de `pg`, consultar/consultarUno/ejecutar, transacciones
  config.ts              lectura de variables de entorno, normalización de DATABASE_URL
  corridas.ts            lecturas compartidas por las páginas (el worker también usa)
  mailer.ts              resumen por mail + registro en `notificaciones`
  auth.ts / sesion.ts    JWT, roles, guard de página
  consulta.ts / expedientes.ts / csv.ts / rutas.ts   listados, alta, CSV, helpers HTTP
components/              UI (AppShell, CorridasUI, gráficos)
migrations/              esquema en SQL, idempotente
tests/                   vitest (Node, sin base real)
```

El orden de dependencias es estricto: **el worker importa de `lib/` y nunca al revés**;
las páginas de Next no importan `worker/*` (si lo hicieran, `nodemailer` entraría en el
bundle del navegador). Por eso el worker se compila aparte con `tsconfig.node.json`
(CommonJS, `dist/node`) y no usa el alias `@/`.

---

## Modelo de fechas (importante)

Una fecha de calendario — el día de un movimiento — **nunca** es un `Date` en este
proyecto: es la cadena `YYYY-MM-DD` (`type Dia` en `lib/engine/pjud.ts`). Los tres puntos
por donde entra la zona horaria, y cómo se cerró cada uno:

- **Lectura.** `lib/db.ts` reemplaza el parser de `pg` para el OID `1082` (`date`): la
  columna llega como texto, no como `Date` a medianoche local. Mezclar eso con una fecha
  parseada del PJud (medianoche UTC) producía un desfase de un día según la `TZ`.
- **Escritura.** `parseFecha` del CSV devuelve la cadena ya normalizada. Un `Date` a
  medianoche UTC se serializa con los componentes **locales** de `pg`: con
  `TZ=America/Argentina/Buenos_Aires` el día se guardaba uno antes.
- **Comparación y huella.** Con cadenas, el ordering lexicográfico es el ordering del
  calendario y `hash_unico` no cambia aunque cambie la zona del contenedor.

La validación de calendario es obligatoria en las dos rutas de parseo (`31/02/2024` y
`13/13/13` dan `null`, no la fecha rolada que `Date.UTC` inventa): una línea con fecha
basura que llega al `INSERT` tumbaría el expediente entero y lo marcaría KO.

`timestamptz` sigue siendo instante (`Date`); para que el panel muestre la misma hora que
guardó Postgres, el Dockerfile fija `TZ=UTC`.

---

## Esquema

Una sola base. Lo que había antes:

| Legado | Ahora |
|---|---|
| `LegajoExpdtes.dbo.ExpdtesCaratula` (SQL Server) | `expedientes` |
| `LegajoExpdtes.dbo.ExpdtesLineas` (XML `Historia`) | `movimientos` (una fila por movimiento, deduplicada por huella) |
| `LegajoExpdtes.dbo.CentrosJudiciales` | `centros_judiciales` |
| `LegajoExpdtes.dbo.Provincias` | `provincias` |
| `dbo.app_usuarios` | `usuarios` |
| `dbo.app_cargas` | `cargas` |
| `dbo.app_expedientes` | **desaparece**: era una copia de auditoría del alta. El registro es la fila de `expedientes`, con `origen_carga` y `creado_por` |

Tablas del bot que se conservan tal cual: `corridas`, `corrida_items`,
`tokens_captcha`, `notificaciones`. La vista `vista_expedientes` deja el expediente plano
(centro, unidad, provincia, `total_movimientos`) para que el panel no repita el join en
cada filtro, KPI y gráfico.

Dos columnas de estado que se confunden fácil:

- `expedientes.estado` → estado procesal (`ACT` / `INA`). **Por esto el worker elige a consultar.**
- `expedientes.actualizado` → resultado de la última consulta al PJud (`SI` / `NO` / `KO`).

`migrations/` corre en orden y una sola vez, con registro en `schema_migrations`:

- `0001_unificar_esquema.sql` — tablas, columnas nuevas, trigger de `updated_at`, vista.
- `0002_datos_derivados.sql` — provincia, `estado_nombre` y `documento` derivados de lo que ya estaba importado.
- `0003_programacion_corridas.sql` — configuración persistente de periodicidad que consume el worker.
- `0004_solicitudes_corrida_individual.sql` — cola persistente para pedidos de corrida por expediente desde la carátula.
- `0005_worker_heartbeat.sql` — pulso del worker para probar su estado desde el panel sin consulta al PJud.

Ambos archivos son idempotentes (`IF NOT EXISTS` / `OR REPLACE` / `WHERE ... IS NULL`),
así que corren igual sobre la base del bot con datos y sobre una vacía, y se pueden
reejecutar sin pisar lo que cargó un usuario.

Borradores (así están las claves foráneas): mover un centro no huérfana expedientes
(`centro_id` es `ON DELETE SET NULL`), borrar un expediente se lleva sus movimientos
(`CASCADE`) y deja `corrida_items` con `expediente_id` en NULL: el historial de esa corrida
queda, aunque la ficha ya no exista.

---

## Flujo de una corrida

```
corridas (RUNNING)
  └─ por expediente pendiente (estado='ACT', fch_ult_proc ASC NULLS FIRST, id ASC, LIMIT n)
       ├─ TokenManager.get()        -> token de reCAPTCHA (se reutiliza, TTL 90 s)
       ├─ PjudClient.historial()    -> stories en bruto
       ├─ filtrarNuevas()           -> sólo los movimientos más recientes que fch_ult_mov
       ├─ INSERT movimientos         ON CONFLICT (expediente_id, hash_unico) DO NOTHING
       ├─ UPDATE expedientes        fch_ult_mov / ult_mov_desc
       └─ corrida_items             SI | NO | KO
cerrarCorrida(DONE | FAILED, cnt_si, cnt_no, cnt_ko)  ->  mail de resumen (opcional)
```

Reglas del bot que se conservaron **por su comportamiento probado**, no por nostalgia:

- **TTL del token 90 s.** El reCAPTCHA dura ~2 minutos y es reutilizable: se resuelve una
  vez y se usa para muchos expedientes. Sin esto, la corrida gastaba un captcha por
  expediente.
- **`REQUEST_DELAY_S=3` entre requests.** Es un acuerdo implícito con el servidor del
  PJud. Bajarlo no consulta más rápido: arriesga que corten el acceso.
- **`MAX_EXPEDIENTES_PER_RUN=500`.** Techo por corrida: acota cuántos créditos de captcha
  se pueden gastar en un ciclo y deja `corridas` con un registro acotado, en vez de una
  corrida que corre horas sin cerrar.
- **Dedupe por huella.** `hash_unico = sha256(fecha + "|" + descripcion.trim().lower())`,
  con `UNIQUE(expediente_id, hash_unico)`. La fórmula es idéntica a la de Python, así que
  los 114.742 movimientos ya importados no se duplican. El `INSERT` multi-fila usa
  `ON CONFLICT DO NOTHING RETURNING id`: `SI` recién si hubo insert reales.
- **Ante `CaptchaInvalido`, se renueva el token y se reintenta ese expediente una vez.**
  Si vuelve a fallar se **aborta la corrida** (`FAILED`): seguir marcaría todo KO sin
  haber consultado nada, y esos KO no son recuperables como datos.
- **`parseFechaPjud` valida calendario.** Rechaza `31/02`, `29/02` de año no bisiesto y
  basura tipo `13/13/13`. Un `INSERT` con fecha inválida tiraba y el expediente entero
  pasaba a KO por una línea basura.

El historial de **Corridas** es de sólo lectura. Desde el enlace **Programar corridas**
del menú de administración se activa/pausa la ejecución periódica y se elige su intervalo.
La configuración queda en PostgreSQL; el worker residente la consulta sin depender de
que el panel siga abierto. En `/caratula`, el administrador también puede encolar una
consulta para el expediente de una fila; el worker procesa esa cola y deja el resultado
en Corridas aunque se cierre la página.

---

## Requisitos

Node 20+, npm 10+ y acceso a un PostgreSQL. No hace falta Docker para desarrollar.

## Desarrollo local

### 1. Variables de entorno

Copiar `.env.example` a `.env` y completar. Está todo explicado ahí; lo obligatorio:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena PostgreSQL. Se acepta el formato viejo del bot (`postgresql+psycopg://`); `lib/config.ts` la normaliza. Con la base fuera del host, `?sslmode=require` |
| `JWT_SECRET` | Obligatorio. Rotarla invalida todas las sesiones |
| `ADMIN_PASSWORD` | Para el seed; en producción se rechazan las conocidas (mínimo 10 caracteres) |

`CAPTCHA_PROVIDER=none` deja el motor sin resolver captcha: se puede probar todo el panel
y el worker con `--token` sin gastar créditos.

### 2. Instalar y correr

```bash
export NODE_OPTIONS=--use-system-ca   # si npm necesita el certificado de la CA del sistema
npm install
npm run migrate                       # aplica migrations/*.sql
npm run seed                          # crea el administrador (idempotente)
npm run dev                           # http://localhost:3000
```

### 3. Scripts

| Comando | Hace |
|---|---|
| `npm run dev` / `build` / `start` / `lint` | Next de siempre |
| `npm run typecheck` | `tsc --noEmit` sobre la app |
| `npm test` | `vitest run` — 122 tests, sin base real (`vi.mock`) |
| `npm run migrate` | aplica las migraciones pendientes |
| `npm run migrate -- status` / `-- --dry` | estado sin tocar nada / qué aplicaría |
| `npm run seed` | alta del administrador inicial |
| `npm run build:worker` | `tsc -p tsconfig.node.json` → `dist/node` |
| `npm run corrida -- --limit 50` | una corrida y corta |
| `npm run corrida -- --expediente 123` | consulta sólo el ID interno 123 |
| `/caratula` → **Correr** | encola desde el panel la consulta del expediente de esa fila |
| `npm run worker -- --interval 21600 --limit 200` | residente; programa cada 6 h, hasta 200 expedientes por corrida |

### 4. Worker y CLI

El worker no necesita Next: se lo puede correr directo con `tsx` o desde la imagen
compilada.

```bash
npx tsx worker/cli.ts run --limit 50 --notify    # una corrida del padrón
npx tsx worker/cli.ts run --expediente 123       # sólo el expediente con ID interno 123
npx tsx worker/cli.ts worker --interval 21600 --limit 200 # configura cada 6 horas y deja el worker residente
npx tsx worker/cli.ts retry-ko --corrida 12       # reintenta los KO de una corrida
npx tsx worker/cli.ts stats                        # resumen de la base
```

`--expediente` recibe el **ID interno numérico** que aparece en la URL de la ficha (`/expedientes/123`), no el número de carátula. El worker residente revisa la programación de PostgreSQL cada 15 segundos. La migración inicial programa una corrida inmediata y luego la periodicidad elegida; al guardar desde el panel, la próxima corrida queda para un intervalo después del guardado. `--interval` actualiza la configuración persistida y requiere que las migraciones estén aplicadas.

El token se puede pasar con `--token` o por `CAPTCHA_TOKEN`; **no** lo escribas en un
script commiteado ni lo subas a un issue.

### 5. Usuarios y roles

`ADMIN` ve todo, incluidos `/corridas` y `/usuarios`; `USER` trabaja con expedientes. La
barrera real está en cada ruta (`requireAuth`/`requireAdmin`) y en `sesionAdmin()` /
`sesionRequerida()` de las páginas: el menú es cosmético, y `middleware.ts` sólo hace la
primera criba (existe la cookie). Públicas: `/login`, `/api/auth/login`,
`/api/auth/logout` y `/api/health` — esta última porque el healthcheck de Dokploy no tiene
sesión, y no devuelve más que `{ok, base}`.

---

## CSV de importación

`/expedientes/importar` (maestro de expedientes) y `/expedientes/actualizar` (sólo campos
de estado) aceptan `,` o `;` como separador, BOM, y si el UTF-8 no cierra leen latin1
(los acentos y la ñ de un Excel argentino). Las cabeceras se reconocen por sinónimos del
legado, en `HEADER_ALIASES` de `lib/csv.ts`:

```
Centro Judicial;Unidad Judicial;Expdte;Carátula;Actor;Demandado;Estado;Fecha;Descripcion;Documento;Fecha Procesado;Estado Actualizado
```

Cuidado con `Estado`, que es la trampa del legado: **`Estado` = estado procesal**
(`ACT`/`INA`), mientras que el resultado de la consulta (`SI`/`NO`/`KO`) entra por
`Estado Actualizado` o `ExpdteActualizado`. Un archivo con las dos columnas usa la primera
que calce; lo fija `tests/csv.test.ts`.

Un archivo se previewa y después se inserta en una transacción, con el resultado
registrado en `cargas` (leídos, insertados, duplicados, errores por fila).

**Fechas.** `DD/MM/AAAA`, `DD/MM/AA`, `DD-MM-AAAA` o ISO; se normalizan a `YYYY-MM-DD` y
una que no calza (o que no existe en el calendario) **rechaza la fila** con mensaje legible
en vez de guardar `NULL` y perder la fecha.

**Escape de fórmulas.** Toda celda del CSV exportado va entrecomillada y, si arranca con
`= + - @ TAB CR`, se le prefija `'` (`escaparCelulaCsv` en `lib/rutas.ts`). Sin esto, un
valor como `=HYPERLINK(...)` se ejecuta al abrir el archivo en Excel o LibreOffice.

---

## API

Rutas con guard de sesión; las de escritura y las de maestros requieren `ADMIN` donde el
legado lo requería. Respuestas de error unificadas: `{ error: "..." }` con `400` de validación
propia, `409` de conflicto (unicidad / clave foránea), `500` genérico — nunca se manda el
mensaje de Postgres al navegador.

| Ruta | Método | Descripción |
|---|---|---|
| `/api/health` | GET | `200 {ok:true}` / `503 {ok:false}` según la base. **Única ruta sin sesión** (healthcheck del orquestador); sin detalle en la respuesta |
| `/api/auth/login` `/logout` `/me` | POST/POST/GET | sesión, rate-limited en login |
| `/api/usuarios` `/[id]` | GET/POST/PUT/DELETE | usuarios y roles |
| `/api/expedientes` | GET | listado con filtros, `q`, orden y paginación (cap 200) |
| `/api/expedientes/[id]` | GET/DELETE | `{expediente, movimientos}`; el parámetro es el **número**, con `?centro=&unidad=` para desambiguar |
| `/api/expedientes/nuevo` | POST | alta de un expediente |
| `/api/expedientes/kpis` `/charts` | GET | métricas y gráficos del dashboard |
| `/api/expedientes/import/preview` `/import` | POST | preview e inserción del CSV maestro |
| `/api/expedientes/actualizar/preview` `/actualizar` | POST | actualización masiva de estado |
| `/api/expedientes/cargados` | GET | auditoría de lo cargado por la app (`origen_carga` no nulo) |
| `/api/expedientes/cargas` | GET | archivos subidos |
| `/api/expedientes/export` | GET | CSV / PDF (`format=csv\|pdf`) |
| `/api/caratula` | GET | búsqueda de carátula, con alias del shape legado (`ExpdteNro`, ...) |
| `/api/caratula/[id]` | GET/PUT/DELETE | una carátula; el `PUT` escribe por la lista blanca de `actualizarExpediente` |
| `/api/centros` `/[id]` | GET/POST/PUT/DELETE | maestro de centros |
| `/api/provincias` `/[id]` | GET/POST/PUT/DELETE | maestro de provincias |

---

## Estado verificado (22/10/2026)

Datos de la base real, medida sobre `rocketbot` en `186.153.163.188:15432`
(PostgreSQL 18.6 en Dokploy):

- 17 centros judiciales, **7.801 expedientes** (2.142 `ACT`, 5.659 `INA`) y
  **114.742 movimientos** históricos importados de `LegajoExpdtes`.
- El `UNIQUE (numero, jurisdiccion)` y el de huellas colapsaron 4 expedientes y
  1.138 líneas duplicadas que el legado traía repetidas.
- Corrida real contra el PJud con captcha de 2captcha: el expediente `762/22` pasó
  de 220 a **224 movimientos** detectando los 4 nuevos y quedó en `SI`.
- Corrida de 50 expedientes: `DONE`, 3 `SI` / 47 `NO` / 0 `KO`, 494 s
  (≈9,8 s por expediente con `REQUEST_DELAY_S=3`), sin fallos de captcha.
- **Pendiente**: quedan ~3.509 expedientes sin consultar (los que nunca tuvieron
  `fch_ult_proc`); el worker los toma en tandas de `MAX_EXPEDIENTES_PER_RUN`.

> **Rocketbot (el bot de escritorio) no es este repo.** Ese sigue funcionando con su
> `ConsultaExpedientesDB.db`, su `config.ini` y el SQL Server `LegajoExpdtes`, como
> respaldo permanente: no hay fase de retiro. Acá vive el sistema paralelo que ahora
> también es el panel.

---

# Docker y Dokploy

## Una imagen, dos servicios

`Dockerfile` en tres etapas (deps → builder con `next build` + `build:worker` → runner
`node:20-alpine` con `standalone`). El `docker-entrypoint.sh` decide el rol por el primer
argumento:

| Comando | Rol |
|---|---|
| `server` (default) | migraciones si `MIGRAR_AL_INICIAR=1` → seed opcional → Next |
| `worker` | `node dist/node/worker/cli.js worker` — **no** migra, para no correr `ALTER TABLE` en paralelo con el otro servicio |

En el runner se copian `node_modules/nodemailer` y `node_modules/bcryptjs` a mano: Next no
los trazó en `standalone` porque sólo los usa el worker y el seed.

`docker-compose.yml` levanta `db` (Postgres 16, healthcheck, sin puertos publicados),
`app` y `worker`. Sirve para probar localmente; en Dokploy la base ya existe y se apunta
por `DATABASE_URL`.

`deploy.replicas: 1` en `worker` es obligatorio: dos réplicas duplicarían los requests al
PJud y el gasto de captcha.

## Deploy

1. **Base**: la del bot ya está en Dokploy —`186.153.163.188:15432`, base
   `rocketbot`, PostgreSQL 18.6— con el padrón importado. La `DATABASE_URL` del panel
   y la del worker son la misma cadena, apuntando a la red interna del host:
   `postgresql://<rol>:<pass>@<host>:15432/rocketbot?sslmode=require`.
2. **Servicio `app`**: Application → este repo (`brandall2021/roketbot`), rama `main`,
   Dockerfile, comando `server`. Variables: `DATABASE_URL`, `JWT_SECRET`,
   `MIGRAR_AL_INICIAR=1`, y `SEED_AL_INICIAR=1` **sólo el primer arranque**.
3. **Servicio `worker`**: misma imagen/repo, comando `worker`. Variables: `DATABASE_URL`,
    `CAPTCHA_PROVIDER=twocaptcha`, `TWOCAPTCHA_KEY`, `REQUEST_DELAY_S`, `MAX_EXPEDIENTES_PER_RUN`,
    la programación guardada desde el panel, y `SMTP_*` si querés el resumen por mail. **No necesita
   `JWT_SECRET`**: no levanta el panel ni lee sesiones.
4. **Dominio**: `app` al puerto 3000 detrás del proxy de Dokploy (TLS con Let's Encrypt).
   El `worker` no expone puerto.
5. **Redespliegue**: el webhook de Dokploy por push. Después del primer arranque, bajar
   `SEED_AL_INICIAR` a `0`.

Antes el deploy de juridico estaba bloqueado porque ningún Dokploy alcanzaba la LAN
`192.168.35.222:1433` donde vivía el SQL Server. Con PostgreSQL ese bloqueo desaparece:
la base y las apps están en el mismo host.

## Comprobación post-deploy

```bash
curl -s https://<dominio>/api/health      # {"ok":true,"base":true}
```

Es la única API pública (el healthcheck del orquestador no tiene cookie) y no revela nada
que el sitio público no revele: `{ok, base}` y el detalle del error se queda en el log.

Entrar al panel, ver `/corridas` con el historial del bot (las `corridas` que ya están
son del Python: mismo esquema, misma tabla), abrir una y de ahí un expediente.

## Solución de problemas

- **`DATABASE_URL environment variable is required`**: falta o `lib/config.ts` no la
  normalizó; aceptar el formato `postgresql+psycopg://` del bot es intencional.
- **El worker no avanza**: el log dice `CAPTCHA_PROVIDER='none': configurá 'twocaptcha'`.
  Con proveedor `playwright` tira que no está portado a Node: ese proveedor necesita un
  navegador y se quedó en Python.
- **Corrida `FAILED` con `CaptchaInvalido`**: no es un bug, es el abort diseñado. Verificar
  la clave de 2captcha y el saldo; para los KO ya registrados, `retry-ko` con `--token` manual.
- **Mail no llega**: sin `SMTP_HOST` o sin `MAIL_DESTINATARIOS` la corrida termina igual;
  el resumen queda registrado en `notificaciones` con estado `ERROR`.
- **Las fechas del panel salen un día corrimadas**: no debería pasar (ver "Modelo de
  fechas"); si aparece, es que alguna lectura nueva está tomando la columna como `Date`.

---

## Checklist de seguridad

Lo que se arrastra del bot y lo que agregó el port. Ninguna de estas cosas está resuelta
"por el framework": hay que hacerlas en el host.

- [ ] **Rotar la contraseña de Postgres** (`POSTGRES_PASSWORD` / la del rol de la app). La
      base quedó expuesta durante el desarrollo del bot.
- [ ] **Rol dedicado, sin superusuario**: el panel y el worker necesitan `SELECT/INSERT/
      UPDATE` sobre las tablas propias, no `CREATEDB` ni acceso a `pg_catalog`.
- [ ] **Firewall sobre `15432`**: la base no debe escuchar en la interfaz pública. En
      compose no se publica ningún puerto; en Dokploy, revisar que el `db` tampoco.
- [ ] **TLS**: `sslmode=require` en `DATABASE_URL` cuando Postgres está fuera del host. El
      cliente **siempre verifica el certificado** — `no-verify` en la cadena se ignora a
      propósito y hay que mandar la CA por `NODE_EXTRA_CA_CERTS`. `rejectUnauthorized:
      false` está prohibido en este repo.
- [ ] **Secretos sólo por variables de entorno**: nunca en un archivo commiteado, nunca en
      un issue, nunca en un log. `TWOCAPTCHA_KEY`, `JWT_SECRET`, `SMTP_PASSWORD` y el token
      de captcha (que viaja en la query del PJud) son secretos.
- [ ] **Rotar `JWT_SECRET`** si se compartió o si se cree que una sesión se filtró.
- [ ] **No commitear `.env`**: está en `.gitignore` (junto con `.env.local` y
      `.env.*.local`). Antes de cada commit, revisar que no aparezca.
- [ ] **Contraseña de admin fuerte** desde el seed: en producción `ADMIN_PASSWORD` es
      obligatoria y se rechazan las conocidas.

---

## Referencia del legado

Para el que venga detrás: el SQL Server seguía teniendo `[LegajoExpdtes].[dbo].[goolge2]`
como vista de consulta, `ExpdtesCaratula` como maestro, `ExpdtesLineas` con el historial
en XML y claves tipo `ExpdteId/ExpdteNro`. Las rutas de carátula aliasan esas claves
(`CARATULA_SELECCION` en `lib/rutas.ts`) para no haber tenido que reescribir
`app/caratula/page.tsx`. Todo lo demás ya habla el nombre de columna de Postgres.
