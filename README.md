# Vías Seguras: Backend

API REST y renderizado en servidor de la plataforma de **reporte y seguimiento ciudadano de baches y daños viales** (Caso de Estudio 2, Programación Orientada a la Web).

**Autor:** Julian Moreno

- Frontend: carpeta `CASO-DE-ESTUDIO-REPORTE-DE-SEGUIMIENTO-FRONTEND`
- Despliegue (Render + Vercel + pgAdmin): [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)
- Informe del avance: [`docs/INFORME-AVANCE-1.md`](docs/INFORME-AVANCE-1.md)

El código (clases, funciones, variables, archivos y rutas de la API) está en inglés. Los textos que ve el usuario están en español.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Servidor | Node.js 20.12+ · Express 5 |
| Base de datos | PostgreSQL + **PostGIS** (columnas `GEOGRAPHY(Point, 4326)`, índices GIST, `ST_DWithin`) |
| Administración de la base | pgAdmin 4 (local y Render) |
| Hilos | Worker Threads (`WorkerPool`) |
| IA | Groq API, modelo de visión `qwen/qwen3.8-27b`: tipo de daño, riesgo y si la foto muestra una vía |
| Despliegue | Render (API + PostgreSQL) · Vercel (frontend) |

## Puesta en marcha local

### 1. PostgreSQL + PostGIS + pgAdmin 4

En este PC ya están instalados **PostgreSQL 18** y **pgAdmin 4**. Solo falta la extensión PostGIS:

1. Abre **Application Stack Builder** (menú Inicio → PostgreSQL 18).
2. Elige `PostgreSQL 18 on port 5432` → **Spatial Extensions** → **PostGIS 3.x Bundle for PostgreSQL 18** → siguiente hasta terminar.
3. En **pgAdmin 4**: *Servers → PostgreSQL 18 → Databases → clic derecho → Create → Database…* → nombre `vias_seguras`.

No hace falta crear tablas: el backend ejecuta `db/schema.sql` al arrancar. Ese script activa PostGIS (`CREATE EXTENSION postgis`) y crea las tablas, los índices y las vistas del mapa.

### 2. Variables de entorno

```bash
copy .env.example .env
```

En `.env` cambia `TU_CLAVE` por la contraseña del usuario `postgres` que definiste al instalar PostgreSQL:

```
DATABASE_URL=postgres://postgres:TU_CLAVE@localhost:5432/vias_seguras
```

`.env` nunca se sube a GitHub (está en `.gitignore`).

### 3. Ejecutar

```bash
npm install
npm run db:import   # opcional: copia a PostgreSQL los datos de data/db.json y las fotos de public/uploads
npm start           # genera la página SSG y levanta la API en http://localhost:3000
npm run dev         # modo desarrollo (reinicia al guardar)
npm test            # 32 pruebas
```

`GET http://localhost:3000/api/health` responde `"storage": "postgresql+postgis"` cuando está conectado a la base.

Sin `DATABASE_URL` la app también funciona: guarda los datos en `data/db.json`, sin PostGIS. Así se puede probar rápido sin base de datos.

## Cuentas

| Perfil | Cómo registrarse |
|---|---|
| **Ciudadano** | Portada del frontend → *Ciudadano* → *Regístrate* |
| **Funcionario** | Portada → *Funcionario* → *Regístrate* con el **código de invitación** |

El código de funcionario es el valor de `OFFICIAL_INVITE_CODE`:

- **Local:** `ALCALDIA-2026`
- **Render:** el que escribas en la variable `OFFICIAL_INVITE_CODE` al crear el servicio.

## Ver los datos en pgAdmin 4

*Databases → vias_seguras → Schemas → public*:

| Objeto | Contenido |
|---|---|
| Tablas `users`, `incidents`, `reports`, `notifications`, `photos` | Datos de la aplicación |
| Columna `location` en `incidents` y `reports` | Punto PostGIS `GEOGRAPHY(Point, 4326)` calculado a partir de `lat`/`lng` |
| Vista `incidents_map` | Incidentes con su geometría: *View/Edit Data* → icono del ojo en la columna `geom` (**Geometry Viewer**) los dibuja sobre un mapa |
| Vista `reports_map` | Reportes con el nombre del ciudadano y la distancia en metros (`ST_Distance`) a su incidente |

