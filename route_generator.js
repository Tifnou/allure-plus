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

// Recherche en cascade via les API officielles françaises (geo.api.gouv.fr,
// api-adresse.data.gouv.fr) plutot que Nominatim pour la saisie du depart :
// code postal -> villes associees -> rues de cette ville en autocompletion.
// La selection explicite a chaque etape (l'utilisateur clique une suggestion
// reelle) tient lieu de confirmation - plus besoin de modale bloquante.
async function getCommunesForPostcode(postcode) {
  const url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(postcode)}&fields=nom,code,centre`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche de commune échouée (HTTP ${res.status})`);
  const data = await res.json();
  return data
    .filter(c => c.centre && c.centre.coordinates)
    .map(c => ({ nom: c.nom, code: c.code, lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] }));
}

async function searchStreet(query, citycode) {
  const url = 'https://api-adresse.data.gouv.fr/search/?' + new URLSearchParams({ q: query, citycode, type: 'street', limit: '6' });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche de rue échouée (HTTP ${res.status})`);
  const data = await res.json();
  return (data.features || []).map(f => ({ label: `${f.properties.name}, ${f.properties.city}`, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
}

// Point de depart par defaut quand aucune rue n'est saisie : la mairie de la
// commune choisie, plus precise que le simple centroide administratif.
async function getTownHall(citycode) {
  const url = 'https://api-adresse.data.gouv.fr/search/?' + new URLSearchParams({ q: 'Mairie', citycode, limit: '1' });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche de mairie échouée (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.features || data.features.length === 0) return null;
  const f = data.features[0];
  return { label: f.properties.label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
}

function loopWaypointsForBearing(start, bearing, radius) {
  // Boucle asymetrique (pas un simple aller-retour) : pousse vers `bearing`
  // puis revient par un angle legerement different, pour suivre un vrai
  // reseau de chemins plutot qu'une ligne droite.
  return [
    start,
    destinationPoint(start.lat, start.lon, bearing - 35, radius * 0.55),
    destinationPoint(start.lat, start.lon, bearing, radius),
    destinationPoint(start.lat, start.lon, bearing + 35, radius * 0.55),
    start,
  ];
}

const SEARCH_DIRECTIONS = 8;

// Genere une boucle passant par `start`, convergeant vers targetDistanceM.
// Ne se contente pas d'un seul losange symetrique fixe : explore plusieurs
// directions autour du depart (en parallele) et garde celle qui cumule le
// plus de D+ naturel, avant d'affiner le rayon sur cette direction gagnante.
// Sans ca, un jeu de relevements fixe peut tomber sur un secteur plat alors
// qu'un vrai relief existe juste a cote (constate en test reel : plateau
// plat au nord/est de Saclay, relief net vers le sud/sud-est).
// Pas besoin d'Overpass : BRouter accroche deja les points au reseau reel.
async function generateLoop(start, targetDistanceM, profile, opts = {}) {
  const maxRefineIterations = opts.maxRefineIterations || 2;
  const radius = targetDistanceM / 4;

  const bearingsToTry = Array.from({ length: SEARCH_DIRECTIONS }, (_, k) => (360 / SEARCH_DIRECTIONS) * k);
  const scanResults = await Promise.all(bearingsToTry.map(async (bearing) => {
    try {
      const result = await routeThroughPoints(loopWaypointsForBearing(start, bearing, radius), profile, { trackname: `scan_${bearing}` });
      return { bearing, result };
    } catch (err) {
      return null; // direction non routable (hors reseau, zone isolee...)
    }
  }));

  const candidates = scanResults.filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }
  candidates.sort((a, b) => b.result.filteredAscendM - a.result.filteredAscendM);

  let best = candidates[0].result;
  let bestBearing = candidates[0].bearing;
  let bestRadius = radius;

  for (let iter = 0; iter < maxRefineIterations; iter++) {
    const ratio = targetDistanceM / best.distanceM;
    if (Math.abs(ratio - 1) < 0.15) break;
    bestRadius *= ratio;
    try {
      best = await routeThroughPoints(loopWaypointsForBearing(start, bestBearing, bestRadius), profile, { trackname: `refine_${iter}` });
    } catch (err) {
      break; // le rayon affine n'est plus routable, on garde le meilleur resultat connu
    }
  }
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
// Un "segment le plus efficace" avec moins que ça de gain n'est que du bruit
// GPS/altimetrique sur terrain plat, pas une vraie cote exploitable - le
// signaler plutot que de repeter indefiniment un quasi-rien.
const MIN_VIABLE_SEGMENT_GAIN_M = 8;
// Les repetitions ne doivent jamais faire deraper la sortie loin au-dela de
// ce qui a ete demande (bug reel constate : 1h05/300m D+ -> proposition a
// 41 km, faute de plafond sur la duree/distance reelle pendant qu'on ajoute
// des repetitions pour chercher le D+ a tout prix).
const MAX_OVERSHOOT_RATIO = 1.3;

// Nombre de points de depart alternatifs testes quand la recherche elargie
// est activee, et rayon d'echantillonnage angulaire (4 points cardinaux
// suffisent : chaque point relance deja sa propre recherche a 8 directions,
// inutile de multiplier les angles en plus).
const ALT_START_BEARINGS = [0, 90, 180, 270];

// Orchestration : construit une ou deux options selon que la boucle
// naturelle suffit ou non a atteindre le D+ vise. Si searchRadiusM est
// fourni et que le depart exact ne suffit pas, teste aussi quelques points
// de depart alternatifs dans ce rayon (l'utilisateur accepte alors de
// rejoindre un point de depart different, ex. en voiture, avant de courir).
async function generateRouteOptions({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain = 'trail', paceMinPerKm, searchRadiusM }) {
  // Verifie l'infrastructure avant toute tentative de routage : sans ca, les
  // echecs de generateLoop (qui retente avec un rayon reduit, pensant a un
  // probleme de terrain) masqueraient un message clair du type "BRouter non
  // configure" derriere un message generique trompeur ("secteur non routable").
  if (!isBrouterConfigured()) {
    throw new Error('BRouter n\'est pas configuré sur ce serveur (fichiers manquants dans le dossier brouter/) — voir le setup dans le README avant de générer un itinéraire.');
  }

  const profile = TERRAIN_PROFILES[terrain] || TERRAIN_PROFILES.trail;
  let effectiveStart = start;
  let natural = await generateLoop(start, targetDistanceM, profile);
  let naturalAscentM = calibrateAscent(natural.filteredAscendM);

  const initialNeedsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalAscentM < targetAscentM - ASCENT_TOLERANCE_M;

  let usedAlternateStart = false;
  if (initialNeedsMoreAscent && searchRadiusM) {
    // Recherche sequentielle (pas tout en parallele - chaque candidat lance
    // deja 8 appels BRouter en interne, inutile de saturer le process local).
    let best = null;
    for (const bearing of ALT_START_BEARINGS) {
      const altStart = destinationPoint(start.lat, start.lon, bearing, searchRadiusM);
      try {
        const loop = await generateLoop(altStart, targetDistanceM, profile, { maxRefineIterations: 0 });
        const ascentM = calibrateAscent(loop.filteredAscendM);
        if (!best || ascentM > best.ascentM) best = { altStart, loop, ascentM };
      } catch (err) { /* point non routable, on ignore */ }
    }
    if (best && best.ascentM > naturalAscentM) {
      effectiveStart = best.altStart;
      natural = best.loop;
      naturalAscentM = best.ascentM;
      usedAlternateStart = true;
    }
  }

  const naturalOption = {
    type: 'boucle-naturelle',
    label: 'Boucle sans répétition',
    points: natural.points,
    distanceM: natural.distanceM,
    ascentM: naturalAscentM,
    predictedDurationMin: predictDurationMin(natural.points, paceMinPerKm),
    commentary: usedAlternateStart
      ? `Le D+ visé n'était pas atteignable depuis l'adresse demandée — ce départ est décalé d'environ ${(haversineDistance(start, effectiveStart) / 1000).toFixed(1)} km (à rejoindre avant de courir) pour trouver un secteur plus vallonné. Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour de ce nouveau départ.`
      : `Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour du départ pour trouver le meilleur dénivelé naturel du secteur, sans répétition de côte.`,
    alternateStart: usedAlternateStart ? { lat: effectiveStart.lat, lon: effectiveStart.lon, distanceFromRequestedM: haversineDistance(start, effectiveStart) } : null,
  };

  const options = [naturalOption];
  let warning = null;

  const needsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M;

  if (needsMoreAscent) {
    const segment = findSteepestSegment(natural.points);
    if (!segment || segment.gainM < MIN_VIABLE_SEGMENT_GAIN_M) {
      warning = `Aucune côte exploitable trouvée pour compléter le D+ dans ce secteur — seule la boucle naturelle (${naturalOption.ascentM} m) est proposée.`;
    } else {
      // Budget a ne pas depasser en ajoutant des repetitions : la duree
      // reelle visee si elle est connue, sinon la distance visee. Teste les
      // repetitions une a une (pas de calcul en un coup qui peut deraper) et
      // s'arrete des que le D+ vise est atteint OU que le budget est depasse.
      const overshootBudgetMin = targetDurationMin ? targetDurationMin * MAX_OVERSHOOT_RATIO : null;
      const overshootBudgetDistM = !targetDurationMin ? targetDistanceM * MAX_OVERSHOOT_RATIO : null;

      let repeated = null;
      let repeatedDurationMin = 0;
      let n = 0;
      for (let candidateN = 1; candidateN <= MAX_REPEATS; candidateN++) {
        let candidate;
        try {
          candidate = await routeThroughPoints(buildRepeatedWaypoints(natural.points, segment, candidateN), profile, { trackname: `repeat_${candidateN}` });
        } catch (err) {
          break; // plus de repetitions possibles (points non routables) - on garde le dernier resultat valide
        }
        const candidateDurationMin = predictDurationMin(candidate.points, paceMinPerKm);
        const overBudget = overshootBudgetMin ? candidateDurationMin > overshootBudgetMin : candidate.distanceM > overshootBudgetDistM;

        repeated = candidate;
        repeatedDurationMin = candidateDurationMin;
        n = candidateN;
        if (overBudget) break; // on garde ce dernier essai (le meilleur compromis trouve dans le budget) et on s'arrete
        if (calibrateAscent(candidate.filteredAscendM) >= targetAscentM - ASCENT_TOLERANCE_M) break; // objectif atteint
      }

      const repeatedAscentM = calibrateAscent(repeated.filteredAscendM);

      options.push({
        type: 'boucle-repetitions',
        label: `Boucle avec ${n} répétition${n > 1 ? 's' : ''} de côte`,
        points: repeated.points,
        distanceM: repeated.distanceM,
        ascentM: repeatedAscentM,
        repeats: n,
        repeatedSegment: { fromLat: segment.from.lat, fromLon: segment.from.lon, toLat: segment.to.lat, toLon: segment.to.lon, gainM: segment.gainM },
        predictedDurationMin: repeatedDurationMin,
        commentary: `Le D+ visé (${targetAscentM} m) n'était pas atteignable par une boucle simple dans ce secteur (${naturalAscentM} m naturels) — le passage le plus efficace trouvé (${Math.round(segment.gainM)} m de dénivelé sur ${Math.round(segment.distM)} m) est répété ${n} fois pour s'en rapprocher.`,
        alternateStart: naturalOption.alternateStart,
      });

      if (repeatedAscentM < targetAscentM - ASCENT_TOLERANCE_M) {
        const budgetLabel = targetDurationMin ? `${Math.round(repeatedDurationMin)} min` : `${(repeated.distanceM / 1000).toFixed(1)} km`;
        const radiusNote = searchRadiusM
          ? (usedAlternateStart ? ` (recherche élargie à ${(searchRadiusM / 1000).toFixed(0)} km déjà essayée)` : ' (recherche élargie essayée, aucun point alentour ne fait mieux)')
          : ' — essayez la recherche élargie pour explorer plus loin';
        warning = `Le secteur ne permet pas d'atteindre ${targetAscentM} m de D+ sans dépasser largement ce qui a été demandé${radiusNote} — meilleure option trouvée : ${repeatedAscentM} m de D+ (${n} répétition${n > 1 ? 's' : ''}, ${budgetLabel}).`;
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
  getCommunesForPostcode,
  searchStreet,
  getTownHall,
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
