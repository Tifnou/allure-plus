// ─── Éditeur Parcours (MVP : import + analyse) ─────────────────────────
// Première itération du module décrit dans le cahier des charges "Éditeur
// Parcours" : importer un GPX, l'analyser (distance/D+/D-/côtes) et le
// visualiser (carte + profil altimétrique colorés par pente), puis
// l'exporter. Pas d'édition de tracé (répétition A→B, déplacement de point,
// etc.) dans cette version — cf itérations suivantes.
//
// Réutilise volontairement GPX_GRADE_BANDS/gpxGradeBand/computeGpxDisplayBins
// (campus.js, modale GPX de la page Objectifs) et haversineKm/chartOptions
// (routes.js/app.js) plutôt que de dupliquer cette logique — même carte
// (Leaflet, tuiles CARTO Voyager) et même profil (Chart.js, coloré par
// segment) que ces deux features existantes.
//
// _routeEditorData tient le dernier import en mémoire navigateur uniquement
// (pas de persistance serveur pour ce MVP) : un rechargement de page le
// perd, limitation assumée tant que l'édition de tracé n'existe pas encore.
let _routeEditorData = null; // { filename, points, stats }
let _routeEditorMap = null;
let _routeEditorChart = null;

function initRouteEditorPage() {
  const input = el('route-editor-file-input');
  if (input && !input._wired) {
    input._wired = true;
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (file) await handleRouteEditorFileSelected(file);
    };
  }
  renderRouteEditorImportStatus();
}

function renderRouteEditorImportStatus() {
  const box = el('route-editor-import-status');
  if (!box) return;
  if (!_routeEditorData) {
    box.innerHTML = `
      <button type="button" class="routes-generate-btn-wide route-editor-import-btn" id="route-editor-import-btn">📎 Importer un GPX</button>
      <div class="route-editor-import-hint">Le fichier original n'est jamais modifié — l'analyse porte sur une copie en mémoire.</div>`;
    const btn = el('route-editor-import-btn');
    if (btn) btn.onclick = () => el('route-editor-file-input')?.click();
    return;
  }
  box.innerHTML = `
    <div class="route-editor-imported">
      <span title="${_routeEditorData.filename}">✅ <b>${_routeEditorData.filename}</b></span>
      <button type="button" class="route-editor-imported-remove" id="route-editor-import-another">Importer un autre GPX</button>
    </div>`;
  const again = el('route-editor-import-another');
  if (again) again.onclick = () => el('route-editor-file-input')?.click();
}

