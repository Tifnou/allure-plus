// routes.js — page "Itinéraires" : génération de parcours (BRouter côté serveur)
// Saisie du départ en cascade (code postal -> ville -> rue, API officielles
// françaises) : la sélection explicite à chaque étape vaut confirmation,
// pas besoin de modale bloquante. Résultats compacts, repliables par défaut.

function routesDefaultState() {
  return {
    postcode: '',
    communes: [],
    selectedCommune: null,   // { nom, code, lat, lon }
    street: '',
    selectedStreet: null,    // { label, lat, lon }
    mode: 'distance',        // 'distance' | 'duration'
    distanceKm: 10,
    durationMin: 60,
    terrain: 'trail',        // 'trail' | 'route'
    ascentM: 300,
    searchWider: false,
    searchRadiusKm: 5,
    lastResult: null,
    openIndex: null,         // index de la carte résultat ouverte (une seule à la fois)
  };
}

const routesState = routesDefaultState();

// Le formulaire gardait la saisie precedente (adresse, distance, D+...)
// jusqu'a un refresh complet de la page - aucun moyen de repartir a zero
// sans ca. Reinitialise tout l'etat aux valeurs par defaut et re-affiche
// un formulaire vierge.
function routesResetForm() {
  Object.assign(routesState, routesDefaultState());
  showRoutesView('form');
  renderRoutesForm();
  showToast('Formulaire réinitialisé', 'info');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function initRoutesPage() {
  showRoutesView('form');
  renderRoutesForm();
}

// Appelé depuis une carte de séance (Entraînements) pour pré-remplir les
// critères (durée, D+, terrain) avant de basculer sur la page Itinéraires -
// l'utilisateur n'a plus qu'à compléter le point de départ.
function goToRoutesWithPrefill(prefill = {}) {
  if (prefill.durationMin) {
    routesState.mode = 'duration';
    routesState.durationMin = Math.round(prefill.durationMin);
  }
  if (prefill.ascentM) {
    routesState.ascentM = Math.round(prefill.ascentM);
  }
  if (prefill.terrain) {
    routesState.terrain = prefill.terrain;
  }
  navigateTo('routes');
  showToast('Critères de la séance pré-remplis — complétez le point de départ', 'info');
}

function showRoutesView(view) {
  el('routes-form').style.display = view === 'form' ? '' : 'none';
  el('routes-results').style.display = view === 'results' ? '' : 'none';
}

function routesHasAscentField() { return routesState.terrain === 'trail'; }

function renderRoutesForm() {
  const content = el('routes-form-content');
  content.innerHTML = `
    <div class="routes-field">
      <div class="routes-field-label">Point de départ</div>
      <div class="routes-address-row">
        <div>
          <div class="routes-microlabel">Code postal</div>
          <input type="text" id="routes-input-postcode" class="routes-text-input" inputmode="numeric" maxlength="5" value="${routesState.postcode}">
        </div>
        <div>
          <div class="routes-microlabel">Ville</div>
          <select id="routes-input-city" class="routes-select" ${routesState.communes.length ? '' : 'disabled'}></select>
        </div>
      </div>
      <div class="routes-address-street">
        <div class="routes-microlabel">Rue (optionnel — vide = mairie)</div>
        <input type="text" id="routes-input-street" class="routes-text-input" value="${routesState.street}" ${routesState.selectedCommune ? '' : 'disabled'}>
        <div id="routes-street-suggestions" class="routes-suggestions" style="display:none"></div>
      </div>
      <div id="routes-start-confirm" class="routes-start-confirm" style="display:none"></div>
    </div>

    <div class="routes-field">
      <div class="routes-field-label">Distance ou durée visée</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'distance' ? 'active' : ''}" data-mode="distance">Distance</button>
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'duration' ? 'active' : ''}" data-mode="duration">Durée</button>
      </div>
      <div id="routes-mode-input" class="routes-number-row" style="margin-top:8px"></div>
    </div>

    <div class="routes-field">
      <div class="routes-field-label">Terrain</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'trail' ? 'active' : ''}" data-terrain="trail">Trail (chemins, sentiers)</button>
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'route' ? 'active' : ''}" data-terrain="route">Route (asphalte)</button>
      </div>
    </div>

    <div class="routes-field" id="routes-ascent-field" style="display:${routesHasAscentField() ? '' : 'none'}">
      <div class="routes-field-label">D+ visé</div>
      <div class="routes-number-row">
        <input type="number" id="routes-input-ascent" class="routes-number-input" min="0" max="5000" step="10" value="${routesState.ascentM}"> m
      </div>
      <div class="routes-hint">Si le secteur ne permet pas de l'atteindre sans trop s'écarter de la distance/durée demandée, la meilleure option trouvée sera proposée avec un message clair.</div>

      <label class="routes-checkbox-row">
        <input type="checkbox" id="routes-input-search-wider" ${routesState.searchWider ? 'checked' : ''}>
        Chercher dans un rayon de
        <input type="number" id="routes-input-search-radius" class="routes-number-input routes-number-input--xs" min="1" max="30" value="${routesState.searchRadiusKm}" ${routesState.searchWider ? '' : 'disabled'}> km
        si rien n'est disponible à l'adresse demandée
      </label>
    </div>
  `;

  wireRoutesAddressFields();

  content.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => { routesState.mode = btn.dataset.mode; renderRoutesForm(); };
  });
  content.querySelectorAll('[data-terrain]').forEach(btn => {
    btn.onclick = () => { routesState.terrain = btn.dataset.terrain; renderRoutesForm(); };
  });

  const modeInput = el('routes-mode-input');
  if (routesState.mode === 'distance') {
    modeInput.innerHTML = `<input type="number" id="routes-input-distance" class="routes-number-input" min="1" max="60" value="${routesState.distanceKm}"> km`;
    el('routes-input-distance').oninput = e => { routesState.distanceKm = parseFloat(e.target.value) || 0; };
  } else {
    modeInput.innerHTML = `<input type="number" id="routes-input-duration" class="routes-number-input" min="10" max="480" value="${routesState.durationMin}"> minutes`;
    el('routes-input-duration').oninput = e => { routesState.durationMin = parseInt(e.target.value, 10) || 0; };
  }

  if (routesHasAscentField()) {
    el('routes-input-ascent').oninput = e => { routesState.ascentM = parseInt(e.target.value, 10) || 0; };
    el('routes-input-search-wider').onchange = e => { routesState.searchWider = e.target.checked; renderRoutesForm(); };
    el('routes-input-search-radius').oninput = e => { routesState.searchRadiusKm = parseFloat(e.target.value) || 0; };
  }

  updateStartConfirmLine();
}