Ejemplo en el **Query Tool**: los incidentes abiertos a menos de 500 m del centro de Bogotá.

```sql
SELECT id, status, round(ST_Distance(location, ST_MakePoint(-74.0817, 4.6097)::geography)) AS metros
FROM incidents
WHERE status NOT IN ('RESOLVED', 'REJECTED')
  AND ST_DWithin(location, ST_MakePoint(-74.0817, 4.6097)::geography, 500)
ORDER BY metros;
```

## Requisitos de la materia

### Patrones de rendering

| URL | Patrón | Detalle |
|---|---|---|
| `/estadisticas/` | **SSG** | HTML generado en `npm run build` (`scripts/build-ssg.js`), que corre antes de `npm start` |
| `/incidentes/:id` | **SSR + ISR** | `IsrCache`: caché de 60 s, *stale-while-revalidate* e invalidación por evento. Cabecera `X-Cache: HIT \| STALE \| MISS` |
| `/api/...` | API para **CSR** | JSON que consume el frontend React |

### Workers

`WorkerPool` (pool de Worker Threads con cola FIFO) ejecuta en hilos aparte el trabajo pesado de CPU:

- `dbscan`: consolidación espacial de reportes duplicados (cada 10 min y desde el panel);
- `analyze-image`: formato real de la foto y GPS del EXIF.

El frontend usa además un **Web Worker** (compresión de fotos) y un **Service Worker** (PWA sin conexión).

### Métricas de rendimiento

| Métrica | Dónde |
|---|---|
| Latencia por ruta p50/p75/p95/p99 y errores | `/api/metrics/summary` → `http` |
| Tiempo de las consultas PostGIS (`ST_DWithin`, bbox) | `/api/metrics/summary` → `database` |
| Workers: tareas, cola, tiempo de ejecución y de espera | `/api/metrics/summary` → `workers` |
| Retraso del event loop y memoria | `/api/metrics/summary` |
| Core Web Vitals de los navegadores (LCP, INP, CLS, FCP, TTFB) | `/api/metrics/summary` → `webVitals` |
| Desglose por petición | Cabecera `Server-Timing` (DevTools → Network → Timing) |
| Todo lo anterior en formato Prometheus | `/metrics` |

### PostGIS

- Al llegar un reporte, `PostgisIncidentRepository.findOpenNear` busca con `ST_DWithin` el incidente abierto más cercano a ≤ 30 m (usa el índice GIST).
- Los filtros por zona del mapa (`bbox`) usan `ST_MakeEnvelope` con el operador `&&`.
- Sin base de datos, `IncidentRepository` hace lo mismo en memoria con la fórmula de haversine. Es el mismo contrato, así que los servicios no cambian (patrón **Repository** + polimorfismo).

## Arquitectura