async function handleRouteEditorFileSelected(file) {
  const box = el('route-editor-import-status');
  if (box) box.innerHTML = `<div class="route-editor-imported">⏳ Import…</div>`;
  try {
    const fd = new FormData();
    fd.append('gpx', file);
    const res = await fetch(`${API}/api/route-editor/import`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import impossible');
    _routeEditorData = data;
    renderRouteEditorImportStatus();
    renderRouteEditorWorkspace();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    renderRouteEditorImportStatus();
  }
}

function renderRouteEditorWorkspace() {
  const ws = el('route-editor-workspace');
  if (!ws || !_routeEditorData) return;
  const stats = _routeEditorData.stats;
  ws.style.display = '';

  const climbs = stats.climbs || [];
  const climbsRows = climbs.map((c, i) => `
    <tr>
      <td>Côte ${i + 1}</td>
      <td>KM ${c.startKm.toFixed(1)} → ${c.endKm.toFixed(1)}</td>
      <td>${(c.distM / 1000).toFixed(2)} km</td>
      <td>+${c.gainM} m</td>
      <td>${c.avgGradePct.toFixed(1)} %</td>
      <td>${c.maxGradePct.toFixed(1)} %</td>
    </tr>`).join('');

  ws.innerHTML = `
    <div class="gpx-profile-stats">
      <div class="gpx-profile-stat"><b>${(stats.totalDistM / 1000).toFixed(1)}</b> km</div>
      <div class="gpx-profile-stat"><b>+${stats.ascentM}</b> m D+</div>
      <div class="gpx-profile-stat"><b>-${stats.descentM}</b> m D-</div>
      <div class="gpx-profile-stat"><b>${stats.altMinM}–${stats.altMaxM}</b> m alt.</div>
      <div class="gpx-profile-stat"><b>${stats.avgClimbGradePct}%</b> pente moy. montée</div>
      <div class="gpx-profile-stat"><b>${stats.maxClimbGradePct}%</b> pente max</div>
      <div class="gpx-profile-stat"><b>${climbs.length}</b> côte(s) détectée(s)</div>
    </div>
    <div class="gpx-profile-elev-container"><canvas id="route-editor-elev-chart"></canvas></div>
    <div class="gpx-profile-map" id="route-editor-map"></div>
    <div class="gpx-profile-legend">
      ${GPX_GRADE_BANDS.map(b => `<span class="gpx-profile-legend-item"><span class="gpx-profile-legend-dot" style="background:${b.color}"></span>${b.label}</span>`).join('')}
    </div>
    <div class="route-editor-section-title">Côtes détectées</div>
    ${climbs.length
      ? `<table class="route-editor-climbs-table">
          <thead><tr><th>Montée</th><th>Position</th><th>Distance</th><th>D+</th><th>Pente moy.</th><th>Pente max.</th></tr></thead>
          <tbody>${climbsRows}</tbody>
        </table>`
      : `<div class="route-editor-climbs-empty">Aucune côte significative détectée sur ce parcours.</div>`}
    <div class="route-editor-actions">
      <button type="button" class="btn-plans-restart" id="route-editor-export-btn">⬇️ Exporter le GPX</button>
    </div>`;

  const exportBtn = el('route-editor-export-btn');
  if (exportBtn) exportBtn.onclick = routeEditorExportGpx;

  if (_routeEditorMap) { _routeEditorMap.remove(); _routeEditorMap = null; }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  setTimeout(renderRouteEditorVisuals, 0);
}

// Carte (tracé coloré par pente) + profil altimétrique (même code couleur),
// survol du profil synchronisé avec un curseur sur la carte — même
// principe que renderGpxProfileVisuals (campus.js) et
// renderElevationChart/renderRouteMap (routes.js).
function renderRouteEditorVisuals() {
  const data = _routeEditorData;
  if (!data) return;
  const points = data.points;
  const bins = computeGpxDisplayBins(points);
  let cursorMarker = null;
  let latLngs = null;

  const mapDiv = el('route-editor-map');
  if (mapDiv && typeof L !== 'undefined') {
    latLngs = points.map(p => [p.lat, p.lon]);
    const map = L.map(mapDiv, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    }).addTo(map);
    bins.forEach(bin => {
      const seg = latLngs.slice(bin.startIdx, bin.endIdx + 1);
      if (seg.length > 1) L.polyline(seg, { color: gpxGradeBand(bin.gradePct).color, weight: 4 }).addTo(map);
    });
    L.marker(latLngs[0]).addTo(map).bindTooltip('Départ');
    L.marker(latLngs[latLngs.length - 1]).addTo(map).bindTooltip('Arrivée');
    map.fitBounds(L.latLngBounds(latLngs), { padding: [12, 12] });
    _routeEditorMap = map;
  }

  const canvas = el('route-editor-elev-chart');
  if (canvas && typeof Chart !== 'undefined') {
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]));
    const labels = points.map((p, i) => cum[i].toFixed(1) + ' km');
    const dataPts = points.map(p => Math.round(p.ele));
    const gradeAtIdx = new Array(points.length).fill(0);
    bins.forEach(bin => { for (let i = bin.startIdx; i <= bin.endIdx; i++) gradeAtIdx[i] = bin.gradePct; });
    const baseOptions = typeof chartOptions === 'function' ? chartOptions() : { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    _routeEditorChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{
        data: dataPts, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true,
        backgroundColor: 'rgba(22,163,74,0.08)',
        segment: { borderColor: ctx => gpxGradeBand(gradeAtIdx[ctx.p0DataIndex]).color },
      }] },
      options: {
        ...baseOptions,
        scales: { ...(baseOptions.scales || {}), x: { ...(baseOptions.scales?.x || {}), ticks: { maxTicksLimit: 8 } } },
        onHover: (evt, activeElements) => {
          if (!_routeEditorMap || !latLngs) return;
          if (!activeElements.length) {
            if (cursorMarker) { _routeEditorMap.removeLayer(cursorMarker); cursorMarker = null; }
            return;
          }
          const latlng = latLngs[activeElements[0].index];
          if (!cursorMarker) {
            cursorMarker = L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(_routeEditorMap);
          } else {
            cursorMarker.setLatLng(latlng);
          }
        },
      },
    });
    canvas.addEventListener('mouseleave', () => {
      if (cursorMarker && _routeEditorMap) { _routeEditorMap.removeLayer(cursorMarker); cursorMarker = null; }
    });
  }
}

async function routeEditorExportGpx() {
  if (!_routeEditorData) return;
  try {
    const label = (_routeEditorData.filename || 'parcours').replace(/\.gpx$/i, '');
    const res = await fetch(`${API}/api/routes/gpx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: _routeEditorData.points, label }),
    });
    if (!res.ok) throw new Error('Export GPX impossible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = label.replace(/[^a-zA-Z0-9-_]+/g, '_') + '.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}
