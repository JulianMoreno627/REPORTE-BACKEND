# Arquitectura: hilos, workers, patrones de rendering y contract-first

Este documento explica cómo Vías Seguras cumple los temas de *Programación Orientada a la Web*: **dónde** está cada uno en el código, **por qué** se eligió ese paradigma para esa parte de la aplicación, qué **trade-offs** tiene y **cómo comprobarlo**.

```
                       ┌───────────────────────── Vercel ─────────────────────────┐
 Navegador ──────────► │ SPA React (CSR) · Service Worker (offline) · Web Worker   │
    │                  └──────────────────────────────────────────────────────────┘
    │  JSON (contrato OpenAPI)                    HTML ya renderizado
    ▼                                                      ▼
 ┌──────────────────────────── Render (Node.js, un hilo principal) ────────────────────────────┐
 │ /api/...           → API REST validada con contracts/openapi.json                             │
 │ /incidentes/:id    → SSR + ISR (IsrCache)          /estadisticas/ → SSG (npm run build)        │
 │ WorkerPool (worker_threads): dbscan · analyze-image          Groq / Gemini: I/O asíncrona      │
 └──────────────────────────────────────────────────────────────┬────────────────────────────────┘
                                                                ▼
                                                   Neon PostgreSQL + PostGIS
```

## 1. Manejo de hilos

Node.js ejecuta el JavaScript en **un solo hilo** (el *event loop*). Eso es ideal para **I/O** (consultas a la base, llamadas a Groq/Gemini, respuestas HTTP): mientras se espera, el hilo atiende otras peticiones. Pero un cálculo pesado de **CPU** bloquea el hilo y congela a todos los usuarios.

La regla del proyecto es: **I/O en el hilo principal con `async/await`; CPU en hilos aparte.**

| Trabajo | Tipo | Dónde se ejecuta | Por qué |
|---|---|---|---|
| Consultas a PostgreSQL/PostGIS | I/O | Hilo principal (`pg.Pool`, máx. 5 conexiones) | Esperar a la red no ocupa CPU |
| Análisis de la foto con Groq / Gemini | I/O | Hilo principal (`fetch` con `AbortSignal.timeout`) | Moverlo a un Worker solo agregaría costo de copia sin ganar nada |
| Consolidación DBSCAN de reportes | CPU (O(n log n) con índice espacial) | **Worker Thread** | Con miles de puntos tarda lo suficiente para bloquear el event loop |
| Leer el formato real y el GPS del EXIF | CPU (recorrer bytes) | **Worker Thread** | Se hace en cada foto; no debe frenar las demás peticiones |
| Comprimir la foto en el celular | CPU | **Web Worker** del navegador con `OffscreenCanvas` | Mantiene la interfaz fluida mientras se procesa la imagen |

**Cómo se mide:** `/api/metrics/summary` reporta el **retraso del event loop** (`eventLoopDelayMs`), y por cada tarea de los workers el tiempo de ejecución y el tiempo de espera en la cola (`workers`).

## 2. Manejo de workers

### Backend: `WorkerPool` (`src/workers/WorkerPool.js`)

- Crea un número fijo de hilos (`WORKERS`, 1 en Render por su 0,1 CPU) **una sola vez** y los reutiliza: crear un hilo por petición sería caro.
- Las tareas esperan en una **cola FIFO**; cuando un hilo queda libre toma la siguiente.
- Cada tarea es un mensaje `{ id, type, payload }` y el hilo responde `{ id, ok, result | error }` (`src/workers/task-worker.js`). La promesa de `pool.run(type, payload)` se resuelve o rechaza con esa respuesta.
- Si un hilo muere, el pool lo retira, rechaza su tarea y crea otro (tolerancia a fallos).
- Al apagar el servidor (`SIGTERM`), el pool termina los hilos de forma ordenada.

**Tareas:** `dbscan` (cada 10 min y desde el panel del funcionario) y `analyze-image` (cada foto).

**Trade-offs:** los datos se **copian** entre hilos (*structured clone*), así que solo conviene para trabajo de CPU que tarde más que esa copia; con 0,1 CPU en Render, más de un hilo no da más velocidad, solo más memoria.

### Frontend

| Worker | Archivo | Qué hace |
|---|---|---|
| Web Worker | `src/workers/compress.worker.js` | Redimensiona (máx. 1600 px) y comprime la foto a JPEG, y copia el segmento EXIF para no perder el GPS |
| Service Worker | `public/sw.js` | Caché de la app para usarla sin conexión y *Background Sync* de los reportes guardados en IndexedDB |

## 3. Patrones clásicos de rendering

Cada parte de la aplicación usa el patrón que mejor encaja con **qué tan seguido cambian sus datos** y **quién la consume**.

