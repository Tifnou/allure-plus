// Client HTTP vers l'API Overpass (OpenStreetMap) - interroge les zones
// naturelles (forets, bois, parcs naturels, reserves) dans un rayon donne,
// pour permettre a la recherche trail elargie de privilegier un terrain "de
// nature" plutot que le seul relief (cf findHillyCandidateCenters,
// route_generator.js). Retour utilisateur explicite (aout 2026) : une
// recherche elargie pouvait renvoyer une boucle avec de grosses portions en
// zone urbaine (ex: Bievres) simplement parce que le relief local y etait
// suffisant, sans que la zone soit reellement "trail" (bois/foret/parc).
// Suit le pattern de geoportail_client.js/brouter_client.js (module
// autonome, fonctions exportees, fetch natif, jamais bloquant en cas
// d'echec).
//
// Instance publique Overpass (overpass-api.de), gratuite, sans cle - meme
// esprit que Nominatim (route_generator.js geocode) : usage local
// mono-utilisateur, largement sous les limites de fair-use.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Plus genereux que le timeout Geoportail (8s) : Overpass repond parfois en
// plusieurs secondes sur une requete geometrique (out geom) meme pour une
// zone modeste, et cette requete ne se declenche qu'UNE fois par generation
// (pas d'appels repetes), contrairement a getElevations.
const FETCH_TIMEOUT_MS = 12000;

function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function bboxFromCenter(lat, lon, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

// Tags OSM consideres comme "terrain nature" pour le trail - foret, bois,
// parc naturel, reserve, broussaille. Volontairement PAS park urbain
// (leisure=park seul, souvent un espace vert amenage en ville) ni
// golf/jardin - pas representatif d'un terrain de trail.
const NATURAL_AREA_QUERY_TAGS = [
  'way["landuse"="forest"]',
  'way["natural"="wood"]',
  'way["natural"="scrub"]',
  'way["boundary"="national_park"]',
  'way["leisure"="nature_reserve"]',
];

// Renvoie un tableau de polygones (chacun un tableau de {lat,lon}) pour les
// zones naturelles trouvees dans le rayon, ou null si l'appel echoue
// (reseau, timeout, service indisponible...) - l'appelant se replie alors
// sur le relief seul (fonctionnalite d'appoint, jamais bloquante).
// N'interroge que des `way` (polygones simples fermes) - les multipolygones
// complexes (relations, grandes forets avec trouees) ne sont pas geres
// specifiquement ; simplification assumee, la grande majorite des bois/forets
// de taille moyenne pres d'un point de depart sont deja des ways simples.
async function queryNaturalAreas(centerLat, centerLon, radiusM) {
  const bbox = bboxFromCenter(centerLat, centerLon, radiusM);
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:10];(${NATURAL_AREA_QUERY_TAGS.map(t => `${t}(${bboxStr});`).join('')});out geom;`;
  try {
    const res = await fetchWithTimeout(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'AllurePlus/1.0 (app perso, cf. github.com)' },
      body: query,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.elements)) return null;
    return data.elements
      .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3)
      .map(el => el.geometry.map(pt => ({ lat: pt.lat, lon: pt.lon })));
  } catch (err) {
    return null;
  }
}

// Ray casting standard (point dans un polygone) - polygone = tableau de
// {lat,lon} (lon=x, lat=y ; la distorsion aux latitudes francaises est
// negligeable pour un simple test d'appartenance, pas un calcul de surface).
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat))
      && (point.lon < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInAnyPolygon(point, polygons) {
  return polygons.some(poly => pointInPolygon(point, poly));
}

module.exports = { queryNaturalAreas, isPointInAnyPolygon, pointInPolygon };
