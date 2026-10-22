# Informe del Avance 1: Backend

**Caso de Estudio 2:** Reporte y seguimiento ciudadano de baches y daños viales
**Materia:** Programación Orientada a la Web
**Autor:** Julian Moreno
**Fecha:** 14 de octubre de 2026 (actualizado el 20 de octubre de 2026)

## 1. Alcance del avance

El proyecto se divide en dos repositorios: **backend** (este) y **frontend**. En este avance el backend ya implementa:

| Funcionalidad del caso | Estado | Dónde |
|---|---|---|
| Reporte ciudadano (ubicación, categoría, tipo de vía, descripción) | ✅ | `ReportService.create`, `POST /api/reports` |
| Foto del reporte con verificación de metadatos GPS | ✅ | `ReportService.attachPhoto`, `images/imageAnalysis.js` |
| Clustering geoespacial a 30 m (haversine) | ✅ | `IncidentRepository.findOpenNear`, `Incident.addReport` |
| Consolidación con DBSCAN en segundo plano | ✅ | `clustering/Dbscan.js`, `ConsolidationService` |
| Mapa de calor de prioridad | ✅ | `HeatmapService`, `GET /api/heatmap` |
| Prioridad: cantidad, antigüedad, tipo de vía y severidad | ✅ | `domain/priority/` |
| Estados reportado → en revisión → en reparación → resuelto | ✅ | `IncidentStatus`, `Incident.changeStatus` |
| Panel administrativo con filtros (zona, tipo, prioridad) | ✅ API | `GET /api/incidents`, `/api/admin/*` |
| Notificaciones al cambiar el estado | ✅ | `NotificationService`, SSE en `/api/notifications/stream` |
| Límite de reportes por usuario y por IP | ✅ | `SlidingWindowRateLimiter` |
| Sincronización de reportes sin conexión (PWA) | ✅ API | `POST /api/reports/batch` con `clientRequestId` |
| PostgreSQL + PostGIS (`ST_DWithin`, índices GIST, vistas para pgAdmin) | ✅ | `db/schema.sql`, `PostgisIncidentRepository` |

Pruebas: **27 pruebas automáticas** (`npm test`), todas pasando (la de PostGIS se ejecuta con `TEST_DATABASE_URL`).

## 2. Programación Orientada a Objetos

### 2.1 Los cuatro pilares

- **Encapsulamiento:** todas las entidades usan campos privados de JavaScript (`#status`, `#reportIds`...). El estado de un `Incident` solo cambia con `changeStatus()` o `addReport()`, que validan las reglas. Nadie puede asignar `incident.status = 'RESOLVED'` desde fuera.
- **Abstracción:** `Repository`, `ImageStorage`, `PriorityStrategy` y `User` son clases abstractas (lanzan `TypeError` si se instancian con `new.target`). Los servicios dependen de ellas, no de la implementación.
- **Herencia:** `Entity` → `Report`, `Incident`, `User`, `Notification`. `Enumeration` → `DamageCategory`, `RoadType`, `IncidentStatus`. `DomainError` → `ValidationError`, `NotFoundError`, `TooManyRequestsError`...
- **Polimorfismo:** `Citizen` y `Official` responden distinto a `canManageIncidents()`. Los servicios preguntan al objeto en lugar de hacer `if (role === ...)`. Cada estrategia de prioridad implementa `evaluate()` a su manera.

### 2.2 Patrones de diseño aplicados

