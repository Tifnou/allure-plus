// globe.js — Globe 3D des activites (page Activites)
// Affiche les zones ou l'utilisateur a couru/roule/marche sous forme de
// cellules hexagonales agregees (couleur/hauteur = frequence), plutot que
// des points bruts qui se chevaucheraient massivement autour du "point
// d'attache" (memes lieux revisites des dizaines de fois). Les points
// affiches suivent exactement le meme jeu filtre que le tableau Activites
// (_lastFilteredActivities, alimente par renderAllActivities, app.js) —
// aucune logique de filtre dupliquee ici.

let _globeInstance = null;
let _globeModalEl = null;
let _globeInitialViewSet = false;

function _globeGeoPoints() {
  return (_lastFilteredActivities || [])
    .filter(a => typeof a.startLat === 'number' && typeof a.startLon === 'number')
    .map(a => ({ lat: a.startLat, lng: a.startLon }));
}

// Degrade bleu (rare) -> ambre -> rouge (frequent), sur une echelle log pour
// qu'un lieu "domicile" (souvent 50-100+ sorties) n'ecrase pas visuellement
// les quelques points isoles (course, vacances...) qui doivent rester
// distinguables plutot que tous ecrases au bleu le plus terne.
function _globeHexColor(weight) {
  const norm = Math.min(1, Math.log(weight + 1) / Math.log(20));
  const stops = [[59, 130, 246], [250, 204, 21], [248, 113, 113]];
  const scaled = norm * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const t = scaled - i;
  const c = stops[i].map((v, idx) => Math.round(v + (stops[i + 1][idx] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
}
function _globeHexAltitude(weight) {
  const norm = Math.min(1, Math.log(weight + 1) / Math.log(20));
  return 0.01 + 0.06 * norm;
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
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-dark.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#3B82F6')
    .atmosphereAltitude(0.2)
    .hexBinPointsData([])
    .hexBinResolution(4)
    .hexMargin(0.18)
    .hexBinMerge(true)
    .hexTopColor(d => _globeHexColor(d.sumWeight))
    .hexSideColor(d => _globeHexColor(d.sumWeight))
    .hexAltitude(d => _globeHexAltitude(d.sumWeight))
    .hexTransitionDuration(700);

  const controls = _globeInstance.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
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

function refreshActivityGlobe() {
  const backdrop = document.getElementById('globe-modal-backdrop');
  if (!backdrop || backdrop.style.display === 'none') return;
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

  _globeInstance.hexBinPointsData(points);

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
      refreshActivityGlobe();
      if (loadingEl) loadingEl.style.display = 'none';
    }, 0);
  } else {
    _resizeGlobe();
    refreshActivityGlobe();
  }
}

function closeActivityGlobe() {
  const backdrop = document.getElementById('globe-modal-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  if (_globeInstance) _globeInstance.controls().autoRotate = true;
}
