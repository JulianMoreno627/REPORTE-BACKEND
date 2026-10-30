# Despliegue: Render (API + PostgreSQL/PostGIS) · Vercel (frontend) · pgAdmin 4

```
 Navegador ──► Vercel (frontend React/Vite) ──► Render Web Service (backend) ──► Render PostgreSQL + PostGIS
                                                                                     ▲
                                                             pgAdmin 4 (tu PC) ──────┘  URL externa
```

| Parte | Dónde | Costo |
|---|---|---|
| Frontend | Vercel | Gratis |
| Backend | Render Web Service | Gratis (se duerme tras 15 min sin uso; la primera petición tarda ~1 min) |
| Base de datos | Render PostgreSQL con PostGIS | Gratis por 30 días (después: plan de pago o copia con pgAdmin) |

Cada proyecto va en su propio repositorio de GitHub, porque Render y Vercel despliegan desde Git. `.gitignore` excluye `.env`, `node_modules/`, `data/` y `public/uploads/`, así que **las contraseñas y los datos locales no se suben**.

## 1. Base de datos y backend en Render

1. En <https://dashboard.render.com>: **New → Blueprint** y elige el repositorio del backend.
2. Render lee `render.yaml` y crea:
   - `vias-seguras-db`: PostgreSQL (plan free);
   - `vias-seguras-api`: servicio web Node, con `DATABASE_URL` conectada a la base y `TOKEN_SECRET` generado.
3. Completa las variables que pide:

   | Variable | Valor |
   |---|---|
   | `OFFICIAL_INVITE_CODE` | El código con el que se registrarán los funcionarios (invéntalo y guárdalo) |
   | `ALLOWED_ORIGINS` | `https://<tu-app>.vercel.app,https://*.vercel.app` |
   | `FRONTEND_URL` | `https://<tu-app>.vercel.app` |
   | `GROQ_API_KEY` | Clave de <https://console.groq.com/keys> (análisis de fotos con IA; vacía = sin IA) |

   Si todavía no tienes la URL de Vercel, pon un valor provisional y cámbialo después en **Environment**.
4. Si el servicio quedó con otro nombre, corrige `PUBLIC_BASE_URL` con la URL real (`https://<servicio>.onrender.com`).

**PostGIS no se instala a mano:** en el primer arranque el backend ejecuta `db/schema.sql`, que hace `CREATE EXTENSION IF NOT EXISTS postgis` y crea las tablas, los índices GIST y las vistas.

Comprobar: `https://<servicio>.onrender.com/api/health` debe responder `{"status":"ok","storage":"postgresql+postgis",...}`.

## 2. Conectar pgAdmin 4 a la base de Render

1. En Render abre la base → **Connect → External Connection** y copia host (`dpg-…-a.oregon-postgres.render.com`), puerto `5432`, base, usuario y contraseña.
2. En pgAdmin 4: **Servers → Register → Server…**
   - *General → Name*: `Vías Seguras (Render)`
   - *Connection*: host, puerto `5432`, *Maintenance database* = nombre de la base, usuario y contraseña (marca **Save password**)
   - *Parameters*: `SSL mode` = `require`
3. Los datos están en **Databases → vias_seguras → Schemas → public**. Las vistas `incidents_map` y `reports_map` se ven sobre un mapa con el **Geometry Viewer** (icono del ojo en la columna `geom`).

Si Render limita las conexiones externas (**Access Control**), agrega la IP de tu PC.

Para pasar tus datos locales a Render: pon la *External Database URL* en `DATABASE_URL` de tu `.env` y ejecuta `npm run db:import`.

## 3. Frontend en Vercel

1. En <https://vercel.com/new> importa el repositorio del frontend. `vercel.json` ya define el build (`npm run build` → `dist/`) y la redirección de rutas.
2. En **Environment Variables** agrega `VITE_API_URL` = `https://<servicio>.onrender.com` (sin `/` final).
3. **Deploy**. Si cambias `VITE_API_URL` después, haz **Redeploy** (Vite la incrusta en el build).
4. Vuelve a Render y confirma que `ALLOWED_ORIGINS` y `FRONTEND_URL` tengan la URL de Vercel.

## 4. Primer uso

1. Abre la URL de Vercel.
2. **Funcionario → Regístrate** con el `OFFICIAL_INVITE_CODE` que configuraste en Render.
3. **Ciudadano → Regístrate** con otra cuenta, crea un reporte y revisa la fila en `reports_map` desde pgAdmin.

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| «No pudimos conectar con el servidor» | `VITE_API_URL` mal escrita, o el servicio de Render está despertando |
| Error de CORS en la consola | Falta la URL de Vercel en `ALLOWED_ORIGINS` |
| `PostGIS no está instalado en el servidor PostgreSQL` | Local: instala PostGIS con Stack Builder (ver README) |
| `self-signed certificate` / `SSL required` | Fuerza `DATABASE_SSL=true` (URL externa) o `false` (URL interna) |
| Todas las sesiones se cerraron | Cambió `TOKEN_SECRET` |
| «Código de invitación de funcionario inválido» | El código no coincide con `OFFICIAL_INVITE_CODE` de ese entorno |