| Patrón | Clase | Para qué |
|---|---|---|
| **Repository** | `Repository`, `InMemoryRepository`, `IncidentRepository`, `PostgisIncidentRepository` | Aislar el almacenamiento. Con PostGIS las consultas espaciales cambian de implementación y los servicios no se tocan |
| **Strategy** | `WeightedPriorityStrategy`, `ReportCountPriorityStrategy` | Cambiar el criterio de prioridad con `PRIORITY_STRATEGY` |
| **Template Method** | `PriorityStrategy.result()` | Todas las estrategias comparten la escala de niveles y la regla "cerrado = 0" |
| **Observer** | `EventBus` | Los servicios publican eventos; notificaciones y caché ISR reaccionan sin acoplarse |
| **Factory Method** | `User.create()`, `Incident.open()`, `createPriorityStrategy()` | Construir la subclase o el estado inicial correctos |
| **State machine** | `IncidentStatus` | Transiciones válidas declaradas en un solo lugar |
| **Value Object** | `Coordinate` | Inmutable, se compara por valor y sabe calcular distancias |
| **Aggregate Root** | `Incident` | Mantiene centroide, categoría dominante y lista de reportantes consistentes |
| **Inyección de dependencias** | `container.js` | Raíz de composición. Las pruebas inyectan `FixedClock`, datos en memoria y carpeta temporal |
| **Object Pool** | `WorkerPool` | Reutilizar hilos en lugar de crearlos por petición |

### 2.3 Capas

```
HTTP (controladores, middlewares)  →  Servicios (casos de uso)  →  Dominio (reglas)
                                           ↓
                              Repositorios · Infraestructura · Workers
```

El dominio no importa nada de Express ni del sistema de archivos, así que se puede probar de forma aislada (`test/domain.test.js`).

## 3. Workers

### 3.1 En el backend: Worker Threads (implementado)

Node.js atiende todas las peticiones en un solo hilo (event loop). Si ese hilo hace un cálculo pesado, toda la API se congela. Por eso el trabajo intensivo de CPU se envía a **Worker Threads**:

| Tarea | Por qué en un worker |
|---|---|
| `dbscan`: clustering de todos los reportes abiertos | Es O(n log n) con miles de puntos. Se ejecuta cada 10 min y bajo demanda |
| `analyze-image`: formato real y GPS del EXIF | Recorre los bytes de cada foto subida |

`WorkerPool` crea N hilos la primera vez que se usan, mantiene una **cola FIFO**, reemplaza un hilo si muere y mide el tiempo de ejecución y de espera de cada tarea. Esos datos se ven en `/api/metrics/summary → workers`.

Además, DBSCAN usa un **índice espacial de rejilla** (`SpatialGrid`) con celdas del tamaño del radio. Cada punto solo se compara con las 9 celdas vecinas, no con todos los demás puntos. En la prueba, **5.000 puntos se agrupan en ~45 ms**.

### 3.2 En el frontend (siguiente avance, la API ya está lista)

- **Web Worker** para comprimir la foto en el navegador (`OffscreenCanvas`) sin congelar la interfaz, conservando el GPS del EXIF. El servidor rechaza fotos de más de 2 MB.
- **Service Worker (PWA)**: caché del shell de la app y de las teselas del mapa, y una cola de reportes hechos sin conexión que se envía con Background Sync a `POST /api/reports/batch`. El `clientRequestId` evita duplicados si el envío se reintenta.

## 4. Métricas de rendimiento

| Métrica | Cómo se obtiene | Dónde se ve |
|---|---|---|
| Latencia por ruta (p50, p75, p95, p99) y errores 5xx | Middleware `instrumentation` + `RollingSample` | `/api/metrics/summary`, `/metrics` |
| Desglose del tiempo de servidor | Cabecera **`Server-Timing`** (ej. `query;dur=1.5, total;dur=3.1`) | DevTools → Network → Timing; el frontend la lee con `PerformanceResourceTiming.serverTiming` |
| Retraso del event loop (media, p99, máx.) | `perf_hooks.monitorEventLoopDelay` | `/api/metrics/summary` |
| Memoria (RSS, heap) | `process.memoryUsage()` | `/api/metrics/summary` |
| Pool de workers (tareas, cola, tiempo medio) | `WorkerPool.stats()` | `/api/metrics/summary`, `/metrics` |
| Consultas PostGIS (p50, p95, p99) | `MetricsService.recordQuery` | `/api/metrics/summary → database`, `/metrics` |
| Caché ISR (hits, stale, misses, invalidaciones) | `IsrCache.stats()` | `/api/admin/summary` |
| **Core Web Vitals** de usuarios reales (LCP, INP, CLS, FCP, TTFB) | El frontend los envía con `sendBeacon`. Se calcula el **p75** por página y se clasifica good / needs-improvement / poor con los umbrales de web.dev | `/api/metrics/summary → webVitals` |

