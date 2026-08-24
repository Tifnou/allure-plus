// Client HTTP vers l'instance BRouter locale (self-hosted). Suit le pattern
// de campus_client.js (module autonome, fonctions exportees) mais utilise
// fetch (natif Node) plutot que https.request, l'appel etant local en HTTP.

const { ensureBrouterRunning, getPort } = require('./brouter_manager');

// format=geojson (plutot que gpx) : memes donnees de base (points, distance,
// D+ filtre), mais expose EN PLUS `properties.messages` - un tableau de
// lignes de debug BRouter (une par transition de noeud/way reellement
// traversee, plus dense que les points geometrie qui sont lissés/rééchantillonnés)
// dont la colonne WayTags donne les tags OSM bruts de la voie ("highway=path
// surface=gravel...") et Distance la longueur en m de ce segment - exploite
// par computeSurfaceBreakdown (route_generator.js) pour classer le parcours
// en % route/chemin/piste cyclable, sans requete BRouter supplementaire.
// Colonnes confirmees empiriquement (aout 2026) : ["Longitude","Latitude",
// "Elevation","Distance","CostPerKm","ElevCost","TurnCost","NodeCost",
// "InitialCost","WayTags","NodeTags","Time","Energy"] - Longitude/Latitude
// sont des entiers scalés ×1e6 (ex: "2168750" = 2.168750°), inutilises ici
// (la geometrie vient deja de `coordinates`), Distance et WayTags en clair.
const WAYMSG_COL_DISTANCE = 3;
const WAYMSG_COL_WAYTAGS = 9;

function parseGeoJson(jsonText) {
  const data = JSON.parse(jsonText);
  const feature = data.features && data.features[0];
  if (!feature) return { points: [], distanceM: null, filteredAscendM: null, wayMessages: [] };
  const points = (feature.geometry.coordinates || []).map(c => ({ lon: c[0], lat: c[1], ele: c[2] }));
  const props = feature.properties || {};
  const distanceM = props['track-length'] != null ? parseInt(props['track-length'], 10) : null;
  const filteredAscendM = props['filtered ascend'] != null ? parseInt(props['filtered ascend'], 10) : null;
  // 1ere ligne de `messages` = en-tetes de colonnes, pas une donnee.
  const rows = Array.isArray(props.messages) ? props.messages.slice(1) : [];
  const wayMessages = rows.map(r => ({
    distM: parseInt(r[WAYMSG_COL_DISTANCE], 10) || 0,
    wayTags: r[WAYMSG_COL_WAYTAGS] || '',
  }));
  return { points, distanceM, filteredAscendM, wayMessages };
}

// waypoints: [{lat, lon}, ...] dans l'ordre de passage souhaite.
// profile: nom du fichier .brf sans extension (ex: 'hiking-mountain').
// profileParams: overrides des variables `assign %nom%` exposees par le
// profil .brf (ex: { avoid_unsafe: 'true' }) - passes tels quels en query
// params, BRouter les substitue aux valeurs par defaut du profil.
// nogos: [{lat, lon, radius}, ...] optionnel - zones circulaires interdites
// (parametre standard du serveur BRouter, confirme en desassemblant
// brouter.jar : RoutingParamCollector lit nogoLats/nogoLons/nogoRadi depuis
// un param `nogos=lon,lat,rayon|lon,lat,rayon...`). Utilise par
// routeEditorRerouteViaPoint (route_generator.js) pour empecher BRouter de
// rebrousser chemin sur le 2e tronçon d'un recalcul en 2 etapes.
async function routeThroughPoints(waypoints, profile, { trackname, profileParams, nogos } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('routeThroughPoints necessite au moins 2 points de passage.');
  }
  await ensureBrouterRunning();

  const lonlats = waypoints.map(p => `${p.lon},${p.lat}`).join('|');
  const params = new URLSearchParams({
    lonlats,
    profile,
    alternativeidx: '0',
    format: 'geojson',
  });
  if (trackname) params.set('trackname', trackname);
  if (nogos && nogos.length) params.set('nogos', nogos.map(n => `${n.lon},${n.lat},${n.radius}`).join('|'));
  if (profileParams) Object.entries(profileParams).forEach(([k, v]) => params.set(k, v));

  const url = `http://localhost:${getPort()}/brouter?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`BRouter a repondu ${res.status} (${text.slice(0, 200) || 'sans detail'})`);
  }
  const parsed = parseGeoJson(text);
  if (parsed.points.length === 0) {
    throw new Error('BRouter a repondu sans tracé exploitable (verifier les points de passage / profil).');
  }
  return parsed;
}

module.exports = { routeThroughPoints, parseGeoJson };
