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
let _routeEditorObjective = { targetDplusM: null, targetDistM: null }; // objectif D+/distance (PDF §9)

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
  _routeEditorObjective = { targetDplusM: null, targetDistM: null };
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
    _routeEditorObjective = { targetDplusM: null, targetDistM: null };
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
    <div class="route-editor-objective-card">
      <span class="route-editor-objective-title">🎯 Objectif (optionnel)</span>
      <label>D+ cible <input type="number" id="route-editor-obj-dplus" class="routes-number-input" min="0" step="10" placeholder="m" value="${_routeEditorObjective.targetDplusM ?? ''}" /> m</label>
      <label>Distance cible <input type="number" id="route-editor-obj-dist" class="routes-number-input" min="0" step="0.5" placeholder="km" value="${_routeEditorObjective.targetDistM ?? ''}" /> km</label>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-obj-clear">Effacer</button>
      <span class="route-editor-objective-hint">Allure+ propose automatiquement la côte la plus efficace à répéter pour s'en approcher — ou sélectionnez vous-même une autre section (carte, profil, "🔁 Répéter").</span>
    </div>
    <div id="route-editor-objective-auto"></div>
    <div id="route-editor-hint" class="route-editor-hint">Cliquez sur deux points du tracé (carte ou profil) pour choisir une section à répéter.</div>
    <div id="route-editor-section-panel"></div>
    <div class="route-editor-section-title">Côtes détectées</div>
    ${climbs.length
      ? `<table class="route-editor-climbs-table">
          <thead><tr><th>Montée</th><th>Position</th><th>Distance</th><th>D+</th><th>Pente moy.</th><th>Pente max.</th><th></th></tr></thead>
          <tbody>${climbsRows}</tbody>
        </table>`
      : `<div class="route-editor-climbs-empty">Aucune côte significative détectée sur ce parcours.</div>`}
    <div class="route-editor-section-title">Stratégie de course</div>
    <div class="route-editor-strategy-card">
      <label>Objectif de temps (optionnel) <input type="time" id="route-editor-strategy-target" class="routes-text-input" style="width:110px" /></label>
      <button type="button" class="btn-plans-restart" id="route-editor-strategy-btn">Calculer la stratégie</button>
      <span class="route-editor-objective-hint">Répartit l'effort section par section selon votre profil d'allure personnel (calibré sur vos sorties Garmin), avec marche active sur les pentes très fortes — pas une allure unique partout.</span>
    </div>
    <div id="route-editor-strategy-result"></div>
    <div class="route-editor-actions">
      <button type="button" class="route-editor-btn-secondary" id="route-editor-undo-btn" ${_routeEditorHistory.length ? '' : 'disabled'}>↶ Annuler</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-redo-btn" ${_routeEditorFuture.length ? '' : 'disabled'}>↷ Rétablir</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-restore-btn" ${isOriginal ? 'disabled' : ''}>Restaurer l'original</button>
      <button type="button" class="btn-plans-restart" id="route-editor-export-btn">⬇️ Exporter le GPX</button>
    </div>`;

  const exportBtn = el('route-editor-export-btn');
  if (exportBtn) exportBtn.onclick = routeEditorExportGpx;
  const strategyBtn = el('route-editor-strategy-btn');
  if (strategyBtn) strategyBtn.onclick = computeRouteEditorStrategy;
  const undoBtn = el('route-editor-undo-btn');
  if (undoBtn) undoBtn.onclick = routeEditorUndo;
  const redoBtn = el('route-editor-redo-btn');
  if (redoBtn) redoBtn.onclick = routeEditorRedo;
  const restoreBtn = el('route-editor-restore-btn');
  if (restoreBtn) restoreBtn.onclick = routeEditorRestoreOriginal;
  ws.querySelectorAll('.route-editor-climb-repeat-btn').forEach(btn => {
    btn.onclick = () => selectClimbForRepeat(parseInt(btn.dataset.climbIdx, 10));
  });
  const objDplusInput = el('route-editor-obj-dplus');
  const objDistInput = el('route-editor-obj-dist');
  const onObjectiveChange = () => {
    _routeEditorObjective = {
      targetDplusM: objDplusInput?.value ? parseInt(objDplusInput.value, 10) : null,
      targetDistM: objDistInput?.value ? parseFloat(objDistInput.value) : null,
    };
    renderRouteEditorSectionPanel();
    renderRouteEditorObjectiveAutoSuggestion();
  };
  if (objDplusInput) objDplusInput.oninput = onObjectiveChange;
  if (objDistInput) objDistInput.oninput = onObjectiveChange;
  const objClearBtn = el('route-editor-obj-clear');
  if (objClearBtn) objClearBtn.onclick = () => {
    _routeEditorObjective = { targetDplusM: null, targetDistM: null };
    if (objDplusInput) objDplusInput.value = '';
    if (objDistInput) objDistInput.value = '';
    renderRouteEditorSectionPanel();
    renderRouteEditorObjectiveAutoSuggestion();
  };

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
  renderRouteEditorObjectiveAutoSuggestion();
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
  renderRouteEditorObjectiveAutoSuggestion();
}

function clearRouteEditorSelection() {
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorSelectionOverlay();
  if (_routeEditorChart) _routeEditorChart.update();
  renderRouteEditorSectionPanel();
  renderRouteEditorObjectiveAutoSuggestion();
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
  renderRouteEditorObjectiveAutoSuggestion();
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
    renderRouteEditorObjectiveSuggestion(sel);
  }).catch(err => {
    if (_routeEditorSelection.aIdx !== sel.aIdx || _routeEditorSelection.bIdx !== sel.bIdx) return;
    panel.innerHTML = `<div class="route-editor-section-card">Erreur : ${err.message}</div>`;
  });
}

// Objectif D+/distance (PDF §9) : calcule combien de fois parcourir la
// section sélectionnée pour s'approcher de la cible, à partir d'un seul
// passage supplémentaire mesuré réellement (pas une formule approximative -
// une section qui n'est pas un aller-retour parfaitement symétrique en
// pente n'a pas forcément le même D+ à l'aller qu'au retour). Combine D+ ET
// distance quand les deux sont fixés : comme chaque passage supplémentaire
// augmente TOUJOURS les deux ensemble, prendre le nombre de passages le
// plus grand des deux besoins garantit d'atteindre (ou dépasser) les deux
// cibles - pas une vraie optimisation combinée avec tolérances (§9.3,
// hors périmètre), mais correct pour l'outil dont on dispose (répétition).
async function computeRouteEditorObjectiveSuggestion(aIdx, bIdx) {
  const obj = _routeEditorObjective;
  if (obj.targetDplusM == null && obj.targetDistM == null) return null;
  const original = _routeEditorData.stats;
  const points = _routeEditorData.points;

  const twoPassPoints = buildRepeatedPoints(points, aIdx, bIdx, 2);
  const twoPassStats = await routeEditorAnalyzePoints(twoPassPoints);
  const deltaDplusPerPass = twoPassStats.ascentM - original.ascentM;
  const deltaDistPerPass = twoPassStats.totalDistM - original.totalDistM;

  let neededPasses = 2;
  if (obj.targetDplusM != null && deltaDplusPerPass > 0) {
    neededPasses = Math.max(neededPasses, 1 + Math.ceil((obj.targetDplusM - original.ascentM) / deltaDplusPerPass));
  }
  if (obj.targetDistM != null && deltaDistPerPass > 0) {
    neededPasses = Math.max(neededPasses, 1 + Math.ceil((obj.targetDistM * 1000 - original.totalDistM) / deltaDistPerPass));
  }
  neededPasses = Math.min(10, Math.max(2, neededPasses));

  const finalStats = neededPasses === 2 ? twoPassStats
    : await routeEditorAnalyzePoints(buildRepeatedPoints(points, aIdx, bIdx, neededPasses));
  const reached = (obj.targetDplusM == null || finalStats.ascentM >= obj.targetDplusM - 1)
    && (obj.targetDistM == null || finalStats.totalDistM >= obj.targetDistM * 1000 - 50);

  return { neededPasses, finalStats, reached, capped: neededPasses >= 10 };
}

function renderRouteEditorObjectiveSuggestion(sel) {
  const container = document.getElementById('route-editor-objective-suggestion');
  if (container) container.remove();
  const obj = _routeEditorObjective;
  if (obj.targetDplusM == null && obj.targetDistM == null) return;
  const panel = el('route-editor-section-panel');
  if (!panel) return;
  const box = document.createElement('div');
  box.id = 'route-editor-objective-suggestion';
  box.className = 'route-editor-section-card route-editor-objective-suggestion';
  box.innerHTML = '⏳ Calcul de la suggestion…';
  panel.appendChild(box);
  computeRouteEditorObjectiveSuggestion(sel.aIdx, sel.bIdx).then(res => {
    if (_routeEditorSelection.aIdx !== sel.aIdx || _routeEditorSelection.bIdx !== sel.bIdx) return;
    if (!document.getElementById('route-editor-objective-suggestion')) return; // panel refermé entre-temps
    if (!res) { box.remove(); return; }
    const passesLabel = res.neededPasses === 2 ? '1 passage supplémentaire' : `${res.neededPasses - 1} passages supplémentaires`;
    const capNote = res.capped && !res.reached
      ? `<div class="route-editor-objective-capnote">Objectif non atteint même au maximum de 10 montées — essayez une autre section ou une section plus haute.</div>`
      : '';
    box.innerHTML = `
      <div>🎯 ${passesLabel} (${res.neededPasses} montées au total) ${res.reached ? "permettront d'atteindre l'objectif" : "rapprocheront de l'objectif"} :
      nouveau parcours estimé <b>${(res.finalStats.totalDistM / 1000).toFixed(1)} km</b> / <b>+${res.finalStats.ascentM} m D+</b>.</div>
      ${capNote}
      <button type="button" class="btn-plans-restart" id="route-editor-apply-objective-btn">Appliquer ${res.neededPasses} montées</button>`;
    const btn = document.getElementById('route-editor-apply-objective-btn');
    if (btn) btn.onclick = () => applyRouteEditorRepeat(res.neededPasses);
  }).catch(() => { box.remove(); });
}

// Classe les côtes détectées par "rentabilité verticale" (m de D+ par
// metre de trajet ajouté par un aller-retour) quand un D+ cible est fixé -
// même principe que findSteepestSegments (route_generator.js) pour le
// générateur d'itinéraires, réutilisé ici en repli local (aucun appel
// serveur) pour identifier la MEILLEURE côte sans devoir simuler les 30+
// côtes d'un parcours une par une. Si seule une distance cible est fixée
// (pas de D+), la rentabilité D+ n'a pas de sens - on privilégie alors la
// côte la plus courte, pour une granularité plus fine (moins de risque de
// dépasser largement la distance visée en ajoutant un passage entier).
function pickBestClimbForObjective(climbs, obj) {
  if (!climbs.length) return null;
  if (obj.targetDplusM != null) {
    return climbs.reduce((best, c) => {
      const efficiency = c.gainM / (2 * c.distM || 1);
      return (!best || efficiency > best.efficiency) ? { ...c, efficiency } : best;
    }, null);
  }
  return climbs.reduce((best, c) => (!best || c.distM < best.distM) ? c : best, null);
}

// Suggestion automatique (pas de clic requis) : dès qu'un objectif D+/
// distance est fixé et qu'aucune section n'est sélectionnée manuellement,
// propose directement la meilleure côte à répéter - le clic manuel
// (carte/profil/"🔁 Répéter") reste possible et prend le dessus tant qu'une
// sélection est active (cf renderRouteEditorSectionPanel).
function renderRouteEditorObjectiveAutoSuggestion() {
  const box = el('route-editor-objective-auto');
  if (!box) return;
  const obj = _routeEditorObjective;
  if (_routeEditorSelection.aIdx != null || (obj.targetDplusM == null && obj.targetDistM == null)) {
    box.innerHTML = '';
    return;
  }
  const climbs = _routeEditorData?.stats?.climbs || [];
  const best = pickBestClimbForObjective(climbs, obj);
  if (!best) {
    box.innerHTML = `<div class="route-editor-section-card route-editor-objective-suggestion">Aucune côte détectée sur ce parcours pour proposer une répétition automatique — sélectionnez une section vous-même (carte ou profil).</div>`;
    return;
  }
  const objSnapshot = { ...obj };
  box.innerHTML = `<div class="route-editor-section-card route-editor-objective-suggestion">⏳ Recherche de la meilleure côte…</div>`;
  computeRouteEditorObjectiveSuggestion(best.startIdx, best.endIdx).then(res => {
    // L'objectif ou la sélection ont pu changer pendant l'attente réseau.
    if (_routeEditorObjective.targetDplusM !== objSnapshot.targetDplusM || _routeEditorObjective.targetDistM !== objSnapshot.targetDistM) return;
    if (_routeEditorSelection.aIdx != null) return;
    if (!res) { box.innerHTML = ''; return; }
    const passesLabel = res.neededPasses === 2 ? '1 passage supplémentaire' : `${res.neededPasses - 1} passages supplémentaires`;
    const capNote = res.capped && !res.reached
      ? `<div class="route-editor-objective-capnote">Objectif non atteint même au maximum de 10 montées sur cette côte.</div>`
      : '';
    box.innerHTML = `
      <div class="route-editor-section-card route-editor-objective-suggestion">
        <div>🏆 Meilleure option automatique — côte KM ${best.startKm.toFixed(1)} → ${best.endKm.toFixed(1)} (+${best.gainM} m D+ par passage) :
        ${passesLabel} (${res.neededPasses} montées au total) ${res.reached ? "permettront d'atteindre l'objectif" : "rapprocheront de l'objectif"} :
        nouveau parcours estimé <b>${(res.finalStats.totalDistM / 1000).toFixed(1)} km</b> / <b>+${res.finalStats.ascentM} m D+</b>.</div>
        ${capNote}
        <button type="button" class="btn-plans-restart" id="route-editor-apply-auto-btn">Appliquer ${res.neededPasses} montées</button>
      </div>`;
    const btn = document.getElementById('route-editor-apply-auto-btn');
    if (btn) btn.onclick = () => {
      _routeEditorSelection = { aIdx: best.startIdx, bIdx: best.endIdx };
      applyRouteEditorRepeat(res.neededPasses);
    };
  }).catch(() => { box.innerHTML = ''; });
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

// explicitCount : passé par le bouton "Appliquer X montées (objectif)" pour
// contourner le champ manuel - sinon on lit route-editor-repeat-count.
async function applyRouteEditorRepeat(explicitCount) {
  const sel = _routeEditorSelection;
  if (sel.aIdx == null || sel.bIdx == null) return;
  let count;
  if (Number.isInteger(explicitCount)) {
    count = Math.min(10, Math.max(2, explicitCount));
  } else {
    const countInput = el('route-editor-repeat-count');
    count = Math.min(10, Math.max(2, parseInt(countInput?.value, 10) || 2));
  }
  const applyBtn = el('route-editor-apply-repeat-btn') || el('route-editor-apply-objective-btn') || el('route-editor-apply-auto-btn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Application…'; }
  try {
    const newPoints = buildRepeatedPoints(_routeEditorData.points, sel.aIdx, sel.bIdx, count);
    const stats = await routeEditorAnalyzePoints(newPoints);
    _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats });
    _routeEditorFuture = [];
    _routeEditorData = { ..._routeEditorData, points: newPoints, stats };
    _routeEditorSelection = { aIdx: null, bIdx: null };
    // Repetition declenchee par un objectif (D+/distance) : l'objectif vient
    // d'etre applique, on l'efface pour ne pas re-suggerer immediatement une
    // nouvelle repetition sur le parcours qui vient tout juste d'etre mis a jour.
    if (Number.isInteger(explicitCount)) _routeEditorObjective = { targetDplusM: null, targetDistM: null };
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

// input type="time" renvoie toujours "HH:MM" (ou "HH:MM:SS" si l'attribut
// step autorise les secondes, absent ici) en 24h - format strict et non
// ambigu, contrairement a un champ texte libre : plus besoin de tolerer/
// deviner plusieurs formats (bug reel constate avec un champ texte : saisir
// "01:55:00" avec les secondes n'etait pas reconnu par l'ancien regex
// hh:mm et retombait silencieusement sur un parseFloat qui ne gardait que
// le "01" avant le premier ":", soit un objectif de... 1 minute).
function parseRouteEditorTargetTime(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return minutes > 0 ? minutes : null;
}

const STRATEGY_TYPE_LABELS = { climb: 'Montée', descent: 'Descente', flat: 'Plat' };
const STRATEGY_COHERENCE = {
  ambitieux: { label: 'Objectif très ambitieux', className: 'route-editor-coherence--ambitieux' },
  realiste: { label: 'Objectif réaliste', className: 'route-editor-coherence--realiste' },
  prudent: { label: 'Objectif prudent', className: 'route-editor-coherence--prudent' },
};

async function computeRouteEditorStrategy() {
  if (!_routeEditorData) return;
  const btn = el('route-editor-strategy-btn');
  const targetMin = parseRouteEditorTargetTime(el('route-editor-strategy-target')?.value);
  const resultBox = el('route-editor-strategy-result');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Calcul…'; }
  try {
    const res = await fetch(`${API}/api/route-editor/strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: _routeEditorData.points, targetTimeMin: targetMin }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Calcul impossible');
    renderRouteEditorStrategyResult(data);
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Calculer la stratégie'; }
  }
}