`/metrics` usa el formato de **Prometheus**, así que se puede graficar en Grafana sin cambiar el código.

Optimizaciones de rendimiento que ya están en el backend:
- Compresión gzip de JSON y HTML (`compression`), excepto el canal SSE.
- `Cache-Control` según el recurso: catálogo 1 h, mapa de calor 30 s con `stale-while-revalidate`, fotos 30 días `immutable`.
- El mapa de calor envía **un punto por incidente** (no por reporte) y acepta `bbox` para enviar solo lo visible.
- Notificaciones con **SSE** en lugar de *polling*: una sola conexión abierta por usuario.

## 5. Patrones de rendering

| Patrón | Página | Justificación |
|---|---|---|
| **CSR** (Client-Side Rendering) | App del frontend: mapa interactivo, formulario de reporte, panel del funcionario | Muy interactivas (Leaflet, geolocalización, filtros), consumen la API JSON |
| **SSR** (Server-Side Rendering) | `/incidentes/:id` | Es el enlace que se comparte por WhatsApp o redes. Debe llegar con HTML completo para la vista previa (Open Graph) y para SEO |
| **ISR** (Incremental Static Regeneration) | `/incidentes/:id` | No se renderiza en cada visita: caché de 60 s. Al vencer se sirve la copia vieja y se regenera en segundo plano (*stale-while-revalidate*). Un cambio de estado la **invalida al instante** por evento. La cabecera `X-Cache: HIT \| STALE \| MISS` lo muestra |
| **SSG** (Static Site Generation) | `/estadisticas/` | Resumen público que cambia poco. Se genera en `npm run build` y se sirve como archivo estático: cero trabajo por visita |

Las pruebas verifican el ciclo `MISS → HIT → (cambio de estado) → MISS` de la página ISR.

## 6. Retos técnicos del caso y cómo se resolvieron

1. **Clustering geoespacial:** cuando llega un reporte se busca el incidente abierto más cercano a ≤ 30 m con la fórmula de **haversine** (no se comparan coordenadas exactas). Si lo hay, el reporte se une a ese incidente y su centroide se recalcula con una media incremental. Como el centroide se mueve, dos incidentes pueden acabar describiendo el mismo hueco. Por eso un job periódico ejecuta **DBSCAN** sobre todos los reportes y fusiona esos duplicados en el incidente más antiguo. Con PostgreSQL la búsqueda del incidente cercano la hace PostGIS con `ST_DWithin` sobre un índice GIST (`PostgisIncidentRepository`); DBSCAN sigue en un Worker Thread.
2. **Confiabilidad de datos:**
   - límite por usuario (10 reportes por hora) y por IP;
   - un ciudadano no puede reportar dos veces el mismo daño (409);
   - el formato de la foto se valida por sus *magic bytes*, no por la cabecera;
   - el GPS del EXIF se compara con el punto reportado: `VERIFIED` (≤ 150 m), `MISMATCH` (posible reporte falso, visible para el funcionario) o `NO_GPS`.
3. **Manejo de imágenes:** el cuerpo es binario (no base64, que pesa un 33 % más) con un máximo de 2 MB. El almacenamiento está detrás de la interfaz `ImageStorage`: hoy guarda en disco local y puede pasar a Cloudinary o S3 con otra subclase.
4. **Privacidad:** las vistas públicas no exponen quién reportó (`Report.toPublicJSON`). Las contraseñas se guardan con scrypt y las sesiones van en un token firmado con HMAC-SHA256.

## 7. Próximos pasos

- **Frontend:**
  - mapa con Leaflet: capa de calor y agrupación de marcadores;
  - formulario con geolocalización del navegador y selección manual en el mapa si se niega el permiso;
  - Web Worker de compresión;
  - Service Worker y PWA;
  - panel del funcionario;
  - envío de Web Vitals.
- **Backend:** notificaciones Web Push.