| Patrón | URL | Paradigma (dónde se genera el HTML y cuándo) | Por qué aquí |
|---|---|---|---|
| **CSR** | Toda la SPA en Vercel (`/mapa`, `/reportar`, `/panel`…) | El servidor entrega un HTML casi vacío y JavaScript; **el navegador** pide JSON a la API y dibuja la interfaz | Pantallas muy interactivas (mapa, formularios, tiempo real) y personales (requieren sesión) |
| **SSR** | `/incidentes/:id` en el backend | **El servidor** arma el HTML completo **en cada petición** con los datos actuales | Página pública para compartir un incidente: llega lista, se indexa y se previsualiza en redes |
| **SSG** | `/estadisticas/` | El HTML se genera **una vez, al compilar** (`npm run build`, que corre antes de `npm start`) y se sirve como archivo estático | Resumen general que no necesita estar al segundo; servirlo cuesta casi cero |
| **ISR** | `/incidentes/:id` (sobre el SSR) | Se sirve la versión SSR guardada y **se regenera en segundo plano** cuando vence (60 s) o cuando un evento la invalida | Combina la velocidad del estático con datos casi en tiempo real |

### Trade-offs

| | CSR | SSR | SSG | ISR |
|---|---|---|---|---|
| Primera pintura (FCP/LCP) | Lenta: descargar JS y luego pedir datos | Rápida | La más rápida | Rápida (HIT/STALE) |
| Frescura de los datos | Siempre actual | Siempre actual | Solo hasta el último build | Hasta 60 s, o al instante por invalidación |
| Costo en el servidor | Bajo (solo JSON) | Alto: renderiza en cada visita | Casi nulo | Bajo: renderiza una vez por ventana |
| SEO y vista previa al compartir | Pobre | Buena | Buena | Buena |
| Interactividad | Total | Requiere JS adicional | Requiere JS adicional | Requiere JS adicional |
| Funciona sin conexión | Sí, con Service Worker | No | Sí, si se cachea | No |

### Cómo funciona el ISR (`src/render/IsrCache.js`)

1. **MISS:** no hay copia → se renderiza (SSR), se guarda y se responde.
2. **HIT:** la copia tiene menos de 60 s → se responde de inmediato.
3. **STALE:** la copia venció → se responde **la copia vieja** y se regenera en segundo plano (*stale-while-revalidate*). Si llegan varias visitas a la vez, solo se hace un render (se comparte la promesa pendiente).
4. **Invalidación por evento:** cuando cambia el estado de un incidente, llega una foto o DBSCAN une incidentes, el `EventBus` (patrón Observer) borra la copia y la siguiente visita ve el cambio.

**Comprobar:**

```bash
curl -sI https://vias-seguras-api.onrender.com/incidentes/<id> | grep -iE "x-render-pattern|x-cache|server-timing"
# X-Render-Pattern: SSR+ISR · X-Cache: MISS → HIT → STALE
```

El panel del funcionario muestra los aciertos del caché (`isrCache`: hits, stale, misses, invalidations).

## 4. Contract-first development

El contrato **`contracts/openapi.json`** (OpenAPI 3.1) se escribe **antes** que el código. Backend y frontend se construyen contra él.

| Paso | Implementación |
|---|---|
| Diseño del contrato | Cada operación con `operationId`, parámetros, seguridad (`bearerAuth`, `x-role`), esquema de la petición y de cada respuesta, incluidos los errores |
| Validación en ejecución | `src/http/contract.js` compila los esquemas con Ajv; `validateBody('createReport')` rechaza con `400 VALIDATION_ERROR` lo que no cumpla, antes del controlador |
| Pruebas de contrato | `test/contract.test.js`: (1) toda ruta de Express existe en el contrato y viceversa; (2) las respuestas reales de todo el flujo cumplen los esquemas |
| Documentación | `GET /api/openapi.json` y `GET /api/docs` (Swagger UI) |

**Trade-offs:** cuesta más al inicio (diseñar el contrato antes de programar) y obliga a actualizarlo con cada cambio; a cambio, frontend y backend pueden trabajar en paralelo, los errores de integración aparecen en las pruebas y no en producción, y la documentación nunca queda desactualizada porque las pruebas fallan si se desvía.

## 5. Dónde verlo funcionando

| Qué | Dónde |
|---|---|
| Contrato y documentación | `https://vias-seguras-api.onrender.com/api/docs` |
| SSG | `https://vias-seguras-api.onrender.com/estadisticas/` |
| SSR + ISR | `https://vias-seguras-api.onrender.com/incidentes/<id>` (cabeceras `X-Cache`, `Server-Timing`) |
| Métricas (event loop, workers, latencias, Web Vitals) | `https://vias-seguras-api.onrender.com/api/metrics/summary` |
| Workers en acción | Panel del funcionario → **Consolidar** (DBSCAN en un Worker Thread) |
