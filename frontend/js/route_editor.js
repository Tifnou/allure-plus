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
let _routeEditorMapView = null; // {center, zoom} captures la vue courante avant chaque re-création de la carte Leaflet, pour ne pas la réinitialiser (fitBounds/dézoom) à chaque point posé/déplacé - remis à null uniquement sur un nouvel import/une nouvelle création/une fermeture, cf routeEditorClose/routeEditorStartCreation/handleRouteEditorFileSelected.
let _routeEditorSkipMapViewCapture = false; // cf routeEditorPlaceStartPoint : force UNE fois le fitBounds/setView automatique (tout premier point posé) au lieu de figer la vue par défaut "France entière" qui précède ce premier point.
let _routeEditorChart = null;
let _routeEditorLatLngs = null; // [lat,lon] du tracé courant, réutilisé par la sélection A/B
let _routeEditorSelectionLayer = null; // layerGroup Leaflet (marqueurs A/B + surbrillance)
let _routeEditorObjective = { targetDplusM: null, targetDistM: null }; // objectif D+/distance (PDF §9)
let _routeEditorMode = 'select'; // 'select' | 'move-point' | 'add-waypoint' - PDF §7/§25
let _routeEditorMovePickIdx = null; // index du point choisi en mode 'move-point', en attente de sa nouvelle position
let _routeEditorPreviewLayer = null; // layerGroup Leaflet (ancien tracé pointillé vs nouveau) pendant une prévisualisation de recalcul
let _routeEditorVariants = []; // [{id, name, points, stats, pois}] - versions nommées (PDF §10), distinctes de la pile Annuler/Rétablir linéaire

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
      <button type="button" class="route-editor-btn-secondary route-editor-create-btn" id="route-editor-create-btn">✏️ Créer un nouveau parcours</button>
      <div class="route-editor-import-hint">Le fichier original n'est jamais modifié — l'analyse porte sur une copie en mémoire.</div>`;
    const btn = el('route-editor-import-btn');
    if (btn) btn.onclick = () => el('route-editor-file-input')?.click();
    const createBtn = el('route-editor-create-btn');
    if (createBtn) createBtn.onclick = routeEditorStartCreation;
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

// Démarre un parcours vide (PDF §26, "Créer un parcours" de A à Z) - pas
// d'import, juste un tracé vide que l'utilisateur construit point par
// point en mode "extend" (cf onRouteEditorExtendClick). renderRouteEditorWorkspace
// gère nativement le cas stats===null (moins de 2 points, rien à
// analyser/afficher encore).
function routeEditorStartCreation() {
  _routeEditorData = { filename: 'Nouveau parcours', points: [], stats: null, pois: [] };
  _routeEditorOriginal = null;
  _routeEditorHistory = [];
  _routeEditorFuture = [];
  _routeEditorVariants = [];
  _routeEditorSelection = { aIdx: null, bIdx: null };
  _routeEditorObjective = { targetDplusM: null, targetDistM: null };
  _routeEditorMode = 'extend';
  _routeEditorMapView = null;
  _routeEditorSkipMapViewCapture = false;
  renderRouteEditorImportStatus();
  renderRouteEditorWorkspace();
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
  _routeEditorVariants = [];
  _routeEditorSelection = { aIdx: null, bIdx: null };
  _routeEditorObjective = { targetDplusM: null, targetDistM: null };
  if (_routeEditorMap) { _routeEditorMap.remove(); _routeEditorMap = null; }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  _routeEditorMapView = null;
  _routeEditorSkipMapViewCapture = false;
  _routeEditorLatLngs = null;
  _routeEditorSelectionLayer = null;
  _routeEditorPreviewLayer = null;
  _routeEditorMode = 'select';
  _routeEditorMovePickIdx = null;
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
    _routeEditorData = { ...data, pois: [] };
    _routeEditorOriginal = { points: data.points, stats: data.stats, pois: [] };
    _routeEditorHistory = [];
    _routeEditorFuture = [];
    _routeEditorVariants = [];
    _routeEditorSelection = { aIdx: null, bIdx: null };
    _routeEditorObjective = { targetDplusM: null, targetDistM: null };
    _routeEditorMapView = null;
    _routeEditorSkipMapViewCapture = false;
    renderRouteEditorImportStatus();
    renderRouteEditorWorkspace();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    renderRouteEditorImportStatus();
  }
}

// Barre d'outils de mode, commune aux deux gabarits (tracé "en
// construction" sans stats, et workspace complet) - un seul endroit pour
// ces 5 boutons plutôt que de les dupliquer dans les deux templates.
// Chaque bouton est désactivé tant que le tracé n'a pas assez de points pour
// que le mode ait un sens (minPoints) - avant ça, rien n'empêchait de
// cliquer "Sélectionner A→B" et de crasher sur la carte vide (cf
// onRouteEditorMapClick) ; en plus d'être une 2e ligne de défense contre ce
// crash, ça rend le flux "que faire en premier ?" évident au lieu de
// proposer 5 boutons d'apparence égale dès l'écran vide (retour
// utilisateur). Un title (tooltip natif) sur chaque bouton explique son
// usage - demande explicite ("des infos sur les menus... qu'on sache à quoi
// ça correspond").
const ROUTE_EDITOR_MODES = [
  { mode: 'extend', icon: '➕', label: 'Prolonger le tracé', minPoints: 0,
    title: 'Cliquez sur la carte pour ajouter des points à la suite du tracé (ou pour poser le tout premier point).' },
  { mode: 'select', icon: '🖱️', label: 'Sélectionner A→B', minPoints: 2,
    title: 'Cliquez deux points du tracé (carte ou profil) pour choisir une section : la répéter, lui appliquer un objectif D+/distance...' },
  { mode: 'move-point', icon: '✏️', label: 'Déplacer un point', minPoints: 3,
    title: 'Cliquez un point du tracé à déplacer, puis cliquez son nouvel emplacement. Astuce : les points de départ/arrivée et ceux posés en « Prolonger le tracé » se déplacent aussi directement à la souris (glisser-déposer).' },
  { mode: 'add-waypoint', icon: '📍', label: 'Ajouter un point de passage', minPoints: 2,
    title: 'Force le tracé à passer par un endroit précis entre A et B - sélectionnez d\'abord une section avec « Sélectionner A→B ».' },
  { mode: 'poi', icon: '📌', label: 'Point d\'intérêt', minPoints: 1,
    title: 'Cliquez un point du tracé pour y ajouter un ravitaillement, un point d\'eau, un sommet...' },
];
function routeEditorModeToolbarHtml() {
  const count = (_routeEditorData?.points || []).length;
  const buttons = ROUTE_EDITOR_MODES.map(m => {
    const disabled = count < m.minPoints;
    return `<button type="button" class="routes-toggle-btn route-editor-mode-btn route-editor-tip ${_routeEditorMode === m.mode ? 'active' : ''}" data-mode="${m.mode}" data-tip="${escapeHtml(m.title)}" ${disabled ? 'disabled' : ''}>${m.icon} ${escapeHtml(m.label)}</button>`;
  }).join('');
  return `
    <div class="route-editor-mode-toolbar routes-toggle">
      ${buttons}
      <label class="route-editor-profile-select-label route-editor-tip" data-tip="Type de terrain utilisé pour calculer les tronçons (Prolonger le tracé, Déplacer un point...).">Profil de routage
        <select id="route-editor-profile-select" class="routes-select">
          <option value="trail:mixte">Trail (mixte)</option>
          <option value="trail:roulant">Trail (roulant)</option>
          <option value="trail:technique">Trail (technique)</option>
          <option value="route">Route</option>
        </select>
      </label>
    </div>`;
}

// Profil de routage courant (Trail roulant/mixte/technique ou Route) -
// PDF §26.4, "le profil reste modifiable pendant la construction" :
// partagé par tous les modes qui appellent BRouter (recalculer une
// section, déplacer un point, ajouter un point de passage, prolonger le
// tracé), un seul sélecteur dans la barre d'outils plutôt qu'un par mode.
function routeEditorCurrentProfile() {
  const [terrain, trailStyle] = (el('route-editor-profile-select')?.value || 'trail:mixte').split(':');
  return { terrain, trailStyle };
}

function wireRouteEditorModeToolbar(ws) {
  ws.querySelectorAll('.route-editor-mode-btn').forEach(btn => {
    btn.onclick = () => setRouteEditorMode(btn.dataset.mode);
  });
  renderRouteEditorModeHint();
}

// Tracé en cours de construction (mode "extend", moins de 2 points) : rien
// à analyser/afficher encore (stats/profil/côtes), juste la carte pour
// poser les points suivants (PDF §26.1). Dès que 2 points existent, le
// gabarit complet ci-dessous (renderRouteEditorWorkspace) prend le relais
// normalement, sans distinction particulière.
function renderRouteEditorWorkspaceInProgress() {
  const ws = el('route-editor-workspace');
  ws.style.display = '';
  const points = _routeEditorData?.points || [];
  // Avant le tout 1er point, l'ancien indice discret ("Cliquez sur la carte
  // pour poser le premier point...", sous la carte) passait facilement
  // inaperçu (retour utilisateur : flux "pas intuitif") - une carte
  // d'accroche explicite au-dessus, + la recherche d'adresse comme
  // alternative au clic direct sur la carte (utile pour démarrer un
  // parcours loin de la position affichée par défaut).
  const startCta = points.length === 0 ? `
    <div class="route-editor-start-cta">
      <div class="route-editor-start-cta-title">📍 Placez le point de départ</div>
      <div class="route-editor-start-cta-text">Cliquez sur la carte ci-dessous, ou recherchez une adresse.</div>
      ${routeEditorStartFinderHtml()}
    </div>` : '';
  ws.innerHTML = `
    ${routeEditorModeToolbarHtml()}
    ${startCta}
    <div class="gpx-profile-map" id="route-editor-map"></div>
    <div id="route-editor-mode-hint" class="route-editor-hint"></div>
    <div id="route-editor-extend-controls"></div>
    <div class="route-editor-actions">
      ${points.length ? `<button type="button" class="route-editor-btn-secondary" id="route-editor-undo-inprogress-btn">↶ Annuler le dernier point</button>` : ''}
      <button type="button" class="route-editor-btn-secondary" id="route-editor-close-creation-btn">✕ Annuler la création</button>
    </div>`;
  wireRouteEditorModeToolbar(ws);
  renderRouteEditorExtendControls();
  if (points.length === 0) wireRouteEditorStartFinder();
  const closeBtn = el('route-editor-close-creation-btn');
  if (closeBtn) closeBtn.onclick = routeEditorClose;
  const undoBtn = el('route-editor-undo-inprogress-btn');
  if (undoBtn) undoBtn.onclick = routeEditorUndo;
  if (_routeEditorMap) {
    if (_routeEditorSkipMapViewCapture) { _routeEditorMapView = null; _routeEditorSkipMapViewCapture = false; }
    else _routeEditorMapView = { center: _routeEditorMap.getCenter(), zoom: _routeEditorMap.getZoom() };
    _routeEditorMap.remove(); _routeEditorMap = null;
  }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  renderRouteEditorVisuals();
}

// Recherche d'adresse pour placer le point de départ sans avoir à le
// repérer à l'œil sur la carte (retour utilisateur) - réutilise
// /api/routes/geocode (Nominatim), déjà utilisé par le générateur
// d'itinéraires pour la même raison. Volontairement limité au tout premier
// point (avant, la carte part dézoomée sur la France entière) : une fois le
// tracé commencé, se déplacer dessus se fait naturellement en zoomant/
// déplaçant la carte normale.
function routeEditorStartFinderHtml() {
  return `
    <div class="route-editor-start-finder">
      <input type="text" id="route-editor-start-address" class="routes-text-input" placeholder="Adresse, ville ou code postal..." />
      <button type="button" id="route-editor-start-address-btn" class="route-editor-btn-secondary">🔍 Rechercher</button>
    </div>
    <div id="route-editor-start-address-results"></div>`;
}

function wireRouteEditorStartFinder() {
  const input = el('route-editor-start-address');
  const btn = el('route-editor-start-address-btn');
  const results = el('route-editor-start-address-results');
  if (!input || !btn || !results) return;
  const runSearch = async () => {
    const address = input.value.trim();
    if (!address) return;
    results.innerHTML = '<div class="route-editor-start-finder-status">⏳ Recherche…</div>';
    try {
      const res = await fetch(`${API}/api/routes/geocode?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recherche impossible');
      const candidates = data.candidates || [];
      if (!candidates.length) {
        results.innerHTML = '<div class="route-editor-start-finder-status">Aucun résultat.</div>';
        return;
      }
      results.innerHTML = `<div class="route-editor-start-finder-list">${candidates.map((c, i) =>
        `<button type="button" class="route-editor-start-finder-item" data-idx="${i}">📍 ${escapeHtml(c.label)}</button>`).join('')}</div>`;
      results.querySelectorAll('.route-editor-start-finder-item').forEach(item => {
        item.onclick = () => {
          const c = candidates[parseInt(item.dataset.idx, 10)];
          if (_routeEditorMap) _routeEditorMap.setView([c.lat, c.lon], 15);
          routeEditorPlaceStartPoint(c.lat, c.lon);
        };
      });
    } catch (err) {
      results.innerHTML = `<div class="route-editor-start-finder-status">Erreur : ${escapeHtml(err.message)}</div>`;
    }
  };
  btn.onclick = runSearch;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } };
}

