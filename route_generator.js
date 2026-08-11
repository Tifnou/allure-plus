// Coeur algorithmique de la generation d'itineraires. Fonctions
// majoritairement pures (testables sans BRouter) sauf la, ou l'orchestration
// finale qui appelle brouter_client. Deux strategies, retournees ensemble
// quand c'est pertinent - jamais un resultat unique force silencieusement :
//   1. "boucle naturelle" - tisse a travers le reseau reel pour cumuler du D+.
//   2. "boucle + repetitions" - si la boucle naturelle ne suffit pas, repete
//      (aller-retour) le segment le plus efficace, insere a sa position
//      naturelle dans la sequence (pas ajoute en bout de circuit).
//
// Enseignements de la session de recherche (aout 2026) qui fondent ces choix :
// - BRouter n'expose pas de mode "boucle" natif sur son API HTTP -> boucle
//   construite via des points de passage geometriques.
// - Le D+ filtre annonce par BRouter sous-estime celui de la montre
//   (~x1.26 observe sur 2 echantillons reels - a affiner avec le temps).
// - Une allure unique fausse fortement la duree predite ; l'allure reelle
//   varie par tranche de pente (voir pace_profile.js).

const { routeThroughPoints } = require('./brouter_client');
const { isBrouterConfigured } = require('./brouter_manager');
const { bucketForGrade } = require('./pace_profile');

// Sous-estimation observee du D+ BRouter (filtre) par rapport a ce
// qu'affiche une montre reelle. Base sur 2 comparaisons (session recherche
// aout 2026) - a recalculer avec plus d'echantillons quand disponibles.
const ASCENT_CALIBRATION_FACTOR = 1.26;

const R_EARTH = 6371000;

function haversineDistance(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
  const angDist = distanceM / R_EARTH;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lon: ((lon2 * 180 / Math.PI) + 540) % 360 - 180 };
}

