// globe.js — Globe 3D des activites (page Activites)
// Affiche les zones ou l'utilisateur a couru/roule/marche sous forme de
// cercles avec halo (taille/couleur = frequence), plutot que des points
// bruts qui se chevaucheraient massivement autour du "point d'attache"
// (memes lieux revisites des dizaines de fois) — les cercles proches se
// chevauchent aussi (assume, demande explicite) mais restent lisibles
// grace au halo semi-transparent. Les points affiches suivent exactement
// le meme jeu filtre que le tableau Activites (_lastFilteredActivities,
// alimente par renderAllActivities, app.js) — aucune logique de filtre
// dupliquee ici.

let _globeInstance = null;
let _globeModalEl = null;
let _globeInitialViewSet = false;
let _globeRefreshTimer = null;

function _globeGeoPoints() {
  return (_lastFilteredActivities || [])
    .filter(a => typeof a.startLat === 'number' && typeof a.startLon === 'number')
    .map(a => ({ lat: a.startLat, lng: a.startLon }));
}

// Regroupe les points proches (grille ~0.08deg, ~8-9km) en clusters avec un
// compteur - sans ca, des dizaines de sorties depuis le meme point de depart
// produiraient autant de cercles empiles au pixel pres, illisible.
function _clusterGeoPoints(points, cell = 0.08) {
  const buckets = new Map();
  points.forEach(p => {
    const key = Math.round(p.lat / cell) + '_' + Math.round(p.lng / cell);
    let b = buckets.get(key);
    if (!b) { b = { latSum: 0, lngSum: 0, count: 0 }; buckets.set(key, b); }
    b.latSum += p.lat; b.lngSum += p.lng; b.count++;
  });
  return [...buckets.values()].map(b => ({
    lat: b.latSum / b.count,
    lng: b.lngSum / b.count,
    count: b.count,
  }));
}

// Degrade bleu (rare) -> ambre -> rouge (frequent). norm in [0,1].
function _globeSpotColor(norm) {
  const stops = [[59, 130, 246], [250, 204, 21], [248, 113, 113]];
  const scaled = norm * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const t = scaled - i;
  const c = stops[i].map((v, idx) => Math.round(v + (stops[i + 1][idx] - v) * t));
  return `${c[0]},${c[1]},${c[2]}`;
}

function _buildSpotElement(cluster, maxCount) {
  const norm = maxCount > 1 ? Math.log(cluster.count + 1) / Math.log(maxCount + 1) : 1;
  const size = Math.round(10 + 42 * norm);
  const rgb = _globeSpotColor(norm);
  const el = document.createElement('div');
  el.className = 'globe-spot';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.background = `radial-gradient(circle, rgba(${rgb},0.95) 0%, rgba(${rgb},0.55) 45%, rgba(${rgb},0) 75%)`;
  el.style.boxShadow = `0 0 ${Math.round(size * 0.7)}px rgba(${rgb},0.55)`;
  el.title = `${cluster.count} activité${cluster.count > 1 ? 's' : ''}`;
  el.onclick = (e) => {
    e.stopPropagation();
    if (_globeInstance) _globeInstance.pointOfView({ lat: cluster.lat, lng: cluster.lng, altitude: 0.35 }, 900);
  };
  return el;
}

