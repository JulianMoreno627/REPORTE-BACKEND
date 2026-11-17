# Despliegue: Neon (PostgreSQL/PostGIS) · Render (API) · Vercel (frontend) · pgAdmin 4

```
 Navegador ──► Vercel (frontend React/Vite) ──► Render Web Service (backend) ──► Neon PostgreSQL + PostGIS
                                                                                     ▲
                                                             pgAdmin 4 (tu PC) ──────┘  misma URL (SSL)
```

| Parte | Dónde | Costo |
|---|---|---|
| Frontend | Vercel | Gratis |
| Backend | Render Web Service | Gratis (se duerme tras 15 min sin uso; la primera petición tarda ~1 min) |
| Base de datos | Neon PostgreSQL con PostGIS | Gratis y **sin vencimiento** (0,5 GB; la base se pausa sin uso y despierta en la primera consulta) |
| IA | Groq + Gemini (respaldo) | Gratis con límites por minuto y por día |

Cada proyecto va en su propio repositorio de GitHub, porque Render y Vercel despliegan desde Git. `.gitignore` excluye `.env`, `node_modules/`, `data/` y `public/uploads/`, así que **las contraseñas y los datos locales no se suben**.

## 1. Base de datos en Neon

1. En <https://console.neon.tech> crea un proyecto:
   - *Project name*: `vias-seguras`
   - *Postgres version*: la más reciente
   - *Region*: **AWS US East (N. Virginia)**, la más cercana a Render (Virginia)
   - *Database name*: `vias_seguras`
2. En **Connect** copia la *connection string* **sin** la opción *Connection pooling* (conexión directa). Tiene la forma `postgresql://usuario:clave@ep-xxx.us-east-1.aws.neon.tech/vias_seguras?sslmode=require`.

**PostGIS no se instala a mano:** Neon lo trae disponible y el backend, al arrancar, ejecuta `db/schema.sql`, que hace `CREATE EXTENSION IF NOT EXISTS postgis` y crea las tablas, los índices GIST y las vistas.

### Copiar los datos desde otra base (por ejemplo, Render)

En el `.env` local del backend pon temporalmente:

```
SOURCE_DATABASE_URL=<External Database URL de la base de origen>
DATABASE_URL=<connection string de Neon>
```

y ejecuta `npm run db:copy`. El script crea el esquema en Neon y copia `users`, `incidents`, `reports`, `notifications` y `photos` (no duplica filas si se ejecuta dos veces). Después borra esas dos líneas del `.env` si no quieres trabajar contra Neon en local.

## 2. Backend en Render

1. En <https://dashboard.render.com>: **New → Web Service** con el repositorio del backend (o **New → Blueprint**, que lee `render.yaml`).
   - *Build Command*: `npm ci` · *Start Command*: `npm start` · *Health Check Path*: `/api/health`
2. Variables de entorno:

   | Variable | Valor |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `DATABASE_URL` | Connection string de Neon |
   | `TOKEN_SECRET` | Texto largo y aleatorio (si cambia, se cierran todas las sesiones) |
   | `OFFICIAL_INVITE_CODE` | El código con el que se registrarán los funcionarios (invéntalo y guárdalo) |
   | `PUBLIC_BASE_URL` | `https://<servicio>.onrender.com` |
   | `TRUST_PROXY` | `true` |
   | `WORKERS` | `1` |
   | `ALLOWED_ORIGINS` | `https://<tu-app>.vercel.app,https://*.vercel.app` |
   | `FRONTEND_URL` | `https://<tu-app>.vercel.app` |
   | `CITY_LAT` · `CITY_LNG` | Centro del mapa (Pasto: `1.2136` · `-77.2811`) |
   | `GROQ_API_KEY` | Clave de <https://console.groq.com/keys> (IA principal) |
   | `GEMINI_API_KEY` | Clave de <https://aistudio.google.com/apikey> (respaldo si Groq falla) |

Comprobar: `https://<servicio>.onrender.com/api/health` debe responder `"storage":"postgresql+postgis"` y en `"ai"` los modelos activos, por ejemplo `"qwen/qwen3.8-27b → gemini-3.5-flash-lite"`.

## 3. Conectar pgAdmin 4 a Neon

1. En Neon abre **Connect** y copia host (`ep-…aws.neon.tech`), base, usuario y contraseña.
2. En pgAdmin 4: **Servers → Register → Server…**
   - *General → Name*: `Vías Seguras (Neon)`
   - *Connection*: host, puerto `5432`, *Maintenance database* = `vias_seguras`, usuario y contraseña (marca **Save password**)
   - *Parameters*: `SSL mode` = `require`
3. Los datos están en **Databases → vias_seguras → Schemas → public**. Las vistas `incidents_map` y `reports_map` se ven sobre un mapa con el **Geometry Viewer** (icono del ojo en la columna `geom`).

Si la base estaba pausada, la primera conexión tarda unos segundos.

## 4. Frontend en Vercel

1. En <https://vercel.com/new> importa el repositorio del frontend. `vercel.json` ya define el build (`npm run build` → `dist/`) y la redirección de rutas.
2. En **Environment Variables** agrega `VITE_API_URL` = `https://<servicio>.onrender.com` (sin `/` final).
3. **Deploy**. Si cambias `VITE_API_URL` después, haz **Redeploy** (Vite la incrusta en el build).
4. Vuelve a Render y confirma que `ALLOWED_ORIGINS` y `FRONTEND_URL` tengan la URL de Vercel.

## 5. Primer uso

1. Abre la URL de Vercel.
2. **Funcionario → Regístrate** con el `OFFICIAL_INVITE_CODE` que configuraste en Render.
3. **Ciudadano → Regístrate** con otra cuenta, crea un reporte y revisa la fila en `reports_map` desde pgAdmin.

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| «No pudimos conectar con el servidor» | `VITE_API_URL` mal escrita, o el servicio de Render está despertando |
| Error de CORS en la consola | Falta la URL de Vercel en `ALLOWED_ORIGINS` |
| `PostGIS no está instalado en el servidor PostgreSQL` | Local: instala PostGIS con Stack Builder (ver README) |
| `self-signed certificate` / `SSL required` | Agrega `?sslmode=require` a la URL de Neon o fuerza `DATABASE_SSL=true` |
| `[pg] Se cerró una conexión inactiva` en los logs | Normal con Neon: la base se pausó; la siguiente consulta abre otra conexión |
| `"ai":"disabled"` en `/api/health` | No hay `GROQ_API_KEY` ni `GEMINI_API_KEY` en Render |
| Todas las sesiones se cerraron | Cambió `TOKEN_SECRET` |
| «Código de invitación de funcionario inválido» | El código no coincide con `OFFICIAL_INVITE_CODE` de ese entorno |