// Geocodage via Nominatim - ne selectionne jamais un resultat silencieusement,
// retourne les candidats pour confirmation cote UI (lecon de la session de
// recherche : une correction/selection silencieuse a fait tester la mauvaise
// adresse pendant plusieurs essais).
async function geocode(address) {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: address, format: 'json', limit: '3',
  });
  const res = await fetch(url, { headers: { 'User-Agent': 'AllurePlus/1.0 (app perso, cf. github.com)' } });
  if (!res.ok) throw new Error(`Geocodage echoue (HTTP ${res.status})`);
  const results = await res.json();
  return results.map(r => ({ label: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

// Genere une boucle passant par `start`, convergeant vers targetDistanceM en
// quelques iterations. Pas besoin d'Overpass : BRouter accroche deja les
// points au reseau reel de chemins/routes.
async function generateLoop(start, targetDistanceM, profile, opts = {}) {
  const bearings = opts.bearings || [45, 135, 225, 315];
  const maxIterations = opts.maxIterations || 4;
  let radius = targetDistanceM / 4;
  let best = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    const waypoints = [start, ...bearings.map(b => destinationPoint(start.lat, start.lon, b, radius)), start];
    let result;
    try {
      result = await routeThroughPoints(waypoints, profile, { trackname: `loop_iter${iter}` });
    } catch (err) {
      radius *= 0.7; // points probablement non routables (zone sans chemin) - on resserre
      continue;
    }
    if (!best || Math.abs(result.distanceM - targetDistanceM) < Math.abs(best.distanceM - targetDistanceM)) {
      best = result;
    }
    const ratio = targetDistanceM / result.distanceM;
    if (Math.abs(ratio - 1) < 0.15) break;
    radius *= ratio;
  }

  if (!best) throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  return best;
}

// Recherche par fenetre glissante du segment le plus efficace en D+ sur une
// distance courte (candidat a la repetition). Logique validee sur les vrais
// GPX de la session de recherche (course Trifouillette, Techni'trail).
function findSteepestSegment(points, { minDistM = 150, maxDistM = 1000 } = {}) {
  let best = { gainM: 0 };
  for (let i = 0; i < points.length; i++) {
    let dist = 0;
    for (let j = i + 1; j < points.length && dist < maxDistM; j++) {
      dist += haversineDistance(points[j - 1], points[j]);
      const gain = points[j].ele - points[i].ele;
      if (dist >= minDistM && gain > best.gainM) {
        best = { gainM: gain, distM: dist, startIdx: i, endIdx: j, from: points[i], to: points[j] };
      }
    }
  }
  return best.gainM > 0 ? best : null;
}

// Insere n allers-retours supplementaires a la position naturelle du segment
// dans la sequence (pas en fin de circuit - erreur constatee et corrigee
// pendant la session de recherche : ajouter la repetition en bout de tracé
// force un detour couteux au lieu d'un enchainement sur place).
function buildRepeatedWaypoints(basePoints, segment, n) {
  const before = basePoints.slice(0, segment.endIdx + 1);
  const after = basePoints.slice(segment.endIdx + 1);
  const repeats = [];
  for (let k = 0; k < n; k++) repeats.push(segment.from, segment.to);
  return [...before, ...repeats, ...after].map(p => ({ lat: p.lat, lon: p.lon }));
}

function calibrateAscent(filteredAscendM) {
  return Math.round(filteredAscendM * ASCENT_CALIBRATION_FACTOR);
}

// Duree reelle predite : decoupe le tracé en segments (fusionnes jusqu'a
// >=15m pour lisser le bruit), applique l'allure reelle par tranche de pente
// plutot qu'une allure unique (ecart constate de 40%+ sur une sortie testee).
function predictDurationMin(points, paceMinPerKm) {
  let totalMin = 0;
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    let segDist = haversineDistance(points[i], points[j]);
    while (segDist < 15 && j < points.length - 1) { j++; segDist = haversineDistance(points[i], points[j]); }
    const grade = segDist > 0 ? (points[j].ele - points[i].ele) / segDist : 0;
    totalMin += (segDist / 1000) * paceMinPerKm[bucketForGrade(grade)];
    i = j;
  }
  return totalMin;
}

const TERRAIN_PROFILES = { trail: 'hiking-mountain', route: 'trekking' };
const MAX_REPEATS = 15;
const ASCENT_TOLERANCE_M = 30;

// Orchestration : construit une ou deux options selon que la boucle
// naturelle suffit ou non a atteindre le D+ vise.
async function generateRouteOptions({ start, targetDistanceM, targetAscentM, terrain = 'trail', paceMinPerKm }) {
  // Verifie l'infrastructure avant toute tentative de routage : sans ca, les
  // echecs de generateLoop (qui retente avec un rayon reduit, pensant a un
  // probleme de terrain) masqueraient un message clair du type "BRouter non
  // configure" derriere un message generique trompeur ("secteur non routable").
  if (!isBrouterConfigured()) {
    throw new Error('BRouter n\'est pas configuré sur ce serveur (fichiers manquants dans le dossier brouter/) — voir le setup dans le README avant de générer un itinéraire.');
  }

  const profile = TERRAIN_PROFILES[terrain] || TERRAIN_PROFILES.trail;
  const natural = await generateLoop(start, targetDistanceM, profile);

  const naturalOption = {
    type: 'boucle-naturelle',
    label: 'Boucle sans répétition',
    points: natural.points,
    distanceM: natural.distanceM,
    ascentM: calibrateAscent(natural.filteredAscendM),
    predictedDurationMin: predictDurationMin(natural.points, paceMinPerKm),
  };

  const options = [naturalOption];
  let warning = null;

  const needsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M;

  if (needsMoreAscent) {
    const segment = findSteepestSegment(natural.points);
    if (!segment) {
      warning = `Aucune côte exploitable trouvée pour compléter le D+ dans ce secteur — seule la boucle naturelle (${naturalOption.ascentM} m) est proposée.`;
    } else {
      const targetFilteredM = targetAscentM / ASCENT_CALIBRATION_FACTOR;
      const gapFilteredM = targetFilteredM - natural.filteredAscendM;
      let n = Math.min(MAX_REPEATS, Math.max(1, Math.ceil(gapFilteredM / segment.gainM)));

      const repeatedWaypoints = buildRepeatedWaypoints(natural.points, segment, n);
      const repeated = await routeThroughPoints(repeatedWaypoints, profile, { trackname: 'boucle_repetitions' });
      const repeatedAscentM = calibrateAscent(repeated.filteredAscendM);

      options.push({
        type: 'boucle-repetitions',
        label: `Boucle avec ${n} répétition${n > 1 ? 's' : ''} de côte`,
        points: repeated.points,
        distanceM: repeated.distanceM,
        ascentM: repeatedAscentM,
        repeats: n,
        repeatedSegment: { fromLat: segment.from.lat, fromLon: segment.from.lon, toLat: segment.to.lat, toLon: segment.to.lon, gainM: segment.gainM },
        predictedDurationMin: predictDurationMin(repeated.points, paceMinPerKm),
      });

      if (repeatedAscentM < targetAscentM - ASCENT_TOLERANCE_M) {
        warning = `Le secteur ne permet pas d'atteindre ${targetAscentM} m de D+ même avec répétitions (max ${MAX_REPEATS}) — meilleure option trouvée : ${repeatedAscentM} m.`;
      }
    }
  }

  return { options, warning };
}

function buildGpxXml(points, label = 'Allure+') {
  const esc = (s) => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const trkpts = points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele ?? 0}</ele></trkpt>`).join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Allure+" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(label)}</name>
    <trkseg>
      ${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

module.exports = {
  geocode,
  destinationPoint,
  haversineDistance,
  generateLoop,
  findSteepestSegment,
  buildRepeatedWaypoints,
  calibrateAscent,
  predictDurationMin,
  generateRouteOptions,
  buildGpxXml,
  TERRAIN_PROFILES,
  ASCENT_CALIBRATION_FACTOR,
};
