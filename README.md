# Expedientes PJud — sistema paralelo

Consulta y seguimiento de expedientes del Poder Judicial de Tucumán, corriendo
como **sistema independiente sobre PostgreSQL**.

> **No reemplaza ni modifica Rocketbot.** El bot sigue funcionando igual, con su
> `ConsultaExpedientesDB.db`, su `config.ini` y su SQL Server `LegajoExpdtes`.
> Este proyecto corre al lado, en su propia base, y no toca ninguno de esos
> archivos. La convivencia es a propósito: si algo falla, el bot sigue operando.

## Estado actual (verificado el 22/10/2026)

- Base `rocketbot` creada en `186.153.163.188:15432` (PostgreSQL 18.6)
- Esquema aplicado con Alembic (`0001_init`, `0002_padron_legado`)
- **Padrón real importado desde `LegajoExpdtes`**:
  - 17 centros judiciales
  - **7.801 expedientes** (2.142 `ACT`, 5.659 `INA`)
  - **114.742 movimientos** históricos
  - 4 expedientes y 1.138 líneas duplicadas en el legado, colapsados por el
    `UNIQUE` (el bot los hubiera duplicado)
- `GET /health`, `/api/resumen`, `/api/corridas`, `/api/expedientes` y el panel: ✅
- Endpoint del PJud probado con **captcha real (2captcha)**:
  - un token sirve para muchos expedientes (no uno por expediente), pero vence a
    los **~2 minutos**: el worker lo renueva solo (`CAPTCHA_TOKEN_TTL_S=90`)
  - corrida real verificada: expediente `762/22` pasó de 220 a **224
    movimientos**, detectó 4 nuevos y quedó en `SI`
  - **corrida 5**: 50 expedientes, `DONE`, 3 `SI` / 47 `NO` / 0 `KO`, 494 s
    (9,8 s por expediente), sin fallos de captcha
- Endpoint del PJud probado: con token inválido devuelve `404` + mensaje
  *"No se puede validar el captcha"*. El sistema renueva el token y reintenta una
  vez; si igual falla, **aborta la corrida** y la marca `FAILED`, sin ensuciar los
  expedientes con `KO` falsos.
- 2captcha devuelve `ERROR_CAPTCHA_UNSOLVABLE` de forma esporádica: se reintenta
  hasta 3 veces con espera antes de abortar.
- Pendiente: corrida masiva de los 3.509 expedientes sin consultar y despliegue
  en Dokploy.

## Arquitectura

```
                    ┌──────────────────────────────┐
                    │  API pública PJud            │
                    │  /api/proceedings            │
                    │  /api/proceedings/history    │
                    └──────────────▲───────────────┘
                                   │ HTTPS
        ┌──────────────────────────┴──────────────────────────┐
        │                     Dokploy                         │
        │  ┌──────────────┐   ┌───────────────┐  ┌─────────┐  │
        │  │ worker       │──▶│  PostgreSQL   │◀─│  api    │  │
        │  │ (corridas)   │   │  expedientes  │  │ FastAPI │  │
        │  └──────────────┘   └───────────────┘  └────┬────┘  │
        └──────────────────────────────────────────────┼──────┘
                                                       │
                                                 panel web
```

Nada de esta arquitectura depende de la red local: el padrón se importa a
Postgres y desde ahí el sistema es autónomo.

## Paridad con el bot Rocketbot

| Bot (`ExtraccionDb`) | Este sistema |
|---|---|
| `ExpdtesCaratula` (SQL Server) | `expedientes` (Postgres) |
| `ExpdtesLineas` (INSERT sin control) | `movimientos` (`UNIQUE (expediente_id, hash_unico)`) |
| `ExpdteActualizado = SI/NO/KO` | `expedientes.actualizado` |
| `config.ini` | variables de entorno |
| logs `.txt` | tabla `corridas` + `corrida_items` + logs JSON |
| sub-bot `EnvioCorreos` | `notificaciones` (outbox) + `mailer` |
| 2captcha en script embebido | `services/captcha.py` (2captcha o Playwright) |
| se corta si falla un expediente | sigue y registra el `KO` con motivo |

## Requisitos

- Python 3.11+ (probado con 3.13)
- PostgreSQL 15+ (probado con 18)
- Opcional: `playwright` para no depender de 2captcha

## Puesta en marcha (local)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

copy .env.example .env      # completar DATABASE_URL
python scripts/create_db.py # crea la base si no existe
alembic upgrade head        # crea las tablas

