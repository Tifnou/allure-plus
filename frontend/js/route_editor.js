// ─── Éditeur Parcours (import + analyse + répétition A→B) ──────────────
// Module décrit dans le cahier des charges "Éditeur Parcours" : importer un
// GPX, l'analyser (distance/D+/D-/côtes), le visualiser (carte + profil
// altimétrique colorés par pente), sélectionner une section A→B pour la
// répéter (fonction centrale du PDF — ex : répéter une côte), puis exporter
// le résultat. Pas encore de déplacement/ajout/suppression de point ni de
// mode création de zéro — cf itérations suivantes.
//
// Réutilise volontairement GPX_GRADE_BANDS/gpxGradeBand/computeGpxDisplayBins
// (campus.js, modale GPX de la page Objectifs) et haversineKm/chartOptions
// (routes.js/app.js) plutôt que de dupliquer cette logique — même carte
// (Leaflet, tuiles CARTO Voyager) et même profil (Chart.js, coloré par
// segment) que ces deux features existantes.
//
// _routeEditorData tient l'état courant (dernier import ou dernière
// répétition appliquée) en mémoire navigateur uniquement (pas de
// persistance serveur) : un rechargement de page le perd, limitation
// assumée pour cette itération. _routeEditorOriginal est figé une seule
// fois à l'import et ne change jamais (bouton "Restaurer le GPX original").
let _routeEditorData = null; // { filename, points, stats }
let _routeEditorOriginal = null; // { points, stats } - jamais modifié après l'import
let _routeEditorHistory = []; // pile de {points, stats} précédents (pour Annuler)
let _routeEditorFuture = [];  // pile de {points, stats} annulés (pour Rétablir)
let _routeEditorSelection = { aIdx: null, bIdx: null };
let _routeEditorMap = null;
let _routeEditorChart = null;
let _routeEditorLatLngs = null; // [lat,lon] du tracé courant, réutilisé par la sélection A/B
let _routeEditorSelectionLayer = null; // layerGroup Leaflet (marqueurs A/B + surbrillance)

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
      <button type="button" class="route-editor-imported-remove" id="route-editor-close-btn">✕ Fermer</button>
    </div>`;
  const again = el('route-editor-import-another');
  if (again) again.onclick = () => el('route-editor-file-input')?.click();
  const closeBtn = el('route-editor-close-btn');
  if (closeBtn) closeBtn.onclick = routeEditorClose;
}

// Referme le GPX en cours (sans en réimporter un) : revient à l'écran
// d'import vide - jusqu'ici seul "Importer un autre GPX" existait, il
// fallait donc obligatoirement choisir un nouveau fichier pour quitter
// l'analyse en cours (retour utilisateur).
function routeEditorClose() {
  _routeEditorData = null;
  _routeEditorOriginal = null;
  _routeEditorHistory = [];
  _routeEditorFuture = [];
  _routeEditorSelection = { aIdx: null, bIdx: null };
  if (_routeEditorMap) { _routeEditorMap.remove(); _routeEditorMap = null; }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  _routeEditorLatLngs = null;
  _routeEditorSelectionLayer = null;
  const ws = el('route-editor-workspace');
  if (ws) { ws.style.display = 'none'; ws.innerHTML = ''; }
  renderRouteEditorImportStatus();
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
    _routeEditorOriginal = { points: data.points, stats: data.stats };
    _routeEditorHistory = [];
    _routeEditorFuture = [];
    _routeEditorSelection = { aIdx: null, bIdx: null };
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
      <td><button type="button" class="route-editor-climb-repeat-btn" data-climb-idx="${i}">🔁 Répéter</button></td>
    </tr>`).join('');

  const isOriginal = _routeEditorOriginal && _routeEditorData.points === _routeEditorOriginal.points;

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
    <div id="route-editor-hint" class="route-editor-hint">Cliquez sur deux points du tracé (carte ou profil) pour choisir une section à répéter.</div>
    <div id="route-editor-section-panel"></div>
    <div class="route-editor-section-title">Côtes détectées</div>
    ${climbs.length
      ? `<table class="route-editor-climbs-table">
          <thead><tr><th>Montée</th><th>Position</th><th>Distance</th><th>D+</th><th>Pente moy.</th><th>Pente max.</th><th></th></tr></thead>
          <tbody>${climbsRows}</tbody>
        </table>`
      : `<div class="route-editor-climbs-empty">Aucune côte significative détectée sur ce parcours.</div>`}
    <div class="route-editor-actions">
      <button type="button" class="route-editor-btn-secondary" id="route-editor-undo-btn" ${_routeEditorHistory.length ? '' : 'disabled'}>↶ Annuler</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-redo-btn" ${_routeEditorFuture.length ? '' : 'disabled'}>↷ Rétablir</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-restore-btn" ${isOriginal ? 'disabled' : ''}>Restaurer l'original</button>
      <button type="button" class="btn-plans-restart" id="route-editor-export-btn">⬇️ Exporter le GPX</button>
    </div>`;

  const exportBtn = el('route-editor-export-btn');
  if (exportBtn) exportBtn.onclick = routeEditorExportGpx;
  const undoBtn = el('route-editor-undo-btn');
  if (undoBtn) undoBtn.onclick = routeEditorUndo;
  const redoBtn = el('route-editor-redo-btn');
  if (redoBtn) redoBtn.onclick = routeEditorRedo;
  const restoreBtn = el('route-editor-restore-btn');
  if (restoreBtn) restoreBtn.onclick = routeEditorRestoreOriginal;
  ws.querySelectorAll('.route-editor-climb-repeat-btn').forEach(btn => {
    btn.onclick = () => selectClimbForRepeat(parseInt(btn.dataset.climbIdx, 10));
  });

  if (_routeEditorMap) { _routeEditorMap.remove(); _routeEditorMap = null; }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  // Appel synchrone (pas de setTimeout) : ws.style.display a deja ete
  // remis a '' juste au-dessus et les conteneurs viennent d'etre crees par
  // le innerHTML ci-dessus, donc leurs dimensions sont deja mesurables.
  // Un setTimeout(...,0) ici laissait une fenetre ou deux rendus rapproches
  // (ex: Annuler puis Retablir cliques vite) pouvaient toujours trouver le
  // meme <div id="route-editor-map"> et tenter d'y initialiser 2 cartes
  // Leaflet en parallele ("Map container is already initialized").
  renderRouteEditorVisuals();
  renderRouteEditorSectionPanel();
}

// Carte (tracé coloré par pente) + profil altimétrique (même code couleur),
// survol du profil synchronisé avec un curseur sur la carte — même
// principe que renderGpxProfileVisuals (campus.js) et
// renderElevationChart/renderRouteMap (routes.js). Clic sur la carte OU le
// profil = sélection du point A/B le plus proche (cf onRouteEditorPointClick).
function renderRouteEditorVisuals() {
  const data = _routeEditorData;
  if (!data) return;
  const points = data.points;
  const bins = computeGpxDisplayBins(points);
  let cursorMarker = null;

  const mapDiv = el('route-editor-map');
  if (mapDiv && typeof L !== 'undefined') {
    _routeEditorLatLngs = points.map(p => [p.lat, p.lon]);
    const latLngs = _routeEditorLatLngs;
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
    map.on('click', e => onRouteEditorPointClick(findNearestRouteEditorPointIndex(e.latlng, points)));
    _routeEditorMap = map;
    renderRouteEditorSelectionOverlay();
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
        data: dataPts, borderWidth: 2, tension: 0.25, fill: true,
        backgroundColor: 'rgba(22,163,74,0.08)',
        segment: { borderColor: ctx => gpxGradeBand(gradeAtIdx[ctx.p0DataIndex]).color },
        pointRadius: ctx => (ctx.dataIndex === _routeEditorSelection.aIdx || ctx.dataIndex === _routeEditorSelection.bIdx) ? 5 : 0,
        pointBackgroundColor: ctx => ctx.dataIndex === _routeEditorSelection.aIdx ? '#16a34a' : '#dc2626',
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
      }] },
      options: {
        ...baseOptions,
        scales: { ...(baseOptions.scales || {}), x: { ...(baseOptions.scales?.x || {}), ticks: { maxTicksLimit: 8 } } },
        onHover: (evt, activeElements) => {
          if (!_routeEditorMap || !_routeEditorLatLngs) return;
          if (!activeElements.length) {
            if (cursorMarker) { _routeEditorMap.removeLayer(cursorMarker); cursorMarker = null; }
            return;
          }
          const latlng = _routeEditorLatLngs[activeElements[0].index];
          if (!cursorMarker) {
            cursorMarker = L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(_routeEditorMap);
          } else {
            cursorMarker.setLatLng(latlng);
          }
        },
        onClick: (evt, activeElements, chart) => {
          const els = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
          if (els.length) onRouteEditorPointClick(els[0].index);
        },
      },
    });
    canvas.addEventListener('mouseleave', () => {
      if (cursorMarker && _routeEditorMap) { _routeEditorMap.removeLayer(cursorMarker); cursorMarker = null; }
    });
  }
}

function findNearestRouteEditorPointIndex(latlng, points) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dLat = points[i].lat - latlng.lat, dLon = points[i].lon - latlng.lng;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Surbrillance de la sélection A/B sur la carte : marqueurs A (vert) / B
// (rouge) + tronçon A→B en orange par-dessus le tracé coloré par pente.
// Mise à jour légère (pas de destroy/recreate de la carte).
function renderRouteEditorSelectionOverlay() {
  if (_routeEditorSelectionLayer && _routeEditorMap) {
    _routeEditorMap.removeLayer(_routeEditorSelectionLayer);
    _routeEditorSelectionLayer = null;
  }
  if (!_routeEditorMap || !_routeEditorLatLngs || _routeEditorSelection.aIdx == null) return;
  const group = L.layerGroup();
  const aLL = _routeEditorLatLngs[_routeEditorSelection.aIdx];
  L.circleMarker(aLL, { radius: 8, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 })
    .bindTooltip('A', { permanent: true, direction: 'top', className: 'route-editor-point-label' }).addTo(group);
  if (_routeEditorSelection.bIdx != null) {
    const bLL = _routeEditorLatLngs[_routeEditorSelection.bIdx];
    L.circleMarker(bLL, { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 })
      .bindTooltip('B', { permanent: true, direction: 'top', className: 'route-editor-point-label' }).addTo(group);
    const seg = _routeEditorLatLngs.slice(_routeEditorSelection.aIdx, _routeEditorSelection.bIdx + 1);
    L.polyline(seg, { color: '#f59e0b', weight: 6, opacity: 0.9 }).addTo(group);
  }
  group.addTo(_routeEditorMap);
  _routeEditorSelectionLayer = group;
}

// 1er clic = pose A ; 2e clic = pose B (auto-ordonné, A=min/B=max) ou
// annule si re-clic sur A ; 3e clic = nouvelle sélection.
function onRouteEditorPointClick(idx) {
  const sel = _routeEditorSelection;
  if (sel.aIdx == null) {
    sel.aIdx = idx;
  } else if (sel.bIdx == null) {
    if (idx === sel.aIdx) sel.aIdx = null;
    else { const a = sel.aIdx; sel.aIdx = Math.min(a, idx); sel.bIdx = Math.max(a, idx); }
  } else {
    sel.aIdx = idx; sel.bIdx = null;
  }
  renderRouteEditorSelectionOverlay();
  if (_routeEditorChart) _routeEditorChart.update();
  renderRouteEditorSectionPanel();
}

function clearRouteEditorSelection() {
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorSelectionOverlay();
  if (_routeEditorChart) _routeEditorChart.update();
  renderRouteEditorSectionPanel();
}

// Raccourci depuis le tableau des côtes : pose directement A/B sur les
// bornes de la côte détectée (déjà connues), sans passer par les 2 clics.
function selectClimbForRepeat(climbIdx) {
  const c = _routeEditorData?.stats?.climbs?.[climbIdx];
  if (!c) return;
  _routeEditorSelection = { aIdx: c.startIdx, bIdx: c.endIdx };
  renderRouteEditorSelectionOverlay();
  if (_routeEditorChart) _routeEditorChart.update();
  renderRouteEditorSectionPanel();
  el('route-editor-section-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function routeEditorAnalyzePoints(points) {
  const res = await fetch(`${API}/api/route-editor/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Analyse impossible');
  return data.stats;
}

