// routes.js — page "Itinéraires" : génération de parcours (BRouter côté serveur)

const routesState = {
  step: 0,
  address: '',
  start: null,       // { lat, lon, label }
  mode: 'distance',  // 'distance' | 'duration'
  distanceKm: 10,
  durationMin: 60,
  terrain: 'trail',  // 'trail' | 'route'
  ascentM: 300,
  results: null,
};

function initRoutesPage() {
  routesState.step = 0;
  routesState.results = null;
  showRoutesView('wizard');
  renderRoutesStep();
}

function showRoutesView(view) {
  el('routes-wizard').style.display = view === 'wizard' ? '' : 'none';
  el('routes-results').style.display = view === 'results' ? '' : 'none';
}

function routesHasAscentStep() { return routesState.terrain === 'trail'; }
function routesTotalSteps() { return routesHasAscentStep() ? 4 : 3; }

function renderRoutesStep() {
  const content = el('routes-step-content');
  const back = el('routes-nav-back');
  const next = el('routes-nav-next');
  back.style.display = routesState.step > 0 ? '' : 'none';
  next.textContent = (routesState.step === routesTotalSteps() - 1) ? 'Générer →' : 'Suivant →';

  if (routesState.step === 0) {
    content.innerHTML = `
      <div class="wizard-question">Où souhaitez-vous partir ?</div>
      <input type="text" id="routes-input-address" class="routes-text-input"
             placeholder="Ex : Rue de Sacaly, 91400 Saclay" value="${(routesState.address || '').replace(/"/g, '&quot;')}">
      <div class="routes-hint">L'adresse trouvée vous sera présentée pour confirmation avant tout calcul.</div>
    `;
    const input = el('routes-input-address');
    const sync = () => { routesState.address = input.value; next.disabled = input.value.trim().length < 3; };
    input.oninput = sync;
    sync();

  } else if (routesState.step === 1) {
    content.innerHTML = `
      <div class="wizard-question">Distance ou durée visée ?</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'distance' ? 'active' : ''}" data-mode="distance">Distance</button>
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'duration' ? 'active' : ''}" data-mode="duration">Durée</button>
      </div>
      <div id="routes-mode-input" class="routes-number-row"></div>
    `;
    content.querySelectorAll('.routes-toggle-btn').forEach(btn => {
      btn.onclick = () => { routesState.mode = btn.dataset.mode; renderRoutesStep(); };
    });
    const modeInput = el('routes-mode-input');
    if (routesState.mode === 'distance') {
      modeInput.innerHTML = `<input type="number" id="routes-input-distance" class="routes-number-input" min="1" max="60" value="${routesState.distanceKm}"> km`;
      el('routes-input-distance').oninput = e => { routesState.distanceKm = parseFloat(e.target.value) || 0; };
    } else {
      modeInput.innerHTML = `<input type="number" id="routes-input-duration" class="routes-number-input" min="10" max="480" value="${routesState.durationMin}"> minutes`;
      el('routes-input-duration').oninput = e => { routesState.durationMin = parseInt(e.target.value, 10) || 0; };
    }
    next.disabled = false;

  } else if (routesState.step === 2) {
    content.innerHTML = `
      <div class="wizard-question">Quel type de terrain ?</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'trail' ? 'active' : ''}" data-terrain="trail">Trail (chemins, sentiers)</button>
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'route' ? 'active' : ''}" data-terrain="route">Route (asphalte)</button>
      </div>
    `;
    content.querySelectorAll('.routes-toggle-btn').forEach(btn => {
      btn.onclick = () => { routesState.terrain = btn.dataset.terrain; renderRoutesStep(); };
    });
    next.disabled = false;

  } else if (routesState.step === 3 && routesHasAscentStep()) {
    content.innerHTML = `
      <div class="wizard-question">D+ visé ?</div>
      <div class="routes-number-row">
        <input type="number" id="routes-input-ascent" class="routes-number-input" min="0" max="5000" step="10" value="${routesState.ascentM}"> m
      </div>
      <div class="routes-hint">Si le secteur ne permet pas de l'atteindre, une boucle avec répétition de côte sera proposée en complément — avec un message clair si même ça ne suffit pas.</div>
    `;
    el('routes-input-ascent').oninput = e => { routesState.ascentM = parseInt(e.target.value, 10) || 0; };
    next.disabled = false;
  }
}