// Bouton "Fermer la boucle" (PDF §26.5) : affiché uniquement en mode
// "extend" avec au moins 2 points déjà posés (sinon rien à fermer).
// Fonctionne dans les deux gabarits (tracé en construction et workspace
// complet une fois ≥2 points), d'où un conteneur+fonction partagés.
function renderRouteEditorExtendControls() {
  const box = el('route-editor-extend-controls');
  if (!box) return;
  const points = _routeEditorData?.points || [];
  if (_routeEditorMode !== 'extend' || points.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = `<button type="button" class="route-editor-btn-secondary" id="route-editor-close-loop-btn">🔁 Fermer la boucle</button>`;
  const btn = el('route-editor-close-loop-btn');
  if (btn) btn.onclick = () => routeEditorExtendTrack(points[points.length - 1], { lat: points[0].lat, lon: points[0].lon });
}

// Résumé intelligent (PDF §19) : texte templé à partir des stats déjà
// calculées (aucun appel serveur, aucun LLM) - même esprit que l'exemple
// du PDF ("difficulté concentrée entre les km X et Y, qui regroupent Z% du
// D+"). La côte au plus fort gainM sert à la fois de "zone de
// concentration" et de "montée la plus exigeante" (le PDF les traite comme
// un seul exemple cohérent). La phrase marche active ne s'affiche que si
// une stratégie a déjà été calculée pour CE tracé (cf reset de
// _routeEditorLastStrategy à chaque changement de points).
function buildRouteEditorSummary(stats) {
  if (!stats) return '';
  const distKm = (stats.totalDistM / 1000).toFixed(1);
  const climbs = stats.climbs || [];
  let text = `Ce parcours de <b>${distKm} km</b> comporte <b>${stats.ascentM} m D+</b>.`;
  if (climbs.length && stats.ascentM > 0) {
    const biggest = climbs.reduce((best, c) => (!best || c.gainM > best.gainM) ? c : best, null);
    const pct = Math.round((biggest.gainM / stats.ascentM) * 100);
    text += ` La difficulté est principalement concentrée entre les kilomètres ${biggest.startKm.toFixed(1)} et ${biggest.endKm.toFixed(1)}, qui regroupent près de ${pct}% du dénivelé positif. La montée la plus exigeante mesure ${(biggest.distM / 1000).toFixed(1)} km pour +${biggest.gainM} m, soit ${biggest.avgGradePct.toFixed(1)}% de moyenne.`;
  } else {
    text += ` Aucune côte significative détectée sur ce tracé.`;
  }
  if (_routeEditorLastStrategy && _routeEditorLastStrategyPoints === _routeEditorData.points && _routeEditorLastStrategy.sections?.some(s => s.marcheActive)) {
    text += ` Pour l'objectif renseigné, il sera probablement préférable de gérer les premières montées et de privilégier la marche active sur les portions les plus pentues.`;
  }
  return text;
}

function renderRouteEditorWorkspace() {
  const ws = el('route-editor-workspace');
  if (!ws || !_routeEditorData) return;
  const stats = _routeEditorData.stats;
  if (!stats) { renderRouteEditorWorkspaceInProgress(); return; }
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
    <div class="route-editor-summary-card">📝 ${buildRouteEditorSummary(stats)}</div>
    ${routeEditorModeToolbarHtml()}
    <div class="gpx-profile-map" id="route-editor-map"></div>
    <div class="gpx-profile-legend">
      ${GPX_GRADE_BANDS.map(b => `<span class="gpx-profile-legend-item"><span class="gpx-profile-legend-dot" style="background:${b.color}"></span>${b.label}</span>`).join('')}
    </div>
    <div class="gpx-profile-elev-container"><canvas id="route-editor-elev-chart"></canvas></div>
    <div id="route-editor-mode-hint" class="route-editor-hint"></div>
    <div id="route-editor-extend-controls"></div>
    <div id="route-editor-reroute-preview"></div>
    <div class="route-editor-actions route-editor-actions--top">
      <button type="button" class="route-editor-btn-secondary" id="route-editor-undo-btn" ${_routeEditorHistory.length ? '' : 'disabled'}>↶ Annuler</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-redo-btn" ${_routeEditorFuture.length ? '' : 'disabled'}>↷ Rétablir</button>
      <button type="button" class="route-editor-btn-secondary" id="route-editor-restore-btn" ${isOriginal ? 'disabled' : ''}>Restaurer l'original</button>
      <button type="button" class="btn-plans-restart" id="route-editor-export-btn">⬇️ Exporter le GPX</button>
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
    <div id="route-editor-poi-table-wrap"></div>
    <div class="route-editor-section-title">Variantes</div>
    <div class="route-editor-actions" style="margin-top:0">
      <button type="button" class="route-editor-btn-secondary" id="route-editor-save-variant-btn">💾 Enregistrer la version actuelle</button>
    </div>
    <div id="route-editor-variants-table-wrap"></div>
    <div class="route-editor-section-title">Stratégie de course</div>
    <div class="route-editor-strategy-card">
      <label>Objectif de temps (optionnel) <input type="time" id="route-editor-strategy-target" class="routes-text-input" style="width:110px" /></label>
      <button type="button" class="btn-plans-restart" id="route-editor-strategy-btn">Calculer la stratégie</button>
      <span class="route-editor-objective-hint">Répartit l'effort section par section selon votre profil d'allure personnel (calibré sur vos sorties Garmin), avec marche active sur les pentes très fortes — pas une allure unique partout.</span>
    </div>
    <div id="route-editor-strategy-result"></div>`;

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
  wireRouteEditorModeToolbar(ws);
  renderRouteEditorExtendControls();
  renderRouteEditorPoiTable();
  const saveVariantBtn = el('route-editor-save-variant-btn');
  if (saveVariantBtn) saveVariantBtn.onclick = onRouteEditorSaveVariantClick;
  renderRouteEditorVariantsTable();
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

  if (_routeEditorMap) {
    if (_routeEditorSkipMapViewCapture) { _routeEditorMapView = null; _routeEditorSkipMapViewCapture = false; }
    else _routeEditorMapView = { center: _routeEditorMap.getCenter(), zoom: _routeEditorMap.getZoom() };
    _routeEditorMap.remove(); _routeEditorMap = null;
  }
  if (_routeEditorChart) { _routeEditorChart.destroy(); _routeEditorChart = null; }
  // La carte/les calques qui viennent d'être détruits emportent avec eux
  // toute référence de calque encore tenue - repartir d'un mode d'édition
  // propre plutôt que de laisser un point "en attente de déplacement"
  // survivre à un tracé qui vient de changer (indices potentiellement plus
  // valides après une répétition/un recalcul).
  _routeEditorSelectionLayer = null;
  _routeEditorPreviewLayer = null;
  // Le mode "extend" (prolonger le tracé/fermer la boucle) ne retient
  // aucun index en attente contrairement à "move-point" - contrairement
  // aux autres modes, il reste donc actif d'un rendu a l'autre : sinon,
  // ajouter UN point en mode creation repasserait en mode "select" des que
  // les stats deviennent disponibles (>= 2 points), coupant la
  // construction du tracé après un seul clic.
  if (_routeEditorMode !== 'extend') _routeEditorMode = 'select';
  _routeEditorMovePickIdx = null;
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
    // Tuiles OSM standard (pas CARTO Voyager comme ailleurs dans l'app) :
    // en mode "Creer un parcours de zero", la vue par defaut est tres
    // dezoomee (France entiere, aucun point pose) - a ce niveau de zoom,
    // les tuiles CARTO Voyager affichent les noms de mers/pays via leur
    // calque Natural Earth, qui est fige en anglais ("Bay of Biscay",
    // "English Channel"...) contrairement aux tuiles OSM standard qui
    // suivent toujours le tag "name" local. Non visible sur les autres
    // cartes CARTO de l'app car elles sont toujours zoomees sur un trace
    // GPS precis (fitBounds), jamais sur un pays entier.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org">OSM</a>',
    }).addTo(map);
    if (latLngs.length > 1) {
      bins.forEach(bin => {
        const seg = latLngs.slice(bin.startIdx, bin.endIdx + 1);
        if (seg.length > 1) L.polyline(seg, { color: gpxGradeBand(bin.gradePct).color, weight: 4 }).addTo(map);
      });
    }
    if (_routeEditorMapView) {
      // Un zoom/pan a déjà été choisi par l'utilisateur lors d'un rendu
      // précédent de cette même session d'édition (cf capture juste avant
      // .remove() dans renderRouteEditorWorkspace*) - le restaurer tel quel
      // plutôt que de recadrer automatiquement à chaque point posé/déplacé
      // (retour utilisateur : "ça dézoome automatiquement" à chaque clic).
      map.setView(_routeEditorMapView.center, _routeEditorMapView.zoom);
    } else if (latLngs.length === 0) {
      // Tracé vide (mode "extend", création de zéro pas encore commencée) -
      // vue par défaut sur la France, pas de fitBounds possible sans point.
      map.setView([46.6, 2.5], 6);
    } else if (latLngs.length === 1) {
      // Un seul point posé : rien à router encore (2e clic requis), juste
      // le marqueur de départ.
      map.setView(latLngs[0], 14);
    } else {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [12, 12] });
    }
    renderRouteEditorAnchorMarkers(map, points);
    map.on('click', e => onRouteEditorMapClick(e.latlng, points));
    _routeEditorMap = map;
    renderRouteEditorSelectionOverlay();
    renderRouteEditorPoiOverlay();
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

// Marqueurs déplaçables par glisser-déposer (retour utilisateur : la seule
// façon de déplacer un point était le mode "Déplacer un point", 2 clics -
// pas assez direct). Limité au départ, à l'arrivée, et aux points posés
// explicitement par un clic en mode "Prolonger le tracé" (flag
// points[i].anchor, cf onRouteEditorExtendClick/routeEditorPlaceStartPoint)
// - PAS tous les points bruts du tracé (souvent des centaines, issus du
// routage BRouter entre deux clics : les afficher tous en marqueurs
// déplaçables noierait la carte). Le mode "Déplacer un point" reste
// disponible pour ces points intermédiaires (et pour un GPX importé, qui
// n'a aucun point "anchor").
function renderRouteEditorAnchorMarkers(map, points) {
  if (!points.length) return;
  const group = L.layerGroup();
  points.forEach((p, idx) => {
    const isStart = idx === 0;
    const isEnd = idx === points.length - 1;
    if (!isStart && !isEnd && !p.anchor) return;
    // icon omis (pas juste mis à `undefined`) pour départ/arrivée : Leaflet
    // n'utilise son icône par défaut que si la clé "icon" est absente des
    // options, une valeur explicitement undefined écrase quand même le
    // défaut et fait planter le marqueur (this.options.icon.createIcon()).
    const markerOpts = { draggable: true };
    if (!isStart && !isEnd) {
      markerOpts.icon = L.divIcon({ html: '<span class="route-editor-anchor-marker"></span>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
    }
    const marker = L.marker([p.lat, p.lon], markerOpts).addTo(group);
    marker.bindTooltip(isStart ? 'Départ (glisser pour déplacer)' : isEnd ? 'Arrivée (glisser pour déplacer)' : 'Glisser pour déplacer ce point');
    marker.on('dragend', () => onRouteEditorAnchorDragEnd(idx, marker.getLatLng()));
  });
  group.addTo(map);
}

// Glisser-déposer d'un point ancre (départ/arrivée/point posé en mode
// "Prolonger le tracé") : recalcule directement l'itinéraire autour du
// nouvel emplacement (pas d'étape "Appliquer" intermédiaire comme le mode
// "Déplacer un point" - le geste de glisser-déposer EST déjà la
// confirmation, et Annuler est maintenant juste au-dessus de la carte en
// cas d'erreur). Un seul point sur le tracé : rien à router, juste
// déplacer + rafraîchir l'altitude IGN. Départ/arrivée : un seul côté à
// reancrer, élargi (routeEditorWidenBackward/Forward) plutôt que le simple
// voisin immédiat, même raison que onRouteEditorMovePointClick (marge
// géométrique insuffisante pour BRouter sinon, aller-retour visible). Point
// intermédiaire : les deux côtés élargis - BRouter route depuis leurs
// coordonnées exactes quoi qu'il arrive, peu importe qu'ils soient eux-mêmes
// une ancre ou un point intermédiaire déjà routé.
async function onRouteEditorAnchorDragEnd(idx, latlng) {
  const points = _routeEditorData.points;
  if (points.length === 1) {
    _routeEditorHistory.push({ points: [...points], stats: null, pois: [] });
    _routeEditorFuture = [];
    let ele = points[0].ele || 0;
    try {
      const res = await fetch(`${API}/api/route-editor/elevation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: latlng.lat, lon: latlng.lng }),
      });
      const data = await res.json();
      if (res.ok && typeof data.ele === 'number') ele = data.ele;
    } catch (err) { /* repli silencieux sur l'ancienne altitude */ }
    _routeEditorData = { ..._routeEditorData, points: [{ lat: latlng.lat, lon: latlng.lng, ele, anchor: true }] };
    renderRouteEditorWorkspace();
    return;
  }

  let startIdx, endIdx, waypoints;
  if (idx === 0) {
    startIdx = 0; endIdx = routeEditorWidenForward(points, 1);
    waypoints = [{ lat: latlng.lat, lon: latlng.lng }, { lat: points[endIdx].lat, lon: points[endIdx].lon }];
  } else if (idx === points.length - 1) {
    startIdx = routeEditorWidenBackward(points, idx - 1); endIdx = idx;
    waypoints = [{ lat: points[startIdx].lat, lon: points[startIdx].lon }, { lat: latlng.lat, lon: latlng.lng }];
  } else {
    startIdx = routeEditorWidenBackward(points, idx - 1); endIdx = routeEditorWidenForward(points, idx + 1);
    waypoints = [
      { lat: points[startIdx].lat, lon: points[startIdx].lon },
      { lat: latlng.lat, lon: latlng.lng },
      { lat: points[endIdx].lat, lon: points[endIdx].lon },
    ];
  }

  try {
    const tileOk = await routeEditorEnsureTileAvailable({ lat: latlng.lat, lon: latlng.lng });
    if (!tileOk) { renderRouteEditorVisuals(); return; } // remet le marqueur à sa place (rien n'a changé)
    const { terrain, trailStyle } = routeEditorCurrentProfile();
    const res = await fetch(`${API}/api/route-editor/reroute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, startIdx, endIdx, waypoints, terrain, trailStyle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Recalcul impossible');

    // Retrouve, dans le tronçon recalculé, le point le plus proche du
    // nouvel emplacement pour lui reporter le flag anchor (le tronçon
    // renvoyé par le serveur est fait de coordonnées fraîches, sans lien
    // d'identité avec l'ancien point déplacé).
    let newPoints = data.points;
    const segStart = startIdx, segEnd = startIdx + data.segmentPoints.length - 1;
    let bestI = segStart, bestD = Infinity;
    for (let i = segStart; i <= segEnd; i++) {
      const dLat = newPoints[i].lat - latlng.lat, dLon = newPoints[i].lon - latlng.lng;
      const d = dLat * dLat + dLon * dLon;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    newPoints = newPoints.map((p, i) => i === bestI ? { ...p, anchor: true } : p);
    const newStats = await routeEditorAnalyzePoints(newPoints);
    applyRouteEditorReroute(newPoints, newStats);
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    renderRouteEditorVisuals(); // remet le marqueur à sa place (rien n'a changé)
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

// Recule/avance depuis un index donné jusqu'à ce que la distance cumulée sur
// le tracé atteigne minDistKm (par défaut 120 m), au lieu de s'arrêter au
// tout premier voisin du tableau `points` - sur un GPX importé (ou un
// tronçon déjà routé par BRouter), deux points consécutifs peuvent n'être
// espacés que de quelques mètres (résolution d'enregistrement/lissage). Aller
// chercher une liaison entre des ancres aussi rapprochées ne laisse quasiment
// aucune marge géométrique à BRouter pour rejoindre un nouvel emplacement
// autrement qu'en aller-retour (avant/après le point déplacé sont presque au
// même endroit) - bug réel constaté (retour utilisateur, capture d'écran :
// aller-retour visible sur la carte et pic en V sur le profil). Reculer/
// avancer jusqu'à une distance minimale redonne assez d'espace pour que
// BRouter reforme une vraie boucle passant par le nouveau point plutôt que
// de rebrousser chemin. Utilisé par onRouteEditorMovePointClick et
// onRouteEditorAnchorDragEnd (glisser-déposer), les deux endroits qui
// recalculaient jusqu'ici sur les voisins immédiats idx-1/idx+1.
// maxDistKm : un troncon de trace peut avoir des points bruts tres espacés
// par endroits (long segment droit posé en un seul clic "Prolonger le
// tracé", peu de points intermédiaires renvoyés par BRouter) - sans ce
// plafond, un SEUL pas de la boucle ci-dessous peut à lui seul faire
// exploser la fenêtre bien au-delà des ~120m visés (bug réel constaté,
// retour utilisateur : avant/après retrouvés à 760-960m du point déplacé
// au lieu de ~120m, ce qui a fait échouer le recalcul en 2 tronçons plus
// bas dans la chaîne - le vrai avant/après du point n'a pas de raison
// d'être aussi loin). Mieux vaut s'arrêter net à l'ancre la plus proche
// déjà atteinte que de sauter à un point sans rapport à cause d'un simple
// trou dans la densité des points bruts.
function routeEditorWidenBackward(points, fromIdx, minDistKm = 0.12, maxDistKm = minDistKm * 2.5) {
  let i = fromIdx, dist = 0;
  while (i > 0 && dist < minDistKm) {
    const step = haversineKm(points[i - 1], points[i]);
    if (dist + step > maxDistKm) break;
    dist += step;
    i--;
  }
  return i;
}
function routeEditorWidenForward(points, fromIdx, minDistKm = 0.12, maxDistKm = minDistKm * 2.5) {
  let i = fromIdx, dist = 0;
  while (i < points.length - 1 && dist < minDistKm) {
    const step = haversineKm(points[i], points[i + 1]);
    if (dist + step > maxDistKm) break;
    dist += step;
    i++;
  }
  return i;
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

// Change de mode d'interaction carte/profil (PDF §7/§25) - "select" pose
// A/B pour répétition/objectif/recalcul de section (comportement d'origine,
// inchangé) ; "move-point"/"add-waypoint" branchent le clic carte vers
// onRouteEditorMapClick ci-dessous. Change de mode = repartir de zéro
// (efface toute sélection/point en attente pour éviter un état incohérent
// entre deux modes différents).
function setRouteEditorMode(mode) {
  if (mode === _routeEditorMode) return;
  _routeEditorMode = mode;
  _routeEditorMovePickIdx = null;
  clearRouteEditorReroutePreview();
  document.querySelectorAll('.route-editor-mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  renderRouteEditorModeHint();
  renderRouteEditorExtendControls();
}

function renderRouteEditorModeHint() {
  const hint = el('route-editor-mode-hint');
  if (!hint) return;
  if (_routeEditorMode === 'move-point') {
    hint.textContent = _routeEditorMovePickIdx == null
      ? 'Cliquez sur le point du tracé à déplacer.'
      : 'Cliquez sur la carte à l\'endroit où déplacer ce point.';
  } else if (_routeEditorMode === 'add-waypoint') {
    hint.textContent = _routeEditorSelection.aIdx == null || _routeEditorSelection.bIdx == null
      ? 'Sélectionnez d\'abord une section A→B (mode "Sélectionner A→B"), puis revenez ici.'
      : 'Cliquez sur la carte à l\'endroit par où le tracé doit obligatoirement passer.';
  } else if (_routeEditorMode === 'extend') {
    const points = _routeEditorData?.points || [];
    hint.textContent = points.length === 0
      ? 'Cliquez sur la carte pour poser le premier point du parcours.'
      : 'Cliquez sur la carte pour prolonger le tracé jusqu\'à ce point.';
  } else if (_routeEditorMode === 'poi') {
    hint.textContent = 'Cliquez sur un point du tracé pour y ajouter un point d\'intérêt (ravitaillement, eau, sommet…).';
  } else {
    hint.textContent = '';
  }
}

// Dispatcher unique pour le clic carte, selon le mode actif. Tous les modes
// sauf "extend" supposent un tracé déjà commencé (ils sélectionnent/déplacent/
// annotent un point EXISTANT) - sans ce garde-fou, cliquer la carte en mode
// "Sélectionner A→B" (ou tout autre mode) avant d'avoir posé le premier point
// plantait : _routeEditorLatLngs est vide, L.circleMarker(undefined) leve une
// exception dans Leaflet (chargé en cross-origin depuis unpkg.com, d'où le
// message générique "Script error." sans détail côté bandeau d'erreur JS) -
// bug réel constaté (retour utilisateur, capture d'écran). Plutôt qu'un
// crash silencieux, un message clair renvoie vers le mode "Prolonger le
// tracé" (les boutons de mode sont eux-mêmes désactivés tant qu'il n'y a pas
// assez de points, cf routeEditorModeToolbarHtml - ce garde-fou reste une
// 2e ligne de défense, ex: clic sur le profil altimétrique via onClick).
function onRouteEditorMapClick(latlng, points) {
  if (_routeEditorMode === 'extend') { onRouteEditorExtendClick(latlng); return; }
  if (!points.length) {
    showToast('Placez d\'abord un point de départ (mode "➕ Prolonger le tracé").', 'error');
    return;
  }
  if (_routeEditorMode === 'move-point') { onRouteEditorMovePointClick(latlng, points); return; }
  if (_routeEditorMode === 'add-waypoint') { onRouteEditorAddWaypointClick(latlng); return; }
  if (_routeEditorMode === 'poi') { onRouteEditorPoiClick(findNearestRouteEditorPointIndex(latlng, points)); return; }
  onRouteEditorPointClick(findNearestRouteEditorPointIndex(latlng, points));
}

// Mode "extend" (PDF §26 - créer de zéro / prolonger un tracé existant) :
// 1er clic sur un tracé vide pose juste le premier point (pas d'appel
// BRouter, rien à router avec un seul point) ; les clics suivants routent
// depuis le DERNIER point du tracé jusqu'au point cliqué et l'ajoutent en
// fin de parcours. Même bouton "Fermer la boucle" utilise
// routeEditorExtendTrack directement avec le premier point comme cible.
function onRouteEditorExtendClick(latlng) {
  const points = _routeEditorData.points;
  if (!points.length) {
    routeEditorPlaceStartPoint(latlng.lat, latlng.lng);
    return;
  }
  routeEditorExtendTrack(points[points.length - 1], { lat: latlng.lat, lon: latlng.lng });
}

// Pose le tout premier point du tracé (clic carte OU recherche d'adresse,
// cf routeEditorStartFinderHtml) - factorisé pour que les deux chemins
// recuperent la VRAIE altitude IGN (/api/route-editor/elevation) au lieu de
// la figer a 0m : avec un seul point, rien a router (BRouter ne s'applique
// qu'a partir de 2 points), donc rien ne corrigeait cette altitude avant que
// le 2e point ne soit pose - un D+ absurde entre les deux (bug reel, ex:
// +152m sur 100m) puisque ce 2e point, lui, recevait sa vraie altitude via
// routeThroughPoints/getElevations cote serveur. anchor:true marque ce point
// comme deplacable par glisser-deposer sur la carte (renderRouteEditorAnchorMarkers).
async function routeEditorPlaceStartPoint(lat, lon) {
  _routeEditorHistory.push({ points: [], stats: null, pois: [] });
  _routeEditorFuture = [];
  let ele = 0;
  try {
    const res = await fetch(`${API}/api/route-editor/elevation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    });
    const data = await res.json();
    if (res.ok && typeof data.ele === 'number') ele = data.ele;
  } catch (err) { /* repli silencieux sur 0 - pas bloquant pour poser le depart */ }
  _routeEditorData = { ..._routeEditorData, points: [{ lat, lon, ele, anchor: true }], pois: [] };
  // Seule exception à la préservation du zoom (cf _routeEditorMapView) : le
  // tout premier point posé doit encore zoomer automatiquement dessus, la
  // vue par défaut avant ça (France entière) n'étant d'aucune utilité une
  // fois un point posé - la préservation ne doit s'appliquer qu'à partir du
  // point suivant, une fois que l'utilisateur a une vue déjà pertinente.
  _routeEditorSkipMapViewCapture = true;
  renderRouteEditorWorkspace();
}