function renderRouteEditorStrategyResult(data) {
  const box = el('route-editor-strategy-result');
  if (!box) return;
  const coherence = data.coherence ? STRATEGY_COHERENCE[data.coherence] : null;
  const rows = data.sections.map(s => `
    <tr>
      <td>${STRATEGY_TYPE_LABELS[s.type] || s.type}${s.marcheActive ? ' <span class="route-editor-marche-active">🚶 marche active</span>' : ''}</td>
      <td>KM ${s.startKm.toFixed(1)} → ${s.endKm.toFixed(1)}</td>
      <td>${(s.distM / 1000).toFixed(2)} km</td>
      <td>${s.type === 'flat' ? '—' : (s.avgGradePct > 0 ? '+' : '') + s.avgGradePct.toFixed(1) + ' %'}</td>
      <td>${s.marcheActive ? (s.distM > 0 ? ((s.distM / 1000) / (s.timeMin / 60)).toFixed(1) + ' km/h' : '—') : formatPace(s.paceMinPerKm * 60)}</td>
      <td>${formatDuration(s.timeMin * 60)}</td>
      <td>${formatDuration(s.cumulativeTimeMin * 60)}</td>
    </tr>`).join('');

  box.innerHTML = `
    ${coherence ? `<div class="route-editor-coherence-badge ${coherence.className}">${coherence.label}</div>` : ''}
    <div class="route-editor-strategy-summary">
      Temps ${data.targetTimeMin ? 'objectif' : 'naturel estimé'} : <b>${formatDuration((data.targetTimeMin || data.naturalTotalMin) * 60)}</b>
      ${data.targetTimeMin ? ` (temps naturel sans objectif : ${formatDuration(data.naturalTotalMin * 60)})` : ''}
      ${data.paceProfileIsGeneric ? '<div class="route-editor-objective-hint">⚠️ Profil d\'allure générique (pas encore assez de sorties Garmin analysées) — les temps sont indicatifs.</div>' : ''}
    </div>
    <div class="route-editor-strategy-table-wrap">
      <table class="route-editor-climbs-table route-editor-strategy-table">
        <thead><tr><th>Section</th><th>Position</th><th>Distance</th><th>Pente</th><th>Allure conseillée</th><th>Temps</th><th>Passage cumulé</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