async function routesWizardNext() {
  const next = el('routes-nav-next');
  if (routesState.step === 0) {
    next.disabled = true;
    next.textContent = 'Recherche…';
    try {
      const res = await fetch(`${API}/api/routes/geocode?address=${encodeURIComponent(routesState.address)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Géocodage impossible');
      if (!data.candidates || data.candidates.length === 0) {
        showToast('Aucune adresse trouvée, précisez votre recherche', 'error');
        return;
      }
      const candidate = data.candidates[0];
      const ok = await showConfirmModal({
        title: 'Confirmer le point de départ',
        message: candidate.label,
        confirmLabel: 'Oui, c\'est ça',
        cancelLabel: 'Non, préciser',
        icon: '📍',
      });
      if (!ok) return;
      routesState.start = candidate;
      routesState.step = 1;
      renderRoutesStep();
    } catch (err) {
      showToast('Erreur : ' + err.message, 'error');
    } finally {
      next.disabled = false;
      next.textContent = 'Suivant →';
    }
    return;
  }

  if (routesState.step < routesTotalSteps() - 1) {
    routesState.step++;
    renderRoutesStep();
    return;
  }

  await routesGenerate();
}

function routesWizardBack() {
  if (routesState.step > 0) { routesState.step--; renderRoutesStep(); }
}

function routesRestart() {
  routesState.step = 0;
  routesState.results = null;
  showRoutesView('wizard');
  renderRoutesStep();
}

async function routesGenerate() {
  const next = el('routes-nav-next');
  next.disabled = true;
  next.textContent = 'Génération…';
  try {
    const targetDistanceM = routesState.mode === 'distance'
      ? routesState.distanceKm * 1000
      : routesState.durationMin * 1000 / 6.5; // estimation grossiere de bootstrap, la duree reelle est recalculee par tranche de pente sur le tracé obtenu

    const res = await fetch(`${API}/api/routes/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { lat: routesState.start.lat, lon: routesState.start.lon },
        targetDistanceM,
        targetAscentM: routesHasAscentStep() ? routesState.ascentM : null,
        terrain: routesState.terrain,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Génération impossible');
    routesState.results = data;
    renderRoutesResults(data);
    showRoutesView('results');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    next.disabled = false;
    next.textContent = 'Générer →';
  }
}

function renderRoutesResults(data) {
  const header = el('routes-results-header');
  header.innerHTML = `
    <div class="routes-results-title">${data.options.length > 1 ? 'Deux options trouvées' : 'Itinéraire proposé'}</div>
    ${data.warning ? `<div class="routes-warning-banner">${data.warning}</div>` : ''}
    ${data.paceProfileIsGeneric ? `<div class="routes-warning-banner routes-warning-banner--info">Durées estimées avec une allure générique — recalculez votre profil d'allure personnel dans Réglages pour des estimations plus fiables.</div>` : ''}
  `;

  const list = el('routes-results-list');
  list.innerHTML = '';
  data.options.forEach((opt, idx) => {
    const card = document.createElement('div');
    card.className = 'routes-result-card';
    const durH = Math.floor(opt.predictedDurationMin / 60);
    const durM = Math.round(opt.predictedDurationMin % 60);
    card.innerHTML = `
      <div class="routes-result-header">
        <div class="routes-result-label">${opt.label}</div>
      </div>
      <div class="routes-result-stats">
        <div class="routes-stat"><span class="routes-stat-value">${(opt.distanceM / 1000).toFixed(1)}</span><span class="routes-stat-unit">km</span></div>
        <div class="routes-stat"><span class="routes-stat-value">${opt.ascentM}</span><span class="routes-stat-unit">m D+</span></div>
        <div class="routes-stat"><span class="routes-stat-value">${durH}h${String(durM).padStart(2, '0')}</span><span class="routes-stat-unit">estimé</span></div>
      </div>
      <div class="routes-result-map" id="routes-map-${idx}"></div>
      <button class="btn-plans-restart routes-download-btn" data-idx="${idx}">⬇ Télécharger le GPX</button>
    `;
    list.appendChild(card);

    card.querySelector('.routes-download-btn').onclick = () => downloadRouteGpx(opt);
  });

  // Le DOM doit exister avant d'initialiser Leaflet
  setTimeout(() => {
    data.options.forEach((opt, idx) => renderRouteMap(`routes-map-${idx}`, opt.points));
  }, 0);
}

function renderRouteMap(mapDivId, points) {
  const mapDiv = el(mapDivId);
  if (!mapDiv || typeof L === 'undefined' || !points || points.length === 0) return;
  const latLngs = points.map(p => [p.lat, p.lon]);
  const bounds = L.latLngBounds(latLngs);
  const map = L.map(mapDiv, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
  }).addTo(map);
  L.polyline(latLngs, { color: '#2f6f3e', weight: 4 }).addTo(map);
  L.marker(latLngs[0]).addTo(map);
  map.fitBounds(bounds, { padding: [24, 24] });
}

async function downloadRouteGpx(option) {
  try {
    const res = await fetch(`${API}/api/routes/gpx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: option.points, label: option.label }),
    });
    if (!res.ok) throw new Error('Export GPX impossible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (option.label || 'itineraire').replace(/[^a-zA-Z0-9-_]+/g, '_') + '.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}