async function routeEditorExtendTrack(fromPoint, toPoint) {
  const hint = el('route-editor-mode-hint');
  try {
    const tileOk = await routeEditorEnsureTileAvailable(fromPoint);
    if (!tileOk) return;
    if (hint) hint.textContent = '⏳ Calcul du tronçon…';
    const { terrain, trailStyle } = routeEditorCurrentProfile();
    const res = await fetch(`${API}/api/route-editor/reroute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: [{ lat: fromPoint.lat, lon: fromPoint.lon }, toPoint], terrain, trailStyle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Calcul impossible');

    const prevPoints = _routeEditorData.points;
    const prevStats = _routeEditorData.stats;
    const prevPois = _routeEditorData.pois || [];
    const newPoints = [...prevPoints, ...data.segmentPoints.slice(1)]; // slice(1) : le 1er point du tronçon double le dernier point déjà présent
    // Le dernier point du tronçon est celui que l'utilisateur vient de
    // cliquer (la cible du routage) - marqué déplaçable par glisser-déposer
    // (cf renderRouteEditorAnchorMarkers), contrairement aux points
    // intermédiaires calculés par BRouter entre deux clics.
    if (newPoints.length) newPoints[newPoints.length - 1] = { ...newPoints[newPoints.length - 1], anchor: true };
    const newStats = newPoints.length >= 2 ? await routeEditorAnalyzePoints(newPoints) : null;

    _routeEditorHistory.push({ points: prevPoints, stats: prevStats, pois: prevPois });
    _routeEditorFuture = [];
    _routeEditorData = { ..._routeEditorData, points: newPoints, stats: newStats, pois: [] };
    // Figé une seule fois (la 1ère fois que le tracé devient analysable) -
    // pas réécrit à chaque point ajouté ensuite, pour que "Restaurer le GPX
    // original" garde son sens habituel (revenir au début, pas au dernier
    // point posé).
    if (!_routeEditorOriginal && newStats) _routeEditorOriginal = { points: newPoints, stats: newStats, pois: [] };
    renderRouteEditorWorkspace();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    renderRouteEditorModeHint();
  }
}

// 1er clic (mode "move-point") = point le plus proche à déplacer (jamais le
// premier/dernier point du tracé, qui n'a pas de voisin des deux côtés) ;
// 2e clic = position CIBLE brute (pas de snapping - contrairement à la
// sélection A/B, ici l'utilisateur choisit un emplacement libre sur la
// carte) → recalcule la liaison entre deux ancres élargies de part et
// d'autre du point déplacé (routeEditorWidenBackward/Forward), pas juste
// entre ses deux voisins immédiats du tableau `points` - sinon, sur un GPX
// importé où deux points consécutifs ne sont espacés que de quelques mètres,
// BRouter n'a quasiment aucune marge pour rejoindre le nouvel emplacement
// autrement qu'en aller-retour (retour utilisateur, capture d'écran).
function onRouteEditorMovePointClick(latlng, points) {
  if (_routeEditorMovePickIdx == null) {
    const idx = findNearestRouteEditorPointIndex(latlng, points);
    if (idx <= 0 || idx >= points.length - 1) {
      showToast('Le premier et le dernier point du tracé ne peuvent pas être déplacés.', 'error');
      return;
    }
    _routeEditorMovePickIdx = idx;
    renderRouteEditorModeHint();
    if (_routeEditorLatLngs) {
      if (_routeEditorSelectionLayer) _routeEditorMap.removeLayer(_routeEditorSelectionLayer);
      _routeEditorSelectionLayer = L.circleMarker(_routeEditorLatLngs[idx], { radius: 8, color: '#fff', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }).addTo(_routeEditorMap);
    }
    return;
  }
  const idx = _routeEditorMovePickIdx;
  _routeEditorMovePickIdx = null;
  const startIdx = routeEditorWidenBackward(points, idx - 1);
  const endIdx = routeEditorWidenForward(points, idx + 1);
  const before = points[startIdx], after = points[endIdx];
  routeEditorPreviewReroute({
    startIdx,
    endIdx,
    waypoints: [{ lat: before.lat, lon: before.lon }, { lat: latlng.lat, lon: latlng.lng }, { lat: after.lat, lon: after.lon }],
    // Diagnostic temporaire (aout 2026) : avant/après se retrouvaient bien
    // plus loin que prévu (jusqu'à ~970m au lieu des ~120m visés) sans
    // qu'on sache si c'est le plafonnage du pas qui échoue ou l'arrêt en
    // butée de tableau (idx proche de 0/length-1) - transmis au serveur
    // pour finir tracé dans le même fichier que routeThroughViaPoint (cf
    // VIA_POINT_DEBUG_FILE, route_generator.js) plutôt que de multiplier
    // les allers-retours de test.
    debugMeta: { idx, startIdx, endIdx, totalPoints: points.length },
  });
}

// Nécessite une sélection A→B déjà posée (mode "select") : le clic ajoute
// un point de passage OBLIGATOIRE entre A et B (PDF §7.2/§7.3 - "ajouter un
// point de passage" et "forcer un passage" sont la même opération, un point
// intermédiaire imposé au recalcul).
function onRouteEditorAddWaypointClick(latlng) {
  const sel = _routeEditorSelection;
  if (sel.aIdx == null || sel.bIdx == null) {
    showToast('Sélectionnez d\'abord une section A→B (mode "Sélectionner A→B").', 'error');
    return;
  }
  const points = _routeEditorData.points;
  const a = points[sel.aIdx], b = points[sel.bIdx];
  routeEditorPreviewReroute({
    startIdx: sel.aIdx,
    endIdx: sel.bIdx,
    waypoints: [{ lat: a.lat, lon: a.lon }, { lat: latlng.lat, lon: latlng.lng }, { lat: b.lat, lon: b.lon }],
  });
}

// Vérifie que la tuile OSM couvrant ce point est présente localement, sinon
// propose le téléchargement (taille réelle affichée) avant de poursuivre -
// adapté de routesEnsureTileAvailable (routes.js:462-488), même séquence
// d'appels (/api/routes/tile-check puis /api/routes/tile-download, déjà
// génériques et réutilisées telles quelles). Un GPX importé dans l'Éditeur
// Parcours peut venir de n'importe où, pas forcément une région déjà
// couverte pour le générateur d'itinéraires.
async function routeEditorEnsureTileAvailable(point) {
  const res = await fetch(`${API}/api/routes/tile-check?lat=${point.lat}&lon=${point.lon}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Vérification des données cartographiques impossible');
  if (data.present) return true;

  const sizeLabel = data.sizeBytes ? `${Math.round(data.sizeBytes / 1024 / 1024)} Mo` : 'taille inconnue';
  const ok = await showConfirmModal({
    title: 'Données cartographiques manquantes',
    message: `Cette zone (tuile ${data.tileName}) n'est pas encore téléchargée sur cette machine (~${sizeLabel}). Télécharger maintenant ? Cela peut prendre plusieurs minutes.`,
    confirmLabel: 'Télécharger', cancelLabel: 'Annuler', icon: '🗺️',
  });
  if (!ok) return false;

  const dlRes = await fetch(`${API}/api/routes/tile-download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: point.lat, lon: point.lon }),
  });
  const dlData = await dlRes.json();
  if (!dlRes.ok) throw new Error(dlData.error || 'Téléchargement des données cartographiques échoué');
  showToast('Données cartographiques téléchargées', 'success');
  return true;
}

function clearRouteEditorReroutePreview() {
  const box = el('route-editor-reroute-preview');
  if (box) box.innerHTML = '';
  if (_routeEditorPreviewLayer && _routeEditorMap) { _routeEditorMap.removeLayer(_routeEditorPreviewLayer); _routeEditorPreviewLayer = null; }
}

// Prévisualise un recalcul (déplacer un point / ajouter un point de passage
// / recalculer une section) AVANT de l'appliquer (PDF §25.1 : toute
// proposition de recalcul doit être prévisualisée). {startIdx, endIdx}
// bornent la portion remplacée dans le tracé courant ; {waypoints}
// optionnel (défaut [points[startIdx], points[endIdx]] côté serveur).
async function routeEditorPreviewReroute({ startIdx, endIdx, waypoints, terrain, trailStyle, debugMeta }) {
  const box = el('route-editor-reroute-preview');
  if (!box || !_routeEditorData) return;
  if (!terrain) ({ terrain, trailStyle } = routeEditorCurrentProfile());
  box.innerHTML = `<div class="route-editor-section-card">⏳ Vérification des données cartographiques…</div>`;
  const firstWaypoint = waypoints ? waypoints[0] : _routeEditorData.points[startIdx];
  try {
    const tileOk = await routeEditorEnsureTileAvailable(firstWaypoint);
    if (!tileOk) { box.innerHTML = ''; return; }

    box.innerHTML = `<div class="route-editor-section-card">⏳ Calcul du nouvel itinéraire…</div>`;
    const points = _routeEditorData.points;
    const rerouteRes = await fetch(`${API}/api/route-editor/reroute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, startIdx, endIdx, waypoints, terrain, trailStyle, debugMeta }),
    });
    const rerouteData = await rerouteRes.json();
    if (!rerouteRes.ok) throw new Error(rerouteData.error || 'Recalcul impossible');

    const beforeStats = _routeEditorData.stats; // déjà connu, pas besoin de le recalculer
    const afterStats = await routeEditorAnalyzePoints(rerouteData.points);

    const oldSegment = points.slice(startIdx, endIdx + 1).map(p => [p.lat, p.lon]);
    const newSegment = rerouteData.segmentPoints.map(p => [p.lat, p.lon]);
    if (_routeEditorMap) {
      if (_routeEditorPreviewLayer) _routeEditorMap.removeLayer(_routeEditorPreviewLayer);
      const group = L.layerGroup();
      L.polyline(oldSegment, { color: '#94a3b8', weight: 4, dashArray: '4,8' }).addTo(group);
      L.polyline(newSegment, { color: '#f59e0b', weight: 5 }).addTo(group);
      group.addTo(_routeEditorMap);
      _routeEditorPreviewLayer = group;
      _routeEditorMap.fitBounds(L.latLngBounds([...oldSegment, ...newSegment]), { padding: [24, 24] });
    }

    // Impact sur le parcours complet (avant/après), même esprit que la
    // prévisualisation d'exemple du PDF §25.1 ("Impact parcours complet :
    // -2,4 km, -190 m D+...") plutôt que la distance de la seule section
    // (moins parlante isolément).
    const deltaDist = afterStats.totalDistM - beforeStats.totalDistM;
    const deltaAscent = afterStats.ascentM - beforeStats.ascentM;
    const fmtDelta = (v, unit) => `${v >= 0 ? '+' : ''}${v}${unit}`;
    box.innerHTML = `
      <div class="route-editor-section-card">
        <div class="route-editor-section-stats">
          <span>Nouveau parcours complet : <b>${(afterStats.totalDistM / 1000).toFixed(1)} km</b> (${fmtDelta((deltaDist / 1000).toFixed(2), ' km')})</span>
          <span><b>+${afterStats.ascentM} m D+</b> (${fmtDelta(deltaAscent, ' m')})</span>
        </div>
        <div class="route-editor-section-form">
          <button type="button" class="btn-plans-restart" id="route-editor-apply-reroute-btn">Appliquer</button>
          <button type="button" class="route-editor-btn-secondary" id="route-editor-cancel-reroute-btn">Annuler</button>
        </div>
      </div>`;
    const applyBtn = el('route-editor-apply-reroute-btn');
    if (applyBtn) applyBtn.onclick = () => applyRouteEditorReroute(rerouteData.points, afterStats);
    const cancelBtn = el('route-editor-cancel-reroute-btn');
    if (cancelBtn) cancelBtn.onclick = clearRouteEditorReroutePreview;
  } catch (err) {
    box.innerHTML = `<div class="route-editor-section-card">Erreur : ${err.message}</div>`;
  }
}