```
src/
├── domain/          Modelo de dominio (POO): Entity, Coordinate, Report, Incident, User/Citizen/Official,
│                    enumeraciones (DamageCategory, RoadType, IncidentStatus) y estrategias de prioridad
├── clustering/      geo.js (haversine), SpatialGrid (índice espacial), Dbscan
├── images/          Detección de formato y GPS del EXIF (sin librerías)
├── workers/         WorkerPool + task-worker.js
├── repositories/    Repository → InMemoryRepository → repos por agregado
│                    PostgisIncidentRepository (consultas espaciales) · PostgresPersistence · JsonPersistence
├── infrastructure/  Clock, EventBus (Observer), RateLimiter, ImageStorage (disco / PostgreSQL)
├── services/        Casos de uso: Auth, Report, Incident, Heatmap, Consolidation, Notification, Metrics
├── render/          Plantillas SSR/SSG, IsrCache, rutas de páginas
├── http/            Controladores, middlewares, Server-Timing, rutas
├── container.js     Raíz de composición (inyección de dependencias)
├── app.js           Aplicación Express
└── server.js        Arranque y apagado ordenado
scripts/             build-ssg.js (SSG) · import-json.js (data/db.json → PostgreSQL)
db/schema.sql        Esquema PostgreSQL + PostGIS (idempotente, lo ejecuta la app al arrancar)
render.yaml          Blueprint de Render: base de datos + servicio web
test/                Pruebas con node:test (postgis.test.js usa TEST_DATABASE_URL)
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado y tipo de almacenamiento |
| GET | `/api/catalog` | Categorías de daño, tipos de vía, estados, radio de agrupación, centro del mapa |
| POST | `/api/auth/register` | `{ name, email, password }` (ciudadano). Funcionario: `role: 'OFFICIAL', inviteCode` |
| POST | `/api/auth/login` | `{ email, password, role? }` → `{ token, user }` |
| GET | `/api/auth/me` | Usuario de la sesión (`Authorization: Bearer <token>`) |
| POST | `/api/reports` | `{ lat, lng, category, roadType?, description?, clientRequestId? }`: se une a un incidente abierto a ≤ 30 m o abre uno nuevo |
| POST | `/api/reports/batch` | `{ reports: [...] }`: sincronización de reportes hechos sin conexión (idempotente) |
| POST | `/api/reports/:id/photo` | Cuerpo binario `image/jpeg\|png\|webp` (≤ 2 MB), analizado en un Worker |
| GET | `/api/reports/mine` | "Mis reportes" con el estado actual de su incidente |
| GET | `/api/incidents` | Filtros: `status` (o `OPEN`), `category`, `roadType`, `priority`, `bbox=minLat,minLng,maxLat,maxLng`, `sort`, `limit` |
| GET | `/api/incidents/priority-queue` | Orden de atención sugerido |
| GET | `/api/incidents/:id` | Detalle con reportes (sin datos personales) e historial |
| PATCH | `/api/incidents/:id/status` | `{ status, note }` (funcionario). Notifica a quienes reportaron |
| GET | `/api/heatmap?bbox=` | Puntos `[lat, lng, intensidad]` para Leaflet.heat |
| GET | `/api/notifications` | Notificaciones del usuario y número de no leídas |
| GET | `/api/notifications/stream?token=` | Tiempo real con Server-Sent Events |
| PATCH | `/api/notifications/:id/read` | Marcar como leída |
| GET | `/api/admin/summary` | Indicadores del panel (funcionario) |
| POST | `/api/admin/consolidate` | Consolidación DBSCAN en un Worker (funcionario) |
| POST | `/api/metrics/web-vitals` | Web Vitals del navegador (`sendBeacon`) |
| GET | `/api/metrics/summary` · `/metrics` | Métricas en JSON · formato Prometheus |

Errores: `{ error: { code, message, details } }` con el estado HTTP correspondiente (400, 401, 403, 404, 409, 413, 429 con `Retry-After`).

## Variables de entorno

| Variable | Uso | Valor local |
|---|---|---|
| `PORT` | Puerto HTTP | `3000` |
| `DATABASE_URL` | Conexión a PostgreSQL + PostGIS. Vacía = archivo JSON | `postgres://postgres:TU_CLAVE@localhost:5432/vias_seguras` |
| `DATABASE_SSL` | Forzar SSL (`true`/`false`). Vacía = automático | |
| `DATA_PATH` · `UPLOADS_DIR` | Archivo JSON y carpeta de fotos cuando no hay base | `data/db.json` · `public/uploads` |
| `ALLOWED_ORIGINS` | Orígenes CORS separados por coma (admite `https://*.vercel.app`) | `http://localhost:5173` |
| `FRONTEND_URL` · `PUBLIC_BASE_URL` | URL del frontend y del backend | `http://localhost:5173` · `http://localhost:3000` |
| `TRUST_PROXY` | `true` detrás del proxy de Render | `false` |
| `TOKEN_SECRET` | Firma de las sesiones | texto largo y aleatorio |
| `OFFICIAL_INVITE_CODE` | Código para registrar funcionarios | `ALCALDIA-2026` |
| `CLUSTER_RADIUS_M` | Radio de agrupación de reportes | `30` |
| `WORKERS` | Hilos del pool | `2` |
| `CONSOLIDATION_INTERVAL_MS` | Cada cuánto corre DBSCAN (`0` = nunca) | `600000` |
| `PRIORITY_STRATEGY` | `weighted` o `count` | `weighted` |
| `CITY_LAT` · `CITY_LNG` | Centro inicial del mapa | `4.6097` · `-74.0817` |
| `GROQ_API_KEY` | Clave de Groq para analizar las fotos con IA. Vacía = sin IA | `gsk_…` |
| `AI_MODEL` · `AI_TIMEOUT_MS` | Modelo de visión de Groq y tiempo máximo de espera | `qwen/qwen3.8-27b` · `15000` |