function wireRoutesAddressFields() {
  const postcodeInput = el('routes-input-postcode');
  const cityInput = el('routes-input-city');
  const streetInput = el('routes-input-street');

  postcodeInput.oninput = debounce(async (e) => {
    routesState.postcode = e.target.value.trim();
    routesState.communes = [];
    routesState.selectedCommune = null;
    routesState.selectedStreet = null;
    routesState.street = '';
    if (!/^\d{5}$/.test(routesState.postcode)) { renderRoutesForm(); return; }
    try {
      const res = await fetch(`${API}/api/routes/communes?postcode=${routesState.postcode}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Code postal introuvable');
      if (!data.communes || data.communes.length === 0) {
        showToast('Aucune ville trouvée pour ce code postal', 'error');
        return;
      }
      routesState.communes = data.communes;
      routesState.selectedCommune = data.communes.length === 1 ? data.communes[0] : null;
      renderRoutesForm();
    } catch (err) {
      showToast('Erreur : ' + err.message, 'error');
    }
  }, 400);

  if (routesState.communes.length) {
    const placeholder = routesState.selectedCommune ? '' : '<option value="" selected disabled>— Choisir —</option>';
    cityInput.innerHTML = placeholder + routesState.communes.map(c =>
      `<option value="${c.code}" ${routesState.selectedCommune && routesState.selectedCommune.code === c.code ? 'selected' : ''}>${c.nom}</option>`
    ).join('');
  }
  cityInput.onchange = () => {
    routesState.selectedCommune = routesState.communes.find(c => c.code === cityInput.value) || null;
    routesState.selectedStreet = null;
    routesState.street = '';
    renderRoutesForm();
  };

  streetInput.oninput = debounce(async (e) => {
    routesState.street = e.target.value;
    routesState.selectedStreet = null;
    updateStartConfirmLine();
    const box = el('routes-street-suggestions');
    if (!routesState.selectedCommune || routesState.street.trim().length < 2) {
      box.style.display = 'none';
      return;
    }
    try {
      const res = await fetch(`${API}/api/routes/street-suggestions?q=${encodeURIComponent(routesState.street)}&citycode=${routesState.selectedCommune.code}`);
      const data = await res.json();
      if (!data.suggestions || data.suggestions.length === 0) { box.style.display = 'none'; return; }
      box.innerHTML = data.suggestions.map((s, i) => `<div class="routes-suggestion-item" data-idx="${i}">${s.label}</div>`).join('');
      box.style.display = '';
      box.querySelectorAll('.routes-suggestion-item').forEach(item => {
        item.onclick = () => {
          const s = data.suggestions[parseInt(item.dataset.idx, 10)];
          routesState.selectedStreet = s;
          routesState.street = s.label;
          streetInput.value = s.label;
          box.style.display = 'none';
          updateStartConfirmLine();
        };
      });
    } catch (err) { box.style.display = 'none'; }
  }, 300);
}

function updateStartConfirmLine() {
  const line = el('routes-start-confirm');
  if (!routesState.selectedCommune) { line.style.display = 'none'; return; }
  const label = routesState.selectedStreet
    ? routesState.selectedStreet.label
    : `Mairie de ${routesState.selectedCommune.nom} (par défaut)`;
  line.style.display = '';
  line.innerHTML = `📍 Départ : ${label}`;
}

async function routesResolveStart() {
  if (!routesState.selectedCommune) {
    showToast('Renseignez un code postal et choisissez une ville', 'error');
    return null;
  }
  if (routesState.street.trim().length === 0) {
    const res = await fetch(`${API}/api/routes/town-hall?citycode=${routesState.selectedCommune.code}`);
    const data = await res.json();
    if (res.ok) return data.townHall;
    // La recherche de mairie repose sur une adresse "Place/Rue de la Mairie"
    // dans la Base Adresse Nationale — fiable dans les petites communes,
    // souvent absente dans les villes moyennes/grandes (autre nommage de
    // voirie autour de l'hôtel de ville). Plutôt que de bloquer la
    // génération, on repart du centre de la commune déjà connu (issu de
    // /api/routes/communes), toujours disponible.
    const c = routesState.selectedCommune;
    showToast(`Mairie non localisée précisément pour ${c.nom} — départ pris au centre de la commune`, 'info');
    return { label: `Centre de ${c.nom}`, lat: c.lat, lon: c.lon };
  }
  if (!routesState.selectedStreet) {
    showToast('Sélectionnez une rue dans la liste, ou videz le champ pour partir de la mairie', 'error');
    return null;
  }
  return routesState.selectedStreet;
}

function routesRestart() {
  routesState.lastResult = null;
  routesState.openIndex = null;
  showRoutesView('form');
  renderRoutesForm();
}

// Verifie que la tuile OSM couvrant ce depart est presente localement ;
// sinon propose le telechargement (taille reelle affichee) avant de
// poursuivre. Retourne false si l'utilisateur refuse ou si ca echoue.
async function routesEnsureTileAvailable(start, btn) {
  const res = await fetch(`${API}/api/routes/tile-check?lat=${start.lat}&lon=${start.lon}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Vérification des données cartographiques impossible');
  if (data.present) return true;

  const sizeLabel = data.sizeBytes ? `${Math.round(data.sizeBytes / 1024 / 1024)} Mo` : 'taille inconnue';
  const ok = await showConfirmModal({
    title: 'Données cartographiques manquantes',
    message: `Cette zone (tuile ${data.tileName}) n'est pas encore téléchargée sur cette machine (~${sizeLabel}). Télécharger maintenant ? Cela peut prendre plusieurs minutes.`,
    confirmLabel: 'Télécharger',
    cancelLabel: 'Annuler',
    icon: '🗺️',
  });
  if (!ok) return false;

  btn.textContent = 'Téléchargement des données (peut prendre plusieurs minutes)…';
  const dlRes = await fetch(`${API}/api/routes/tile-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: start.lat, lon: start.lon }),
  });
  const dlData = await dlRes.json();
  if (!dlRes.ok) throw new Error(dlData.error || 'Téléchargement des données cartographiques échoué');
  showToast('Données cartographiques téléchargées', 'success');
  return true;
}

async function routesGenerateClicked() {
  const btn = el('routes-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Génération…';
  try {
    const start = await routesResolveStart();
    if (!start) return;

    const tileReady = await routesEnsureTileAvailable(start, btn);
    if (!tileReady) return;
    btn.textContent = 'Génération…';

    const body = {
      start: { lat: start.lat, lon: start.lon },
      targetAscentM: routesHasAscentField() ? routesState.ascentM : null,
      terrain: routesState.terrain,
    };
    if (routesState.mode === 'distance') body.targetDistanceM = routesState.distanceKm * 1000;
    else body.targetDurationMin = routesState.durationMin;
    if (routesHasAscentField() && routesState.searchWider && routesState.searchRadiusKm > 0) {
      body.searchRadiusKm = routesState.searchRadiusKm;
    }

    const res = await fetch(`${API}/api/routes/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Génération impossible');

    routesState.lastResult = data;
    routesState.openIndex = null;
    renderRoutesResults(data);
    showRoutesView('results');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Générer →';
  }
}

function toggleRouteCard(idx) {
  routesState.openIndex = routesState.openIndex === idx ? null : idx;
  renderRoutesResults(routesState.lastResult);
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
    const open = routesState.openIndex === idx;
    const durH = Math.floor(opt.predictedDurationMin / 60);
    const durM = Math.round(opt.predictedDurationMin % 60);

    const card = document.createElement('div');
    card.className = 'routes-result-card';
    card.innerHTML = `
      <div class="routes-result-header" data-idx="${idx}">
        <span class="routes-result-chevron${open ? ' routes-result-chevron--open' : ''}">&#x25BC;</span>
        <span class="routes-result-label">${opt.label}</span>
        <div class="routes-mini-stats">
          <div class="routes-mini-stat"><b>${(opt.distanceM / 1000).toFixed(1)}</b> km</div>
          <div class="routes-mini-stat"><b>${opt.ascentM}</b> m D+</div>
          <div class="routes-mini-stat"><b>${durH}h${String(durM).padStart(2, '0')}</b></div>
        </div>
      </div>
      <div class="routes-result-body" style="display:${open ? '' : 'none'}">
        <div class="routes-commentary">${opt.commentary || ''}</div>
        <div class="routes-elev-container"><canvas id="routes-elev-${idx}"></canvas></div>
        <div class="routes-result-map" id="routes-map-${idx}"></div>
        <button class="btn-plans-restart routes-download-btn" id="routes-download-${idx}">⬇ Télécharger le GPX</button>
      </div>
    `;
    list.appendChild(card);
    card.querySelector('.routes-result-header').onclick = () => toggleRouteCard(idx);
    if (open) {
      card.querySelector(`#routes-download-${idx}`).onclick = () => downloadRouteGpx(opt);
    }
  });

  if (routesState.openIndex !== null) {
    const opt = data.options[routesState.openIndex];
    setTimeout(() => {
      renderRouteMap(`routes-map-${routesState.openIndex}`, opt.points);
      renderElevationChart(`routes-elev-${routesState.openIndex}`, opt.points);
    }, 0);
  }
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function renderElevationChart(canvasId, points) {
  const canvas = el(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !points || points.length === 0) return;
  let cum = 0;
  const labels = [];
  const data = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cum += haversineKm(points[i - 1], points[i]);
    labels.push(cum.toFixed(1) + ' km');
    data.push(Math.round(points[i].ele));
  }
  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.12)', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }] },
    options: typeof chartOptions === 'function' ? chartOptions() : { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
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
  L.polyline(latLngs, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
  L.marker(latLngs[0]).addTo(map);
  map.fitBounds(bounds, { padding: [20, 20] });
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