async function applyRouteEditorReroute(newPoints, newStats) {
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
  _routeEditorFuture = [];
  _routeEditorData = { ..._routeEditorData, points: newPoints, stats: newStats, pois: [] };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
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

// Points d'intérêt (PDF §14) : ravitaillement/eau/sommet/point de vue/
// parking/refuge/passage technique/point personnel. Liés à un index du
// tracé COURANT - toute opération qui change la structure du tableau de
// points (répétition, recalcul, extension) les réinitialise (cf les points
// d'ajout _routeEditorData = {..., pois: []} dans ce fichier), Annuler/
// Rétablir les restaurent en revanche puisqu'ils reviennent à un état déjà
// connu (pois voyage avec points/stats dans l'historique).
const ROUTE_EDITOR_POI_TYPES = [
  { key: 'ravito', icon: '🍫', label: 'Ravitaillement' },
  { key: 'eau', icon: '💧', label: 'Eau' },
  { key: 'sommet', icon: '🏔️', label: 'Sommet' },
  { key: 'vue', icon: '👁️', label: 'Point de vue' },
  { key: 'parking', icon: '🅿️', label: 'Parking' },
  { key: 'refuge', icon: '🏠', label: 'Refuge' },
  { key: 'technique', icon: '⚠️', label: 'Passage technique' },
  { key: 'perso', icon: '📌', label: 'Point personnel' },
];
function routeEditorPoiTypeInfo(key) {
  return ROUTE_EDITOR_POI_TYPES.find(t => t.key === key) || ROUTE_EDITOR_POI_TYPES[ROUTE_EDITOR_POI_TYPES.length - 1];
}

function onRouteEditorPoiClick(idx) {
  const modal = document.createElement('div');
  modal.className = 'confirm-modal-backdrop';
  modal.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal-title">📌 Ajouter un point d'intérêt</div>
      <div class="route-editor-section-form" style="margin:14px 0">
        <select id="route-editor-poi-type" class="routes-select">
          ${ROUTE_EDITOR_POI_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
        </select>
        <input type="text" id="route-editor-poi-label" class="routes-text-input" placeholder="Nom (optionnel)" />
      </div>
      <div class="route-editor-section-form">
        <button type="button" class="btn-plans-restart" id="route-editor-poi-confirm">Ajouter</button>
        <button type="button" class="route-editor-btn-secondary" id="route-editor-poi-cancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  attachBackdropClose(modal, close);
  el('route-editor-poi-cancel').onclick = close;
  el('route-editor-poi-confirm').onclick = () => {
    const type = el('route-editor-poi-type').value;
    const label = el('route-editor-poi-label').value.trim();
    _routeEditorData.pois = [...(_routeEditorData.pois || []), { idx, type, label }];
    close();
    renderRouteEditorPoiOverlay();
    renderRouteEditorPoiTable();
  };
}

function routeEditorRemovePoi(poiIdx) {
  _routeEditorData.pois = (_routeEditorData.pois || []).filter((_, i) => i !== poiIdx);
  renderRouteEditorPoiOverlay();
  renderRouteEditorPoiTable();
}

// Marqueurs POI sur la carte - calque dédié (comme la sélection A/B et
// l'aperçu de recalcul), mis à jour sans reconstruire toute la carte.
let _routeEditorPoiLayer = null;
function renderRouteEditorPoiOverlay() {
  if (_routeEditorPoiLayer && _routeEditorMap) { _routeEditorMap.removeLayer(_routeEditorPoiLayer); _routeEditorPoiLayer = null; }
  const pois = _routeEditorData?.pois || [];
  if (!_routeEditorMap || !_routeEditorLatLngs || !pois.length) return;
  const group = L.layerGroup();
  pois.forEach(poi => {
    const latlng = _routeEditorLatLngs[poi.idx];
    if (!latlng) return;
    const info = routeEditorPoiTypeInfo(poi.type);
    L.marker(latlng, { icon: L.divIcon({ html: `<span class="route-editor-poi-marker">${info.icon}</span>`, className: '', iconSize: [26, 26], iconAnchor: [13, 13] }) })
      .bindTooltip(poi.label || info.label)
      .addTo(group);
  });
  group.addTo(_routeEditorMap);
  _routeEditorPoiLayer = group;
}

function renderRouteEditorPoiTable() {
  const box = el('route-editor-poi-table-wrap');
  if (!box) return;
  const pois = _routeEditorData?.pois || [];
  if (!pois.length) { box.innerHTML = ''; return; }
  const points = _routeEditorData.points;
  // Distance cumulée au point idx - calcul direct (pas besoin des bins de
  // computeGpxDisplayBins, juste la position kilométrique de chaque POI).
  const cumKm = [0];
  for (let i = 1; i < points.length; i++) cumKm.push(cumKm[i - 1] + haversineKm(points[i - 1], points[i]));
  const rows = pois.map((poi, i) => {
    const info = routeEditorPoiTypeInfo(poi.type);
    return `<tr>
      <td>${info.icon} ${poi.label || info.label}</td>
      <td>${info.label}</td>
      <td>KM ${(cumKm[poi.idx] || 0).toFixed(1)}</td>
      <td><button type="button" class="route-editor-imported-remove" data-poi-idx="${i}">✕</button></td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div class="route-editor-section-title">Points d'intérêt</div>
    <table class="route-editor-climbs-table">
      <thead><tr><th>Point</th><th>Type</th><th>Position</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  box.querySelectorAll('[data-poi-idx]').forEach(btn => {
    btn.onclick = () => routeEditorRemovePoi(parseInt(btn.dataset.poiIdx, 10));
  });
}

// Variantes et historique de versions (PDF §10) : collection NOMMÉE,
// distincte de la pile Annuler/Rétablir linéaire (_routeEditorHistory) déjà
// en place - l'utilisateur choisit explicitement quels états mériter d'être
// gardés et comparés (nom, distance, D+), plutôt que de dérouler les
// modifications une par une.
let _routeEditorVariantSeq = 0;

function onRouteEditorSaveVariantClick() {
  if (!_routeEditorData?.stats) return;
  const defaultName = `Variante ${_routeEditorVariants.length + 1}`;
  const modal = document.createElement('div');
  modal.className = 'confirm-modal-backdrop';
  modal.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal-title">💾 Enregistrer cette version</div>
      <div class="route-editor-section-form" style="margin:14px 0">
        <input type="text" id="route-editor-variant-name" class="routes-text-input" value="${defaultName}" style="width:100%" />
      </div>
      <div class="route-editor-section-form">
        <button type="button" class="btn-plans-restart" id="route-editor-variant-confirm">Enregistrer</button>
        <button type="button" class="route-editor-btn-secondary" id="route-editor-variant-cancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  attachBackdropClose(modal, close);
  el('route-editor-variant-cancel').onclick = close;
  const nameInput = el('route-editor-variant-name');
  nameInput.focus();
  nameInput.select();
  el('route-editor-variant-confirm').onclick = () => {
    const name = nameInput.value.trim() || defaultName;
    _routeEditorVariants = [..._routeEditorVariants, {
      id: ++_routeEditorVariantSeq,
      name,
      points: _routeEditorData.points,
      stats: _routeEditorData.stats,
      pois: _routeEditorData.pois || [],
    }];
    close();
    renderRouteEditorVariantsTable();
  };
}

function routeEditorLoadVariant(id) {
  const variant = id === 'original'
    ? { points: _routeEditorOriginal.points, stats: _routeEditorOriginal.stats, pois: _routeEditorOriginal.pois || [] }
    : _routeEditorVariants.find(v => v.id === id);
  if (!variant || variant.points === _routeEditorData.points) return;
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
  _routeEditorFuture = [];
  _routeEditorData = { ..._routeEditorData, points: variant.points, stats: variant.stats, pois: variant.pois };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
}

function routeEditorDeleteVariant(id) {
  _routeEditorVariants = _routeEditorVariants.filter(v => v.id !== id);
  renderRouteEditorVariantsTable();
}

function renderRouteEditorVariantsTable() {
  const box = el('route-editor-variants-table-wrap');
  if (!box || !_routeEditorOriginal) return;
  const rowHtml = (id, name, stats, current, deletable) => `
    <tr>
      <td>${name}</td>
      <td>${(stats.totalDistM / 1000).toFixed(1)} km</td>
      <td>+${stats.ascentM} m</td>
      <td>
        <button type="button" class="route-editor-climb-repeat-btn" data-load-variant="${id}" ${current ? 'disabled' : ''}>${current ? 'Version actuelle' : 'Charger'}</button>
        ${deletable ? `<button type="button" class="route-editor-imported-remove" data-delete-variant="${id}">✕</button>` : ''}
      </td>
    </tr>`;
  const rows = [
    rowHtml('original', 'Original', _routeEditorOriginal.stats, _routeEditorData.points === _routeEditorOriginal.points, false),
    ..._routeEditorVariants.map(v => rowHtml(v.id, v.name, v.stats, v.points === _routeEditorData.points, true)),
  ].join('');
  box.innerHTML = `
    <table class="route-editor-climbs-table">
      <thead><tr><th>Variante</th><th>Distance</th><th>D+</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  box.querySelectorAll('[data-load-variant]').forEach(btn => {
    btn.onclick = () => routeEditorLoadVariant(btn.dataset.loadVariant === 'original' ? 'original' : parseInt(btn.dataset.loadVariant, 10));
  });
  box.querySelectorAll('[data-delete-variant]').forEach(btn => {
    btn.onclick = () => routeEditorDeleteVariant(parseInt(btn.dataset.deleteVariant, 10));
  });
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
        <div class="route-editor-section-form" style="margin-top:8px">
          <button type="button" class="route-editor-btn-secondary" id="route-editor-reroute-btn">🔀 Recalculer cette section (via le profil sélectionné plus haut)</button>
        </div>
      </div>`;
    const applyBtn = el('route-editor-apply-repeat-btn');
    if (applyBtn) applyBtn.onclick = applyRouteEditorRepeat;
    const clearBtn = el('route-editor-clear-selection-btn');
    if (clearBtn) clearBtn.onclick = clearRouteEditorSelection;
    const rerouteBtn = el('route-editor-reroute-btn');
    if (rerouteBtn) rerouteBtn.onclick = () => {
      const { terrain, trailStyle } = routeEditorCurrentProfile();
      routeEditorPreviewReroute({ startIdx: sel.aIdx, endIdx: sel.bIdx, terrain, trailStyle });
    };
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

// Répartit l'objectif D+/distance sur PLUSIEURS côtes différentes plutôt
// que de tout concentrer sur une seule (retour utilisateur explicite :
// "il ne saurait pas dire 4 fois celle-ci et 3 fois celle-là ?") - allocation
// gloutonne locale (aucun appel réseau), un passage à la fois : à chaque
// étape, choisit la côte offrant le meilleur rapport D+/distance actualisé,
// PONDÉRÉ par le nombre de fois déjà utilisée dans ce plan (REUSE_DISCOUNT
// ci-dessous) - sans cette pénalité, l'algorithme reprendrait toujours la
// même côte (la plus "rentable") indéfiniment, exactement le problème
// signalé. La pénalité diminue progressivement l'attrait d'une côte déjà
// choisie plutôt que de fixer un plafond arbitraire par côte : une côte
// nettement meilleure que les autres peut donc légitimement être reprise
// plusieurs fois, mais pas indéfiniment.
const OBJECTIVE_PLAN_MAX_TOTAL_PASSES = 15; // garde-fou (temps de calcul + taille du tracé), au-dela d'une seule cote (10)

function planRouteEditorObjectiveRepeats(climbs, obj, currentStats) {
  if (!climbs.length) return { plan: [], reached: false };
  let remainingDplus = obj.targetDplusM != null ? obj.targetDplusM - currentStats.ascentM : null;
  let remainingDist = obj.targetDistM != null ? obj.targetDistM * 1000 - currentStats.totalDistM : null;
  if ((remainingDplus == null || remainingDplus <= 0) && (remainingDist == null || remainingDist <= 0)) {
    return { plan: [], reached: true }; // objectif déjà atteint par le parcours actuel
  }

  const usage = new Map(); // climb -> nombre de passages EXTRA déjà alloués dans ce plan
  let totalExtraPasses = 0;
  while (
    totalExtraPasses < OBJECTIVE_PLAN_MAX_TOTAL_PASSES
    && ((remainingDplus != null && remainingDplus > 0) || (remainingDist != null && remainingDist > 0))
  ) {
    let bestClimb = null, bestScore = -Infinity;
    for (const c of climbs) {
      if (obj.targetDplusM != null && c.gainM <= 0) continue; // n'aide pas l'objectif D+
      if (obj.targetDplusM == null && obj.targetDistM != null && c.distM <= 0) continue;
      const used = usage.get(c) || 0;
      const efficiency = c.gainM / (2 * c.distM || 1);
      const score = efficiency / (1 + used); // pénalité de réutilisation
      if (score > bestScore) { bestScore = score; bestClimb = c; }
    }
    if (!bestClimb) break; // aucune côte exploitable pour cet objectif
    usage.set(bestClimb, (usage.get(bestClimb) || 0) + 1);
    totalExtraPasses++;
    if (remainingDplus != null) remainingDplus -= bestClimb.gainM;
    if (remainingDist != null) remainingDist -= 2 * bestClimb.distM;
  }

  const reached = (remainingDplus == null || remainingDplus <= 0) && (remainingDist == null || remainingDist <= 0);
  // +1 : le passage d'origine, déjà présent dans le tracé, compte comme la 1ère "montée".
  const plan = [...usage.entries()].map(([climb, extraPasses]) => ({ climb, passes: extraPasses + 1 }));
  plan.sort((a, b) => a.climb.startIdx - b.climb.startIdx);
  return { plan, reached, capped: totalExtraPasses >= OBJECTIVE_PLAN_MAX_TOTAL_PASSES };
}

// Suggestion automatique (pas de clic requis) : dès qu'un objectif D+/
// distance est fixé et qu'aucune section n'est sélectionnée manuellement,
// propose directement un plan combiné (une ou plusieurs côtes) à répéter -
// le clic manuel (carte/profil/"🔁 Répéter") reste possible et prend le
// dessus tant qu'une sélection est active (cf renderRouteEditorSectionPanel).
function renderRouteEditorObjectiveAutoSuggestion() {
  const box = el('route-editor-objective-auto');
  if (!box) return;
  const obj = _routeEditorObjective;
  if (_routeEditorSelection.aIdx != null || (obj.targetDplusM == null && obj.targetDistM == null)) {
    box.innerHTML = '';
    return;
  }
  const climbs = _routeEditorData?.stats?.climbs || [];
  const { plan, reached, capped } = planRouteEditorObjectiveRepeats(climbs, obj, _routeEditorData.stats);
  if (!plan.length) {
    box.innerHTML = reached
      ? `<div class="route-editor-section-card route-editor-objective-suggestion">✅ L'objectif est déjà atteint par le parcours actuel.</div>`
      : `<div class="route-editor-section-card route-editor-objective-suggestion">Aucune côte détectée sur ce parcours pour proposer une répétition automatique — sélectionnez une section vous-même (carte ou profil).</div>`;
    return;
  }
  const objSnapshot = { ...obj };
  box.innerHTML = `<div class="route-editor-section-card route-editor-objective-suggestion">⏳ Calcul du plan combiné…</div>`;
  const newPoints = buildMultiRepeatedPoints(_routeEditorData.points, plan.map(p => ({ startIdx: p.climb.startIdx, endIdx: p.climb.endIdx, passes: p.passes })));
  routeEditorAnalyzePoints(newPoints).then(finalStats => {
    // L'objectif ou la sélection ont pu changer pendant l'attente réseau.
    if (_routeEditorObjective.targetDplusM !== objSnapshot.targetDplusM || _routeEditorObjective.targetDistM !== objSnapshot.targetDistM) return;
    if (_routeEditorSelection.aIdx != null) return;
    const planRows = plan.map(p => `<li>Côte KM ${p.climb.startKm.toFixed(1)} → ${p.climb.endKm.toFixed(1)} (+${p.climb.gainM} m D+/passage) : <b>${p.passes} montées</b> (+${p.passes - 1} passage${p.passes - 1 > 1 ? 's' : ''} supplémentaire${p.passes - 1 > 1 ? 's' : ''})</li>`).join('');
    const capNote = capped && !reached
      ? `<div class="route-editor-objective-capnote">Objectif non atteint même au plafond de ${OBJECTIVE_PLAN_MAX_TOTAL_PASSES} passages combinés — essayez d'importer un parcours plus vallonné.</div>`
      : '';
    box.innerHTML = `
      <div class="route-editor-section-card route-editor-objective-suggestion">
        <div>🏆 Plan combiné ${reached ? "pour atteindre l'objectif" : "pour s'en rapprocher"} :</div>
        <ul class="route-editor-objective-plan-list">${planRows}</ul>
        <div>Nouveau parcours estimé : <b>${(finalStats.totalDistM / 1000).toFixed(1)} km</b> / <b>+${finalStats.ascentM} m D+</b>.</div>
        ${capNote}
        <button type="button" class="btn-plans-restart" id="route-editor-apply-auto-btn">Appliquer ce plan</button>
      </div>`;
    const btn = document.getElementById('route-editor-apply-auto-btn');
    if (btn) btn.onclick = () => applyRouteEditorObjectivePlan(plan, newPoints, finalStats);
  }).catch(err => {
    box.innerHTML = `<div class="route-editor-section-card route-editor-objective-suggestion">Erreur : ${err.message}</div>`;
  });
}

async function applyRouteEditorObjectivePlan(plan, newPoints, finalStats) {
  const btn = document.getElementById('route-editor-apply-auto-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Application…'; }
  try {
    _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
    _routeEditorFuture = [];
    _routeEditorData = { ..._routeEditorData, points: newPoints, stats: finalStats, pois: [] };
    _routeEditorSelection = { aIdx: null, bIdx: null };
    // Plan issu de l'objectif : vient d'être appliqué, on l'efface pour ne
    // pas re-suggérer immédiatement une nouvelle répétition (cf même logique
    // dans applyRouteEditorRepeat pour la répétition manuelle sur objectif).
    _routeEditorObjective = { targetDplusM: null, targetDistM: null };
    renderRouteEditorWorkspace();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Appliquer ce plan'; }
  }
}

// Répète UNE section A..B, N fois - cas particulier de
// buildMultiRepeatedPoints (une seule entrée de plan), conservé tel quel
// pour la répétition manuelle (sélection A/B à la main).
function buildRepeatedPoints(points, aIdx, bIdx, totalPasses) {
  return buildMultiRepeatedPoints(points, [{ startIdx: aIdx, endIdx: bIdx, passes: totalPasses }]);
}

// Applique un plan de répétitions sur PLUSIEURS sections non chevauchantes
// en un seul passage sur le tracé d'origine (pas de recalcul d'index après
// chaque insertion) - utilisé pour la suggestion automatique combinée
// (plusieurs côtes différentes, cf planRouteEditorObjectiveRepeats) autant
// que pour la répétition manuelle d'une seule section (buildRepeatedPoints
// ci-dessus). Pour chaque section : même principe que le PDF (4 montées =
// A→B→A→B→A→B→A→B), sans point dupliqué aux jonctions - le retour B→A
// réutilise exactement les coordonnées existantes (aucun appel de routage).
function buildMultiRepeatedPoints(points, plan) {
  const sorted = [...plan].sort((a, b) => a.startIdx - b.startIdx);
  const out = [];
  let cursor = 0;
  sorted.forEach(({ startIdx, endIdx, passes }) => {
    out.push(...points.slice(cursor, startIdx)); // portion inchangée avant cette section
    const forward = points.slice(startIdx, endIdx + 1); // A..B inclusif
    const backward = forward.slice().reverse();          // B..A inclusif
    for (let pass = 0; pass < passes; pass++) {
      out.push(...(pass === 0 ? forward : forward.slice(1)));
      if (pass < passes - 1) out.push(...backward.slice(1));
    }
    cursor = endIdx + 1;
  });
  out.push(...points.slice(cursor)); // fin du parcours après la dernière section
  return out;
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
    _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
    _routeEditorFuture = [];
    _routeEditorData = { ..._routeEditorData, points: newPoints, stats, pois: [] };
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
  _routeEditorFuture.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
  const prev = _routeEditorHistory.pop();
  _routeEditorData = { ..._routeEditorData, points: prev.points, stats: prev.stats, pois: prev.pois || [] };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
}

function routeEditorRedo() {
  if (!_routeEditorFuture.length) return;
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
  const next = _routeEditorFuture.pop();
  _routeEditorData = { ..._routeEditorData, points: next.points, stats: next.stats, pois: next.pois || [] };
  _routeEditorSelection = { aIdx: null, bIdx: null };
  renderRouteEditorWorkspace();
}

function routeEditorRestoreOriginal() {
  if (!_routeEditorOriginal || _routeEditorData.points === _routeEditorOriginal.points) return;
  _routeEditorHistory.push({ points: _routeEditorData.points, stats: _routeEditorData.stats, pois: _routeEditorData.pois || [] });
  _routeEditorFuture = [];
  _routeEditorData = { ..._routeEditorData, points: _routeEditorOriginal.points, stats: _routeEditorOriginal.stats, pois: _routeEditorOriginal.pois || [] };
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

let _routeEditorLastStrategy = null; // dernier résultat de /api/route-editor/strategy, réutilisé par le résumé intelligent
let _routeEditorLastStrategyPoints = null; // référence du tableau de points pour lequel _routeEditorLastStrategy a été calculé - détecte la péremption sans avoir à réinitialiser explicitement à chaque édition (on ne remplace jamais un tableau de points en place, toujours par un nouveau)
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
    const pois = (_routeEditorData.pois || []).map(p => ({ idx: p.idx, label: p.label || routeEditorPoiTypeInfo(p.type).label }));
    const res = await fetch(`${API}/api/route-editor/strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: _routeEditorData.points, targetTimeMin: targetMin, pois }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Calcul impossible');
    _routeEditorLastStrategy = data; // réutilisé par le résumé intelligent (phrase "marche active")
    _routeEditorLastStrategyPoints = _routeEditorData.points;
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
    </div>
    ${data.poiTimes && data.poiTimes.length ? `
      <div class="route-editor-section-title">Temps de passage aux points d'intérêt</div>
      <ul class="route-editor-poi-times">
        ${data.poiTimes.map(pt => `<li>${pt.label} : <b>${pt.cumulativeTimeMin != null ? formatDuration(pt.cumulativeTimeMin * 60) : '—'}</b></li>`).join('')}
      </ul>` : ''}`;
}
