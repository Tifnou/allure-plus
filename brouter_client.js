// Client HTTP vers l'instance BRouter locale (self-hosted). Suit le pattern
// de campus_client.js (module autonome, fonctions exportees) mais utilise
// fetch (natif Node) plutot que https.request, l'appel etant local en HTTP.

const { ensureBrouterRunning, getPort } = require('./brouter_manager');

const TRKPT_RE = /<trkpt lon="([^"]+)" lat="([^"]+)"><ele>([^<]+)<\/ele>/g;
const HEADER_RE = /track-length\s*=\s*(\d+)\s+filtered ascend\s*=\s*(\d+)\s+plain-ascend\s*=\s*(\d+)/;

function parseGpx(gpxText) {
  const points = [];
  let m;
  TRKPT_RE.lastIndex = 0;
  while ((m = TRKPT_RE.exec(gpxText)) !== null) {
    points.push({ lon: parseFloat(m[1]), lat: parseFloat(m[2]), ele: parseFloat(m[3]) });
  }
  const header = HEADER_RE.exec(gpxText);
  const distanceM = header ? parseInt(header[1], 10) : null;
  const filteredAscendM = header ? parseInt(header[2], 10) : null;
  return { points, distanceM, filteredAscendM };
}

// waypoints: [{lat, lon}, ...] dans l'ordre de passage souhaite.
// profile: nom du fichier .brf sans extension (ex: 'hiking-mountain').
// profileParams: overrides des variables `assign %nom%` exposees par le
// profil .brf (ex: { avoid_unsafe: 'true' }) - passes tels quels en query
// params, BRouter les substitue aux valeurs par defaut du profil.
async function routeThroughPoints(waypoints, profile, { trackname, profileParams } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('routeThroughPoints necessite au moins 2 points de passage.');
  }
  await ensureBrouterRunning();

  const lonlats = waypoints.map(p => `${p.lon},${p.lat}`).join('|');
  const params = new URLSearchParams({
    lonlats,
    profile,
    alternativeidx: '0',
    format: 'gpx',
  });
  if (trackname) params.set('trackname', trackname);
  if (profileParams) Object.entries(profileParams).forEach(([k, v]) => params.set(k, v));

  const url = `http://localhost:${getPort()}/brouter?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`BRouter a repondu ${res.status} (${text.slice(0, 200) || 'sans detail'})`);
  }
  const parsed = parseGpx(text);
  if (parsed.points.length === 0) {
    throw new Error('BRouter a repondu sans tracé exploitable (verifier les points de passage / profil).');
  }
  return parsed;
}

module.exports = { routeThroughPoints, parseGpx };
