// globe.js — Globe 3D des activites (page Activites), moteur CesiumJS
// Approche a tuiles (CARTO dark_all, meme famille OSM/CARTO deja utilisee
// pour les cartes de trace GPS ailleurs dans l'app) plutot qu'une texture
// image unique : zoom net a tout niveau, pas de flou (contrainte explicite
// utilisateur) - contrairement a la version precedente (globe.gl), qui
// plafonnait a la resolution d'une seule image raster. Pas de compte
// Cesium Ion (Ion.defaultAccessToken laisse vide) : terrain plat
// (EllipsoidTerrainProvider, pas de relief) + imagerie CARTO seule,
// aucune fonctionnalite payante utilisee.
//
// Les cercles/halos (memes marqueurs que la version globe.gl) sont de
// vrais elements DOM positionnes a chaque frame via la projection
// Cesium lat/lng -> coordonnees ecran (SceneTransforms) plutot que des
// primitives Cesium natives, pour garder le controle CSS total sur le
// halo (radial-gradient + box-shadow) deja mis au point.
//
// Les points affiches suivent exactement le meme jeu filtre que le
// tableau Activites (_lastFilteredActivities, alimente par
// renderAllActivities, app.js) — aucune logique de filtre dupliquee ici.

let _cesiumViewer = null;
let _globeModalEl = null;
let _globeInitialViewSet = false;
let _globeRefreshTimer = null;
let _globeSpotsLayerEl = null;
let _globeSpots = []; // { el, cartesian, cluster }
let _globeAutoRotate = true;
const _globeTileSubdomains = ['a', 'b', 'c', 'd'];

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
    if (!_cesiumViewer) return;
    _globeAutoRotate = false;
    _cesiumViewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(cluster.lng, cluster.lat, 3000),
      duration: 1.1,
    });
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
  if (_cesiumViewer || typeof Cesium === 'undefined') return;
  const container = document.getElementById('globe-container');
  if (!container) return;

  Cesium.Ion.defaultAccessToken = undefined;

  _cesiumViewer = new Cesium.Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayer: new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: _globeTileSubdomains,
      credit: '© OpenStreetMap contributors © CARTO',
      maximumLevel: 19,
    })),
    contextOptions: { webgl: { alpha: true } },
  });

  const scene = _cesiumViewer.scene;
  scene.globe.baseColor = Cesium.Color.BLACK;
  scene.backgroundColor = Cesium.Color.BLACK;
  scene.globe.enableLighting = false;
  scene.moon.show = false;
  scene.sun.show = false;
  scene.skyAtmosphere.hueShift = 0;
  scene.skyAtmosphere.saturationShift = 0.1;
  scene.screenSpaceCameraController.minimumZoomDistance = 50;
  _cesiumViewer.cesiumWidget.creditContainer.style.display = 'none';

  _globeSpotsLayerEl = document.createElement('div');
  _globeSpotsLayerEl.className = 'globe-spots-layer';
  container.appendChild(_globeSpotsLayerEl);

  scene.postRender.addEventListener(_updateSpotPositions);
  scene.postRender.addEventListener(_autoRotateTick);

  const stopAutoRotate = () => { _globeAutoRotate = false; };
  container.addEventListener('mousedown', stopAutoRotate, { once: true });
  container.addEventListener('wheel', stopAutoRotate, { once: true });
  container.addEventListener('touchstart', stopAutoRotate, { once: true });

  window.addEventListener('resize', _resizeGlobe);
}

let _globeLastTickTime = null;
function _autoRotateTick() {
  if (!_globeAutoRotate || !_cesiumViewer) return;
  const now = performance.now();
  const dt = _globeLastTickTime ? (now - _globeLastTickTime) : 16;
  _globeLastTickTime = now;
  _cesiumViewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00003 * dt);
}

function _updateSpotPositions() {
  if (!_cesiumViewer || !_globeSpots.length) return;
  const scene = _cesiumViewer.scene;
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC);
  const transform = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  _globeSpots.forEach(s => {
    if (!occluder.isPointVisible(s.cartesian)) { s.el.style.display = 'none'; return; }
    const winPos = transform.call(Cesium.SceneTransforms, scene, s.cartesian);
    if (!winPos) { s.el.style.display = 'none'; return; }
    s.el.style.display = '';
    s.el.style.left = winPos.x + 'px';
    s.el.style.top = winPos.y + 'px';
  });
}

function _resizeGlobe() {
  if (_cesiumViewer) _cesiumViewer.resize();
}

// Le chargement "Toutes les annees" declenche une quinzaine d'appels
// Garmin successifs (un par annee) - chacun re-render le tableau Activites
// et donc rappelle refreshActivityGlobe(). Sans ce debounce, la modale
// affiche une suite de comptes intermediaires qui clignotent avant de se
// stabiliser.
function refreshActivityGlobe() {
  const backdrop = document.getElementById('globe-modal-backdrop');
  if (!backdrop || backdrop.style.display === 'none') return;
  if (!_cesiumViewer) return;
  clearTimeout(_globeRefreshTimer);
  _globeRefreshTimer = setTimeout(_applyGlobeRefresh, 300);
}

function _applyGlobeRefresh() {
  if (!_cesiumViewer) return;
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

  _globeSpots.forEach(s => s.el.remove());
  _globeSpots = clusters.map(c => {
    const el = _buildSpotElement(c, maxCount);
    _globeSpotsLayerEl.appendChild(el);
    return { el, cartesian: Cesium.Cartesian3.fromDegrees(c.lng, c.lat), cluster: c };
  });
  _updateSpotPositions();

  if (points.length > 0 && !_globeInitialViewSet) {
    const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    _cesiumViewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(avgLng, avgLat, 4000000),
    });
    _globeInitialViewSet = true;
  }
}

function openActivityGlobe() {
  const backdrop = _ensureGlobeModal();
  backdrop.style.display = 'flex';
  const loadingEl = document.getElementById('globe-loading');

  if (!_cesiumViewer) {
    if (loadingEl) loadingEl.style.display = 'flex';
    // setTimeout (pas requestAnimationFrame, qui ne se declenche jamais sur
    // un onglet en arriere-plan) : laisse le temps au backdrop de s'afficher
    // (display:flex) avant de lancer l'initialisation Cesium, pour eviter
    // un flash de conteneur vide pendant le chargement.
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
}