expedientes seed-demo       # datos de prueba
expedientes stats
uvicorn expedientes.api:app --reload
```

Panel: <http://127.0.0.1:8000/>

## Variables de entorno

Ver `.env.example`. Las importantes:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://user:pass@host:port/rocketbot` |
| `CAPTCHA_PROVIDER` | `none` \| `twocaptcha` \| `playwright` |
| `TWOCAPTCHA_KEY` | solo si usás 2captcha |
| `CAPTCHA_TOKEN_TTL_S` | vida útil del token antes de renovarlo (default 90s) |
| `REQUEST_DELAY_S` | pausa entre requests (default 3s) |
| `MAX_EXPEDIENTES_PER_RUN` | tope por corrida |
| `SMTP_*`, `MAIL_DESTINATARIOS` | envío del resumen |

En Dokploy **no se sube `.env`**: se cargan como variables del servicio.

## Carga del padrón

El padrón real se importa **una sola vez y desde la red local**, porque el SQL
Server no es accesible desde internet. El script lee las credenciales del mismo
`config.ini` de Rocketbot (solo lectura, no lo modifica) y no las imprime:

```powershell
python scripts/importar_padron.py
```

Es idempotente: se puede volver a correr para refrescar carátulas y traer
movimientos nuevos. Importa centros, expedientes e historial deduplicado.

Otras vías, para casos puntuales:

```powershell
# CSV o XLSX
expedientes import-csv padron.csv

# Cadena ODBC explícita (evitar: la contraseña queda en el historial)
expedientes import-sqlserver --conn "DRIVER={ODBC Driver 18 for SQL Server};SERVER=...;DATABASE=LegajoExpdtes;UID=...;PWD=...;TrustServerCertificate=yes"
```

El CSV acepta encabezados como `numero`, `jurisdiccion`, `centro`, `estado`
(también `ExpdteNro`, `CentroJudEquivEndpoint`, `ExpdteEstado`).

## Correr una consulta

```powershell
# Con token manual (útil para probar sin gastar captcha)
expedientes run --limit 10 --token "TOKEN"

# Una corrida completa
expedientes run --limit 500 --notify

# En bucle, cada hora
expedientes worker --interval 3600 --notify
```

## API

| Endpoint | Descripción |
|---|---|
| `GET /health` | estado del servicio y de la base |
| `GET /api/resumen` | totales por resultado |
| `GET /api/corridas` | últimas corridas |
| `GET /api/expedientes?q=&actualizado=KO` | listado con filtros |

## Deploy en Dokploy

> **Nota:** en esta máquina **Git no está instalado**. Para subir el repo a
> GitHub hace falta instalarlo (`winget install Git.Git`) o usar GitHub Desktop.

1. Subir el repo a GitHub.
2. Dokploy → **Create Application** → tipo **Dockerfile** → conectar el repo.
3. Crear un servicio **PostgreSQL** en Dokploy (o usar el existente) y copiar su
   `DATABASE_URL` interna.
4. Variables del servicio `api`: `DATABASE_URL`, `CAPTCHA_PROVIDER`,
   `TWOCAPTCHA_KEY`, `SMTP_*`.
5. Crear un segundo servicio desde el mismo repo, comando
   `expedientes worker --interval 3600 --notify`.
6. Migrar: en el primer deploy del `api`, el comando incluye
   `alembic upgrade head`.
7. Alternativa: Dokploy → **Compose**, apuntando a `docker-compose.yml`.

## Seguridad — pendientes antes de producción

- [ ] **Rotar la contraseña de Postgres** usada durante el desarrollo.
- [ ] No usar el rol superusuario: crear `expedientes_app` con permisos solo
      sobre su base.
- [ ] Restringir el puerto público de Postgres (15432) por firewall; la app debe
      entrar por la red interna de Dokploy.
- [ ] Forzar TLS en la conexión a la base.
- [ ] Mover `TWOCAPTCHA_KEY` y credenciales SMTP a variables del proveedor.

## Fases

- [x] **F1** — esquema, API, panel, worker, idempotencia, importador
- [x] **F2** — corrida real contra el PJud (captcha 2captcha) y detección de
      movimientos nuevos sobre el historial importado
- [ ] **F3** — reintento automático de `KO`, alertas, métricas
- [ ] **F4** — programación diaria y operación en Dokploy

Rocketbot queda como respaldo permanente: no hay fase de retiro.

## Notas operativas

- El sitio del PJud no es una API documentada: cambios de esquema pueden romper
  el parseo. Los `KO` con motivo permiten detectarlo rápido.
- Mantener `REQUEST_DELAY_S` alto (3s) para no saturar el servidor del PJud.
- El captcha es el punto más frágil. Si se consigue acceso oficial, se reemplaza
  `services/captcha.py` sin tocar el resto.
- Se pide **un token cada ~90 s** y se reutiliza en todos los expedientes que se
  puedan consultar antes de que venza (verificado: el PJud lo acepta para
  consultas sucesivas). El logger de `httpx` se silencia para que el token no
  quede en los logs.
- Si el PJud rechaza el token, se pide uno nuevo y se reintenta el mismo
  expediente. Solo si vuelve a fallar se aborta la corrida (lo ya procesado queda
  confirmado y la próxima corrida retoma desde ahí).