function renderRouteEditorSectionPanel() {
  const panel = el('route-editor-section-panel');
  const hint = el('route-editor-hint');
  if (!panel) return;
  const sel = _routeEditorSelection;
  if (sel.aIdx == null) {
    panel.innerHTML = '';
    if (hint) hint.textContent = 'Cliquez sur deux points du tracé (carte ou profil) pour choisir une section à répéter.';
    return;
  }
  if (sel.bIdx == null) {
    panel.innerHTML = '';
    if (hint) hint.textContent = 'Point A posé — cliquez sur le point B (ou re-cliquez sur A pour annuler).';
    return;
  }
  if (hint) hint.textContent = '';
  panel.innerHTML = `<div class="route-editor-section-card">⏳ Analyse de la section…</div>`;
  const points = _routeEditorData.points.slice(sel.aIdx, sel.bIdx + 1);
  routeEditorAnalyzePoints(points).then(stats => {
    // La sélection a pu changer pendant l'attente réseau - ignorer une
    // réponse périmée plutôt que d'afficher un panneau qui ne correspond
    // plus au A/B affiché sur la carte.
    if (_routeEditorSelection.aIdx !== sel.aIdx || _routeEditorSelection.bIdx !== sel.bIdx) return;
    const isClimb = stats.ascentM >= stats.descentM;
    panel.innerHTML = `
      <div class="route-editor-section-card">
        <div class="route-editor-section-stats">
          <span><b>${(stats.totalDistM / 1000).toFixed(2)}</b> km</span>
          <span><b>+${stats.ascentM}</b> m D+</span>
          <span><b>-${stats.descentM}</b> m D-</span>
          <span><b>${stats.avgClimbGradePct || 0}%</b> pente moy.</span>
        </div>
        <div class="route-editor-section-form">
          <label for="route-editor-repeat-count">${isClimb ? 'Nombre de montées souhaité' : 'Nombre de répétitions souhaité'}</label>
          <input type="number" id="route-editor-repeat-count" class="routes-number-input" min="2" max="10" value="2" />
          <button type="button" class="btn-plans-restart" id="route-editor-apply-repeat-btn">Appliquer</button>
          <button type="button" class="route-editor-btn-secondary" id="route-editor-clear-selection-btn">Effacer la sélection</button>
        </div>
      </div>`;
    const applyBtn = el('route-editor-apply-repeat-btn');
    if (applyBtn) applyBtn.onclick = applyRouteEditorRepeat;
    const clearBtn = el('route-editor-clear-selection-btn');
    if (clearBtn) clearBtn.onclick = clearRouteEditorSelection;
  }).catch(err => {
    if (_routeEditorSelection.aIdx !== sel.aIdx || _routeEditorSelection.bIdx !== sel.bIdx) return;
    panel.innerHTML = `<div class="route-editor-section-card">Erreur : ${err.message}</div>`;
  });
}

