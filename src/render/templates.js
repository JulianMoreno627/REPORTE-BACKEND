const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);

const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
const formatDate = (iso) => dateFormat.format(new Date(iso));

const STYLES = `
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1f2937; --muted:#6b7280; --accent:#b45309; --line:#e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111827; --card:#1f2937; --text:#f3f4f6; --muted:#9ca3af; --line:#374151; --accent:#f59e0b; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
  header, main, footer { max-width: 860px; margin: 0 auto; padding: 16px; }
  header a { color: var(--accent); font-weight: 700; text-decoration: none; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.85rem; font-weight:600; background:var(--line); }
  .HIGH { background:#fee2e2; color:#991b1b; } .MEDIUM { background:#ffedd5; color:#9a3412; } .LOW { background:#fef9c3; color:#854d0e; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:12px; }
  .stat strong { display:block; font-size:1.8rem; }
  .muted { color: var(--muted); font-size: .9rem; }
  ol.timeline { padding-left: 20px; } ol.timeline li { margin-bottom: 8px; }
  img { max-width:100%; border-radius:8px; }
  table { width:100%; border-collapse: collapse; } td, th { padding:6px; border-bottom:1px solid var(--line); text-align:left; }
`;

export function layout({ title, description, body, canonical, renderPattern }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
  <style>${STYLES}</style>
</head>
<body>
  <header><a href="/">Vías Seguras</a> · <span class="muted">Reporte ciudadano de daños viales</span></header>
  <main>${body}</main>
  <footer class="muted">Página generada en el servidor (${escapeHtml(renderPattern)}).</footer>
</body>
</html>`;
}

export function incidentPage(incident, { baseUrl, frontendUrl }) {
  const reportsWithPhoto = incident.reports.filter((report) => report.photoUrl);
  const body = `
  <article class="card">
    <h1>${escapeHtml(incident.categoryLabel)} · ${escapeHtml(incident.roadTypeLabel)}</h1>
    <p>
      <span class="badge">${escapeHtml(incident.statusLabel)}</span>
      <span class="badge ${escapeHtml(incident.priority.level)}">Prioridad ${escapeHtml(incident.priority.levelLabel)}</span>
    </p>
    <div class="grid">
      <div class="stat"><strong>${incident.reportCount}</strong><span class="muted">reportes ciudadanos</span></div>
      <div class="stat"><strong>${incident.priority.score.toFixed(2)}</strong><span class="muted">puntaje de prioridad</span></div>
      <div class="stat"><strong>${formatDate(incident.createdAt).split(',')[0]}</strong><span class="muted">primer reporte</span></div>
    </div>
    <p class="muted">Ubicación aproximada: ${incident.location.lat.toFixed(5)}, ${incident.location.lng.toFixed(5)}</p>
    <p><a href="${escapeHtml(`${frontendUrl}/incidentes/${incident.id}`)}">Ver en el mapa interactivo</a></p>
  </article>
  <section class="card">
    <h2>Seguimiento</h2>
    <ol class="timeline">
      ${incident.history.map((entry) => `<li><strong>${escapeHtml(entry.statusLabel)}</strong> — ${formatDate(entry.at)}${entry.note ? `<br><span class="muted">${escapeHtml(entry.note)}</span>` : ''}</li>`).join('')}
    </ol>
  </section>
  ${reportsWithPhoto.length ? `<section class="card"><h2>Fotos</h2><div class="grid">${reportsWithPhoto.slice(0, 6)
    .map((report) => `<img src="${escapeHtml(baseUrl + report.photoUrl)}" alt="Foto del daño reportado" loading="lazy" width="320" height="240">`).join('')}</div></section>` : ''}`;
  return layout({
    title: `${incident.categoryLabel} (${incident.statusLabel}) · Vías Seguras`,
    description: `${incident.reportCount} ciudadanos reportaron este daño. Estado: ${incident.statusLabel}.`,
    canonical: `${baseUrl}/incidentes/${incident.id}`,
    renderPattern: 'SSR + ISR',
    body,
  });
}

export function statsPage(summary) {
  const levelLabels = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' };
  const body = `
  <h1>Estadísticas de daños viales</h1>
  <p class="muted">Actualizado: ${formatDate(summary.generatedAt)}</p>
  <section class="grid">
    <div class="card stat"><strong>${summary.totals.incidents}</strong><span class="muted">incidentes</span></div>
    <div class="card stat"><strong>${summary.totals.open}</strong><span class="muted">abiertos</span></div>
    <div class="card stat"><strong>${summary.totals.reports}</strong><span class="muted">reportes ciudadanos</span></div>
    <div class="card stat"><strong>${summary.totals.duplicatesAvoided}</strong><span class="muted">duplicados agrupados</span></div>
  </section>
  <section class="card">
    <h2>Por estado</h2>
    <table><tbody>${summary.byStatus.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td></tr>`).join('')}</tbody></table>
  </section>
  <section class="card">
    <h2>Por tipo de daño</h2>
    <table><tbody>${summary.byCategory.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td></tr>`).join('')}</tbody></table>
  </section>
  <section class="card">
    <h2>Incidentes abiertos por prioridad</h2>
    <table><tbody>${Object.entries(levelLabels).map(([code, label]) => `<tr><td><span class="badge ${code}">${label}</span></td><td>${summary.byPriority[code] ?? 0}</td></tr>`).join('')}</tbody></table>
  </section>`;
  return layout({
    title: 'Estadísticas · Vías Seguras',
    description: 'Resumen público de los daños viales reportados por la ciudadanía.',
    renderPattern: 'SSG',
    body,
  });
}

export function notFoundPage() {
  return layout({
    title: 'Incidente no encontrado · Vías Seguras',
    description: 'El incidente no existe o fue unificado con otro.',
    renderPattern: 'SSR',
    body: '<div class="card"><h1>Incidente no encontrado</h1><p>Puede que se haya unificado con otro reporte cercano.</p></div>',
  });
}