function _ensureGlobeModal() {
  if (_globeModalEl) return _globeModalEl;
  const bd = document.createElement('div');
  bd.className = 'globe-modal-backdrop';
  bd.id = 'globe-modal-backdrop';
  bd.innerHTML = `
    <div class="globe-modal" onclick="event.stopPropagation()">
      <div class="globe-modal-header">
        <div>
          <div class="globe-modal-title">&#127760; Mes zones de course</div>
          <div class="globe-modal-subtitle" id="globe-modal-count"></div>
        </div>
        <button type="button" class="globe-modal-close" id="globe-modal-close-btn">&times;</button>
      </div>
      <div class="globe-modal-body">
        <div id="globe-container" class="globe-container"></div>
        <div class="globe-loading" id="globe-loading">
          <div class="route-loading-spinner"></div>
          <div>Chargement du globe...</div>
        </div>
        <div class="globe-empty-state" id="globe-empty-state" style="display:none">
          Aucune activité géolocalisée pour ce filtre
        </div>
        <div class="globe-legend">
          <span>Peu</span>
          <span class="globe-legend-gradient"></span>
          <span>Souvent</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => closeActivityGlobe();
  bd.querySelector('#globe-modal-close-btn').onclick = close;
  attachBackdropClose(bd, close);
  _globeModalEl = bd;
  return bd;
}

function _initGlobeInstance() {
  if (_globeInstance || typeof Globe === 'undefined') return;
  const container = document.getElementById('globe-container');
  if (!container) return;

  _globeInstance = Globe()(container)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('images/globe-earth.jpg?v=1787144650943')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#3B82F6')
    .atmosphereAltitude(0.2)
    .htmlElementsData([])
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlElement(d => _buildSpotElement(d, d._maxCount || 1))
    .htmlTransitionDuration(400);

  const controls = _globeInstance.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.minDistance = 120; // autorise un zoom plus rapproche que le defaut
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  _resizeGlobe();
  window.addEventListener('resize', _resizeGlobe);
}

function _resizeGlobe() {
  if (!_globeInstance) return;
  const container = document.getElementById('globe-container');
  if (!container) return;
  _globeInstance.width(container.clientWidth).height(container.clientHeight);
}

// Le chargement "Toutes les annees" declenche une quinzaine d'appels
// Garmin successifs (un par annee) - chacun re-render le tableau Activites
// et donc rappelle refreshActivityGlobe(). Sans ce debounce, la modale
// affiche une suite de comptes intermediaires qui clignotent avant de se
// stabiliser (constate : "115 sur 139" affiche une fraction de seconde
// avant de retomber sur le vrai total une fois toutes les annees chargees).
function refreshActivityGlobe() {
  const backdrop = document.getElementById('globe-modal-backdrop');
  if (!backdrop || backdrop.style.display === 'none') return;
  if (!_globeInstance) return;
  clearTimeout(_globeRefreshTimer);
  _globeRefreshTimer = setTimeout(_applyGlobeRefresh, 300);
}

function _applyGlobeRefresh() {
  if (!_globeInstance) return;
  const points = _globeGeoPoints();
  const total = (_lastFilteredActivities || []).length;
  const countEl = document.getElementById('globe-modal-count');
  if (countEl) {
    countEl.textContent = total
      ? `${points.length} activité${points.length > 1 ? 's' : ''} géolocalisée${points.length > 1 ? 's' : ''} sur ${total}`
      : '';
  }

  const emptyEl = document.getElementById('globe-empty-state');
  if (emptyEl) emptyEl.style.display = points.length === 0 ? 'flex' : 'none';

  const clusters = _clusterGeoPoints(points);
  const maxCount = clusters.reduce((m, c) => Math.max(m, c.count), 1);
  clusters.forEach(c => { c._maxCount = maxCount; });
  _globeInstance.htmlElementsData(clusters);

  if (points.length > 0 && !_globeInitialViewSet) {
    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    _globeInstance.pointOfView({ lat: avgLat, lng: avgLng, altitude: 1.6 }, 0);
    _globeInitialViewSet = true;
  }
}

function openActivityGlobe() {
  const backdrop = _ensureGlobeModal();
  backdrop.style.display = 'flex';
  const loadingEl = document.getElementById('globe-loading');

  if (!_globeInstance) {
    if (loadingEl) loadingEl.style.display = 'flex';
    // setTimeout (pas requestAnimationFrame, qui ne se declenche jamais sur
    // un onglet en arriere-plan) : laisse le temps au backdrop de s'afficher
    // (display:flex) avant de lancer l'initialisation WebGL, pour eviter un
    // flash de conteneur vide pendant le chargement des textures.
    setTimeout(() => {
      _initGlobeInstance();
      clearTimeout(_globeRefreshTimer);
      _applyGlobeRefresh();
      if (loadingEl) loadingEl.style.display = 'none';
    }, 0);
  } else {
    _resizeGlobe();
    clearTimeout(_globeRefreshTimer);
    _applyGlobeRefresh();
  }
}

function closeActivityGlobe() {
  const backdrop = document.getElementById('globe-modal-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  if (_globeInstance) _globeInstance.controls().autoRotate = true;
}