// Construit A..B, N fois, avec les allers-retours B->A intermédiaires -
// même principe que le PDF (4 montées = A→B→A→B→A→B→A→B), sans point
// dupliqué aux jonctions. Le retour B→A réutilise exactement les
// coordonnées existantes (aucun nouvel appel de routage nécessaire).
function buildRepeatedPoints(points, aIdx, bIdx, totalPasses) {
  const before = points.slice(0, aIdx);
  const forward = points.slice(aIdx, bIdx + 1); // A..B inclusif
  const backward = forward.slice().reverse();   // B..A inclusif
  const after = points.slice(bIdx + 1);
  const middle = [];
  for (let pass = 0; pass < totalPasses; pass++) {
    middle.push(...(pass === 0 ? forward : forward.slice(1)));
    if (pass < totalPasses - 1) middle.push(...backward.slice(1));
  }
  return [...before, ...middle, ...after];
}

async function applyRouteEditorRepeat() {
  const sel = _routeEditorSelection;
  if (sel.aIdx == null || sel.bIdx == null) return;
  const countInput = el('route-editor-repeat-count');
  const count = Math.min(10, Math.max(2, parseInt(countInput?.value, 10) || 2));
  const applyBtn = el('route-editor-apply-repeat-btn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Application…'; }
  try {
    const newPoints = buildRepeatedPoints(_routeEditorData.points, sel.aIdx, sel.bIdx, count);
    const stats = await routeEditorAnalyzePoints(newPoints);
    _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats });
    _routeEditorFuture = [];
    _routeEditorData = { ..._routeEditorData, points: newPoints, stats };
    _routeEditorSelection = { aIdx: null, bIdx: null };
    renderRouteEditorWorkspace();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Appliquer'; }
  }
}

function routeEditorUndo() {
  if (!_routeEditorHistory.length) return;
  _routeEditorFuture.push({ points: _routeEditorData.points, stats: _routeEditorData.stats });
  const prev = _routeEditorHistory.pop();
  _routeEditorData = { ..._routeEditorData, points: prev.points, stats: prev.stats };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
}

function routeEditorRedo() {
  if (!_routeEditorFuture.length) return;
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats });
  const next = _routeEditorFuture.pop();
  _routeEditorData = { ..._routeEditorData, points: next.points, stats: next.stats };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
}

function routeEditorRestoreOriginal() {
  if (!_routeEditorOriginal || _routeEditorData.points === _routeEditorOriginal.points) return;
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats });
  _routeEditorFuture = [];
  _routeEditorData = { ..._routeEditorData, points: _routeEditorOriginal.points, stats: _routeEditorOriginal.stats };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
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
