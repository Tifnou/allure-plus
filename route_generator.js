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

const { routeThroughPoints: routeThroughPointsRaw } = require('./brouter_client');
const { isBrouterConfigured } = require('./brouter_manager');
const { bucketForGrade } = require('./pace_profile');

// Le profil 'trekking' (mode "route") est en réalité un profil vélo
// générique (validForBikes=true dans trekking.brf) : il exclut bien les
// autoroutes (highway=motorway, cout infini) et préfère nettement chemins/
// pistes/rues résidentielles (cout ~1.0-1.5), mais route encore une route
// départementale/nationale sans alternative (cout 1.4 à 10 selon la classe,
// jamais bloquant) car `avoid_unsafe` vaut false par défaut dans le fichier.
// On force ce switch à true pour ce profil - il ajoute un malus specifique
// aux highways sans amenagement velo, pour vraiment minimiser la circulation
// automobile plutot que de l'accepter passivement faute d'alternative locale.
//
// Le profil 'hiking-mountain' (mode "trail") a `consider_elevation=false`
// et `Offroad_factor=0.0` par defaut - il calcule juste le chemin le moins
// couteux entre deux points, sans chercher a maximiser le D+ ni a preferer
// les sentiers etroits hors-piste a une piste/route plus large existant a
// proximite (verifie dans hiking-mountain.brf). Notre recherche a 8
// directions choisit deja QUELLE direction explorer pour le D+, mais DANS
// une direction donnee, BRouter suivra la voie la plus "efficace", pas
// forcement le sentier de foret le plus sinueux. Offroad_factor>0 penalise
// les routes/pistes larges et recompense les chemins non revetus (cf
// commentaires du .brf, "Recommended -0.5 - +1.0") ; path_preference>0
// penalise en plus tout ce qui n'est pas track/path/footway. Ne resout pas
// une vraie absence de donnees OSM (verifie : 2187 chemins/pistes recenses
// via Overpass autour de Saclay, donc pas un probleme de couverture ici),
// mais fait pencher BRouter vers le sentier etroit quand les deux existent.
const PROFILE_PARAMS = {
  trekking: { avoid_unsafe: 'true' },
  'hiking-mountain': { Offroad_factor: '1.0', path_preference: '10' },
};
function routeThroughPoints(waypoints, profile, opts = {}) {
  const profileParams = PROFILE_PARAMS[profile] || null;
  return routeThroughPointsRaw(waypoints, profile, { ...opts, profileParams });
}

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
function sortCommunes(communes) {
  return communes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

async function getCommunesForPostcode(postcode) {
  const url = `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(postcode)}&fields=nom,code,centre`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche de commune échouée (HTTP ${res.status})`);
  const data = await res.json();
  return sortCommunes(data
    .filter(c => c.centre && c.centre.coordinates)
    .map(c => ({ nom: c.nom, code: c.code, lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] })));
}

// Repli quand le code postal complet n'est pas connu : les 2 premiers
// chiffres (departement) suffisent a lister toutes ses communes, triees par
// ordre alphabetique - meme API que ci-dessus, juste un autre parametre de
// filtre (codeDepartement au lieu de codePostal). Un departement peut
// compter plusieurs centaines de communes (ex: Pas-de-Calais ~890) mais un
// <select> natif gere ca sans souci (recherche au clavier incluse).
async function getCommunesForDepartment(deptCode) {
  const url = `https://geo.api.gouv.fr/communes?codeDepartement=${encodeURIComponent(deptCode)}&fields=nom,code,centre`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche de communes échouée (HTTP ${res.status})`);
  const data = await res.json();
  return sortCommunes(data
    .filter(c => c.centre && c.centre.coordinates)
    .map(c => ({ nom: c.nom, code: c.code, lat: c.centre.coordinates[1], lon: c.centre.coordinates[0] })));
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

// Reoriente une boucle fermee pour qu'elle commence/finisse au point du
// tracé le plus proche de `requested`, plutot que systematiquement au
// waypoint BRouter d'origine. Necessaire car une boucle asymetrique repasse
// parfois plus pres du point demande a un autre endroit de son parcours que
// literalement a son "debut" - constate en reel : recherche elargie partie
// de Saclay, boucle ancree plus au nord (Velizy) pour trouver du D+, dont le
// point le plus proche de Saclay se trouve en fait au sud du tracé, pas a
// son debut. Sans repere visuel ni reorientation, le départ affiché
// paraissait "tres loin" du point demande alors que la boucle repassait
// bien plus pres un peu plus loin dans sa sequence.
function reorientLoopToClosestPoint(points, requested) {
  if (!points || points.length < 3) return points;
  let bestIdx = 0, bestDist = Infinity;
  // Le dernier point duplique (a peu pres) le premier sur une boucle fermee -
  // exclu de la recherche pour ne pas biaiser artificiellement vers l'extremite.
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineDistance(points[i], requested);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx === 0) return points; // deja optimal
  const core = points.slice(0, points.length - 1);
  return [...core.slice(bestIdx), ...core.slice(0, bestIdx), core[bestIdx]];
}

const SEARCH_DIRECTIONS = 8;

// Explore les SEARCH_DIRECTIONS autour de `start` (en parallele) et renvoie
// tous les candidats routables tries par D+ naturel decroissant - extrait de
// generateLoop pour pouvoir reutiliser le meme scan a la fois pour la boucle
// principale ET pour les boucles alternatives (cf generateLoopWithAlternates),
// sans relancer une deuxieme salve d'appels BRouter.
async function scanDirections(start, targetDistanceM, profile) {
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
  candidates.sort((a, b) => b.result.filteredAscendM - a.result.filteredAscendM);
  return { candidates, radius };
}

// Affine iterativement le rayon d'une boucle dans une direction fixee pour
// converger vers targetDistanceM (le scan initial, a rayon uniforme pour
// toutes les directions, tombe rarement pile sur la distance visee).
async function refineLoopFromBearing(start, bearing, initialResult, initialRadius, targetDistanceM, profile, maxRefineIterations) {
  let best = initialResult;
  let bestRadius = initialRadius;
  for (let iter = 0; iter < maxRefineIterations; iter++) {
    const ratio = targetDistanceM / best.distanceM;
    if (Math.abs(ratio - 1) < 0.15) break;
    bestRadius *= ratio;
    try {
      best = await routeThroughPoints(loopWaypointsForBearing(start, bearing, bestRadius), profile, { trackname: `refine_${bearing}_${iter}` });
    } catch (err) {
      break; // le rayon affine n'est plus routable, on garde le meilleur resultat connu
    }
  }
  return best;
}

// Genere une boucle passant par `start`, convergeant vers targetDistanceM.
// Ne se contente pas d'un seul losange symetrique fixe : explore plusieurs
// directions autour du depart (en parallele) et garde celle qui cumule le
// plus de D+ naturel, avant d'affiner le rayon sur cette direction gagnante.
// Sans ca, un jeu de relevements fixe peut tomber sur un secteur plat alors
// qu'un vrai relief existe juste a cote (constate en test reel : plateau
// plat au nord/est de Saclay, relief net vers le sud/sud-est).
// Pas besoin d'Overpass : BRouter accroche deja les points au reseau reel.
async function generateLoop(start, targetDistanceM, profile, opts = {}) {
  const maxRefineIterations = opts.maxRefineIterations ?? 2;
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }
  const top = candidates[0];
  return refineLoopFromBearing(start, top.bearing, top.result, radius, targetDistanceM, profile, maxRefineIterations);
}

const MAX_ALT_DIRECTIONS = 2;
// Ecart angulaire minimal entre deux directions proposees (et par rapport a
// la direction principale) pour que les tracés alternatifs soient vraiment
// "ailleurs" plutot que deux boucles quasi identiques a 45° l'une de l'autre.
const ALT_DIRECTION_MIN_BEARING_DIFF = 90;

function bearingDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const COMPASS_8 = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
function bearingToCompassLabel(bearing) {
  return COMPASS_8[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}
// "vers le nord" mais "vers l'est"/"vers l'ouest" (élision devant voyelle) -
// évite l'accord fautif "vers le ouest" dans les libellés/commentaires.
function towardCompassPhrase(bearing) {
  const label = bearingToCompassLabel(bearing);
  return /^[eo]/.test(label) ? `vers l'${label}` : `vers le ${label}`;
}

// Meme scan/affinage que generateLoop, mais renvoie en plus jusqu'a
// MAX_ALT_DIRECTIONS boucles completes dans des directions suffisamment
// distinctes (cf ALT_DIRECTION_MIN_BEARING_DIFF) - pour proposer de vrais
// tracés "ailleurs" plutot que la seule meilleure direction en D+.
async function generateLoopWithAlternates(start, targetDistanceM, profile, opts = {}) {
  const maxRefineIterations = opts.maxRefineIterations ?? 2;
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }

  const primary = candidates[0];
  const best = await refineLoopFromBearing(start, primary.bearing, primary.result, radius, targetDistanceM, profile, maxRefineIterations);

  const chosenBearings = [primary.bearing];
  const altPicks = [];
  for (const c of candidates.slice(1)) {
    if (altPicks.length >= MAX_ALT_DIRECTIONS) break;
    if (chosenBearings.every(b => bearingDiff(b, c.bearing) >= ALT_DIRECTION_MIN_BEARING_DIFF)) {
      altPicks.push(c);
      chosenBearings.push(c.bearing);
    }
  }

  const alternates = [];
  for (const pick of altPicks) {
    try {
      const refined = await refineLoopFromBearing(start, pick.bearing, pick.result, radius, targetDistanceM, profile, maxRefineIterations);
      alternates.push({ bearing: pick.bearing, result: refined });
    } catch (err) { /* direction devenue non routable en affinant - on garde les autres */ }
  }

  return { best, bestBearing: primary.bearing, alternates };
}

// Recherche par fenetre glissante du/des segment(s) les plus efficaces en D+
// sur une distance courte (candidats a la repetition). Logique validee sur
// les vrais GPX de la session de recherche (course Trifouillette,
// Techni'trail). Version plurielle : cherche greedily jusqu'a maxSegments
// segments DISTINCTS (non chevauchants) plutot qu'un seul - un vrai
// parcours de trail ambitieux enchaine plusieurs côtes différentes pour
// cumuler du D+, pas une seule répétée en boucle (constat utilisateur : une
// répétition unique gonfle la distance bien plus qu'un parcours réel type
// Techni'trail, qui répartit le D+ sur plusieurs montées).
// A chaque tour, la meilleure fenetre est cherchee en excluant les indices
// deja retenus (et les fenetres qui les traversent), pour ne jamais choisir
// deux variantes du même passage.
function findSteepestSegments(points, { minDistM = 150, maxDistM = 1000, maxSegments = 3 } = {}) {
  const excluded = new Array(points.length).fill(false);
  const found = [];
  for (let s = 0; s < maxSegments; s++) {
    let best = { gainM: 0 };
    for (let i = 0; i < points.length; i++) {
      if (excluded[i]) continue;
      let dist = 0;
      for (let j = i + 1; j < points.length && dist < maxDistM; j++) {
        if (excluded[j]) break; // ne traverse pas une zone deja retenue
        dist += haversineDistance(points[j - 1], points[j]);
        const gain = points[j].ele - points[i].ele;
        if (dist >= minDistM && gain > best.gainM) {
          best = { gainM: gain, distM: dist, startIdx: i, endIdx: j, from: points[i], to: points[j] };
        }
      }
    }
    if (!best.gainM || best.gainM < MIN_VIABLE_SEGMENT_GAIN_M) break;
    found.push(best);
    for (let k = best.startIdx; k <= best.endIdx; k++) excluded[k] = true;
  }
  return found;
}
// Repli retro-compatible : le meilleur segment seul, ou null si aucun.
function findSteepestSegment(points, opts = {}) {
  const [best] = findSteepestSegments(points, { ...opts, maxSegments: 1 });
  return best || null;
}

// Insere, pour chaque segment, `reps` allers-retours a sa position naturelle
// dans la sequence (pas en fin de circuit - erreur constatee et corrigee
// pendant la session de recherche : ajouter la repetition en bout de tracé
// force un detour couteux au lieu d'un enchainement sur place). Plusieurs
// segments s'enchainent dans l'ordre naturel du parcours (tries par
// endIdx), chacun avec son propre nombre de repetitions.
function buildMultiRepeatedWaypoints(basePoints, segmentReps) {
  const sorted = [...segmentReps].sort((a, b) => a.segment.endIdx - b.segment.endIdx);
  const waypoints = [];
  let cursor = 0;
  for (const { segment, reps } of sorted) {
    waypoints.push(...basePoints.slice(cursor, segment.endIdx + 1));
    for (let k = 0; k < reps; k++) waypoints.push(segment.from, segment.to);
    cursor = segment.endIdx + 1;
  }
  waypoints.push(...basePoints.slice(cursor));
  return waypoints.map(p => ({ lat: p.lat, lon: p.lon }));
}
// Repli retro-compatible : un seul segment repete n fois.
function buildRepeatedWaypoints(basePoints, segment, n) {
  return buildMultiRepeatedWaypoints(basePoints, [{ segment, reps: n }]);
}

// Localise, dans le tracé final renvoyé par BRouter, la plage d'indices
// correspondant a la zone repetee (aller-retour sur le segment le plus
// efficace). Necessaire cote UI pour colorer cette portion differemment sur
// la carte - les index d'entree (waypoints) ne correspondent pas aux index
// de sortie (points du tracé, reechantillonnes par BRouter).
// Principe : `segment.to` est atteint une premiere fois a la fin de la
// portion "before" (avant les repetitions), puis une fois de plus a la fin
// de chaque aller-retour - la derniere occurrence marque la fin de la zone
// repetee, juste avant que le tracé ne reparte vers la portion "after".
function findRepeatedZoneIndexRange(points, segment, thresholdM = 25) {
  const toMatches = [];
  points.forEach((p, i) => {
    if (haversineDistance(p, segment.to) <= thresholdM) toMatches.push(i);
  });
  if (toMatches.length < 2) return null; // pas de veritable repetition detectee (garde-fou)
  return { startIdx: toMatches[0], endIdx: toMatches[toMatches.length - 1] };
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
// Jusqu'a 3 côtes DISTINCTES enchainees plutot qu'une seule repetee en
// boucle (cf findSteepestSegments) - un vrai parcours de trail ambitieux
// varie ses montées, une répétition unique gonfle la distance bien plus
// vite pour le même D+ (constat utilisateur, comparaison à un Techni'trail
// réel). MAX_REPEAT_STEPS = meme budget total que l'ancien MAX_REPEATS=15,
// mais chaque "step" ajoute UNE SEULE repetition a UN SEUL segment (en
// tournicoti round-robin) plutot qu'une repetition a TOUS les segments a la
// fois - premiere version testee (increment groupe par "tour") depassait
// largement la cible en un seul tour (3 segments x +1 rep chacun = beaucoup
// de distance d'un coup), le grain fin residu du comportement mono-segment
// d'origine (une info a la fois, on s'arrete des que suffisant).
const MAX_REPEAT_SEGMENTS = 3;
const MAX_REPEAT_STEPS = 15;
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

// Paliers de distance testes pour un depart alternatif, en fraction du rayon
// demande par l'utilisateur - du plus proche au plus loin. Sans ca, le point
// de depart alternatif sautait directement a la distance MAXIMALE du rayon
// (ex: rayon 5 km -> toujours a 5 km pile, jamais a 1-2 km meme quand un
// point proche suffisait deja) : personne n'a envie de faire 15 km en
// voiture pour un depart si un point a 3-4 km fait tout aussi bien l'affaire.
const ALT_START_RADIUS_FRACTIONS = [1 / 3, 2 / 3, 1];

// Ecart de distance tolere avant de considerer qu'une boucle est "trop
// courte" (secteur mal connecté : impasse, reseau clairsemé...) - meme
// tolerance que le critere de convergence deja utilise dans
// refineLoopFromBearing (15%), pour rester coherent. Pilote la recherche de
// depart alternatif quand ce n'est PAS le D+ qui est en cause (mode route,
// ou trail sans D+ vise) - meme mecanisme que pour le D+, applique a la
// distance/duree cette fois (demande utilisateur : le rayon de recherche
// elargie n'avait de sens qu'en trail, alors qu'un secteur mal desservi
// peut tout aussi bien empecher d'atteindre la distance visee en route).
const DISTANCE_SHORTFALL_TOLERANCE = 0.15;
function distanceCloseness(distanceM, targetM) {
  return 1 - Math.abs(distanceM / targetM - 1);
}

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
  let { best: natural, alternates } = await generateLoopWithAlternates(start, targetDistanceM, profile);
  let naturalAscentM = calibrateAscent(natural.filteredAscendM);

  const initialNeedsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalAscentM < targetAscentM - ASCENT_TOLERANCE_M;
  // Repli sur la distance/duree quand ce n'est PAS le D+ qui motive la
  // recherche (mode route, ou trail sans D+ vise/deja atteint) - le D+
  // reste prioritaire quand il est vise, c'est lui qui pilote alors la
  // recherche elargie (comportement inchange).
  const initialDistanceShortfall = !initialNeedsMoreAscent
    && distanceCloseness(natural.distanceM, targetDistanceM) < (1 - DISTANCE_SHORTFALL_TOLERANCE);

  let usedAlternateStart = false;
  let altStartReason = null; // 'ascent' | 'distance'
  if ((initialNeedsMoreAscent || initialDistanceShortfall) && searchRadiusM) {
    const byAscent = initialNeedsMoreAscent;
    // Recherche sequentielle (pas tout en parallele - chaque candidat lance
    // deja 8 appels BRouter en interne, inutile de saturer le process local).
    // Paliers du plus proche au plus loin (ALT_START_RADIUS_FRACTIONS) : on
    // s'arrete au premier palier qui atteint deja la cible (D+ ou distance
    // selon le cas), pour ne jamais s'eloigner plus que necessaire du
    // depart demande.
    let best = null;
    for (const frac of ALT_START_RADIUS_FRACTIONS) {
      const radiusM = searchRadiusM * frac;
      for (const bearing of ALT_START_BEARINGS) {
        const altStart = destinationPoint(start.lat, start.lon, bearing, radiusM);
        try {
          const loop = await generateLoop(altStart, targetDistanceM, profile, { maxRefineIterations: 0 });
          const ascentM = calibrateAscent(loop.filteredAscendM);
          const closeness = distanceCloseness(loop.distanceM, targetDistanceM);
          const isBetter = byAscent ? (!best || ascentM > best.ascentM) : (!best || closeness > best.closeness);
          if (isBetter) best = { altStart, loop, ascentM, closeness };
        } catch (err) { /* point non routable, on ignore */ }
      }
      const goalReached = byAscent
        ? (best && targetAscentM && best.ascentM >= targetAscentM - ASCENT_TOLERANCE_M)
        : (best && best.closeness >= (1 - DISTANCE_SHORTFALL_TOLERANCE));
      if (goalReached) break;
    }
    const naturalCloseness = distanceCloseness(natural.distanceM, targetDistanceM);
    const isActuallyBetter = byAscent ? (best && best.ascentM > naturalAscentM) : (best && best.closeness > naturalCloseness);
    if (isActuallyBetter) {
      effectiveStart = best.altStart;
      usedAlternateStart = true;
      altStartReason = byAscent ? 'ascent' : 'distance';
      // Le depart a change : les alternatives calculees depuis l'ancien
      // depart ne sont plus coherentes geographiquement - on les recalcule
      // (au passage, `refined.best` est affine sur la distance visee,
      // contrairement a `best.loop` qui vient d'une recherche a
      // maxRefineIterations:0 pour ne pas ralentir le balayage des
      // candidats de depart).
      try {
        const refined = await generateLoopWithAlternates(effectiveStart, targetDistanceM, profile);
        natural = refined.best;
        naturalAscentM = calibrateAscent(natural.filteredAscendM);
        alternates = refined.alternates;
      } catch (err) {
        natural = best.loop;
        naturalAscentM = best.ascentM;
        alternates = [];
      }
    }
  }

  // Reoriente chaque boucle (naturelle + alternatives) pour qu'elle
  // commence/finisse au point de son propre tracé le plus proche du point
  // REELLEMENT demande (toujours `start`, meme si la recherche elargie a
  // ancre la boucle ailleurs pour trouver du D+) - cf reorientLoopToClosestPoint.
  natural = { ...natural, points: reorientLoopToClosestPoint(natural.points, start) };
  alternates = alternates.map(alt => ({ ...alt, result: { ...alt.result, points: reorientLoopToClosestPoint(alt.result.points, start) } }));

  const naturalOption = {
    type: 'boucle-naturelle',
    label: 'Boucle sans répétition',
    points: natural.points,
    distanceM: natural.distanceM,
    ascentM: naturalAscentM,
    predictedDurationMin: predictDurationMin(natural.points, paceMinPerKm),
    commentary: usedAlternateStart
      ? (altStartReason === 'ascent'
          ? `Le D+ visé n'était pas atteignable depuis l'adresse demandée — ce départ est décalé d'environ ${(haversineDistance(start, effectiveStart) / 1000).toFixed(1)} km (à rejoindre avant de courir) pour trouver un secteur plus vallonné. Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour de ce nouveau départ.`
          : `La distance/durée visée n'était pas atteignable depuis l'adresse demandée (secteur mal connecté : impasse, réseau clairsemé…) — ce départ est décalé d'environ ${(haversineDistance(start, effectiveStart) / 1000).toFixed(1)} km (à rejoindre avant de partir) pour trouver un secteur mieux desservi. Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour de ce nouveau départ.`)
      : (terrain === 'trail'
          ? `Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour du départ pour trouver le meilleur dénivelé naturel du secteur, sans répétition de côte.`
          : `Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour du départ pour coller au mieux à la distance/durée visée.`),
    alternateStart: usedAlternateStart ? { lat: effectiveStart.lat, lon: effectiveStart.lon, distanceFromRequestedM: haversineDistance(start, effectiveStart) } : null,
  };

  const options = [naturalOption];

  // Boucles alternatives : mêmes critères (distance/durée), mais dans une
  // direction suffisamment différente pour être un vrai autre choix plutôt
  // qu'une variante quasi identique - cf generateLoopWithAlternates.
  alternates.forEach((alt, i) => {
    const toward = towardCompassPhrase(alt.bearing);
    options.push({
      type: 'boucle-alternative',
      label: `Boucle alternative ${i + 1} — ${toward}`,
      points: alt.result.points,
      distanceM: alt.result.distanceM,
      ascentM: calibrateAscent(alt.result.filteredAscendM),
      predictedDurationMin: predictDurationMin(alt.result.points, paceMinPerKm),
      commentary: `Autre tracé possible, orienté ${toward} plutôt que vers le secteur retenu pour l'option principale — pour varier l'itinéraire tout en visant les mêmes critères.`,
      alternateStart: naturalOption.alternateStart,
    });
  });

  let warning = null;

  // Pas de mecanisme de "repetition" equivalent pour la distance
  // (contrairement au D+ en trail, cf bloc plus bas) : si le secteur reste
  // en-dehors de la tolerance sur la distance/duree, c'est le signal final -
  // averti ici, independamment du bloc de repetitions ci-dessous qui reste
  // specifique au D+ trail. Ne se declenche pas si c'est le D+ qui pilotait
  // la recherche (deja couvert par son propre warning plus bas le cas echeant).
  const finalDistanceShortfall = !initialNeedsMoreAscent
    && distanceCloseness(natural.distanceM, targetDistanceM) < (1 - DISTANCE_SHORTFALL_TOLERANCE);
  if (finalDistanceShortfall) {
    const gotLabel = targetDurationMin ? `${Math.round(naturalOption.predictedDurationMin)} min` : `${(natural.distanceM / 1000).toFixed(1)} km`;
    const targetLabel = targetDurationMin ? `${targetDurationMin} min` : `${(targetDistanceM / 1000).toFixed(1)} km`;
    const radiusNote = searchRadiusM
      ? (usedAlternateStart ? ` (recherche élargie à ${(searchRadiusM / 1000).toFixed(0)} km déjà essayée)` : ' (recherche élargie essayée, aucun point alentour ne fait mieux)')
      : ' — essayez la recherche élargie pour explorer plus loin';
    warning = `Le secteur ne permet pas d'atteindre ${targetLabel} sans trop s'écarter${radiusNote} — meilleure option trouvée : ${gotLabel}.`;
  }

  const needsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M;

  if (needsMoreAscent) {
    const segments = findSteepestSegments(natural.points, { maxSegments: MAX_REPEAT_SEGMENTS });
    if (segments.length === 0) {
      warning = `Aucune côte exploitable trouvée pour compléter le D+ dans ce secteur — seule la boucle naturelle (${naturalOption.ascentM} m) est proposée.`;
    } else {
      // Budget a ne pas depasser en ajoutant des repetitions : la duree
      // reelle visee si elle est connue, sinon la distance visee. Escalade
      // fine, UN SEUL segment incremente d'UNE seule repetition a chaque
      // etape (tournicoti round-robin entre les segments trouves) - teste
      // apres CHAQUE etape et s'arrete des que le D+ vise est atteint OU que
      // le budget est depasse. Un increment groupe (tous les segments +1 en
      // meme temps) a ete teste et depassait largement la cible des le
      // premier tour (chaque tour ajoutant d'un coup 3x plus de distance) -
      // l'increment un par un reproduit la precision de l'ancienne version
      // mono-segment, juste repartie sur plusieurs côtes.
      const overshootBudgetMin = targetDurationMin ? targetDurationMin * MAX_OVERSHOOT_RATIO : null;
      const overshootBudgetDistM = !targetDurationMin ? targetDistanceM * MAX_OVERSHOOT_RATIO : null;

      let repeated = null;
      let repeatedDurationMin = 0;
      const repsBySegment = new Array(segments.length).fill(0);
      for (let step = 0; step < MAX_REPEAT_STEPS; step++) {
        const segIdx = step % segments.length;
        repsBySegment[segIdx]++;
        const segmentReps = segments.map((segment, i) => ({ segment, reps: repsBySegment[i] }));
        let candidate;
        try {
          candidate = await routeThroughPoints(buildMultiRepeatedWaypoints(natural.points, segmentReps), profile, { trackname: `repeat_step${step}` });
        } catch (err) {
          repsBySegment[segIdx]--; // cette etape n'est pas routable - revient a l'etat precedent, garde le dernier resultat valide
          break;
        }
        const candidateDurationMin = predictDurationMin(candidate.points, paceMinPerKm);
        const overBudget = overshootBudgetMin ? candidateDurationMin > overshootBudgetMin : candidate.distanceM > overshootBudgetDistM;

        repeated = candidate;
        repeatedDurationMin = candidateDurationMin;
        if (overBudget) break; // on garde ce dernier essai (le meilleur compromis trouve dans le budget) et on s'arrete
        if (calibrateAscent(candidate.filteredAscendM) >= targetAscentM - ASCENT_TOLERANCE_M) break; // objectif atteint
      }

      const repeatedAscentM = calibrateAscent(repeated.filteredAscendM);
      const repeatedSegments = segments.map((segment, i) => {
        const zone = findRepeatedZoneIndexRange(repeated.points, segment);
        return {
          fromLat: segment.from.lat, fromLon: segment.from.lon, toLat: segment.to.lat, toLon: segment.to.lon, gainM: segment.gainM,
          reps: repsBySegment[i],
          startIdx: zone ? zone.startIdx : null,
          endIdx: zone ? zone.endIdx : null,
        };
      }).filter(s => s.reps > 0); // exclut les segments jamais sollicites (objectif deja atteint avant leur tour)

      const segCount = repeatedSegments.length;
      const climbsDesc = repeatedSegments.map(s => `${Math.round(s.gainM)} m sur une côte répétée ${s.reps} fois`).join(', ');
      const totalReps = repeatedSegments.reduce((sum, s) => sum + s.reps, 0);
      const label = segCount > 1
        ? `Boucle avec répétitions sur ${segCount} côtes`
        : `Boucle avec ${totalReps} répétition${totalReps > 1 ? 's' : ''} de côte`;
      const commentary = segCount > 1
        ? `Le D+ visé (${targetAscentM} m) n'était pas atteignable par une boucle simple dans ce secteur (${naturalAscentM} m naturels) — ${segCount} côtes distinctes sont sollicitées (${climbsDesc}), plutôt qu'une seule côte à répétition, pour varier le terrain tout en s'en rapprochant.`
        : `Le D+ visé (${targetAscentM} m) n'était pas atteignable par une boucle simple dans ce secteur (${naturalAscentM} m naturels) — le passage le plus efficace trouvé (${Math.round(repeatedSegments[0].gainM)} m de dénivelé) est répété ${totalReps} fois pour s'en rapprocher.`;

      options.push({
        type: 'boucle-repetitions',
        label,
        points: repeated.points,
        distanceM: repeated.distanceM,
        ascentM: repeatedAscentM,
        repeatedSegments,
        predictedDurationMin: repeatedDurationMin,
        commentary,
        alternateStart: naturalOption.alternateStart,
      });

      if (repeatedAscentM < targetAscentM - ASCENT_TOLERANCE_M) {
        const budgetLabel = targetDurationMin ? `${Math.round(repeatedDurationMin)} min` : `${(repeated.distanceM / 1000).toFixed(1)} km`;
        const radiusNote = searchRadiusM
          ? (usedAlternateStart ? ` (recherche élargie à ${(searchRadiusM / 1000).toFixed(0)} km déjà essayée)` : ' (recherche élargie essayée, aucun point alentour ne fait mieux)')
          : ' — essayez la recherche élargie pour explorer plus loin';
        const repLabel = segCount > 1 ? `${segCount} côtes, ${totalReps} répétitions au total` : `${totalReps} répétition${totalReps > 1 ? 's' : ''}`;
        warning = `Le secteur ne permet pas d'atteindre ${targetAscentM} m de D+ sans dépasser largement ce qui a été demandé${radiusNote} — meilleure option trouvée : ${repeatedAscentM} m de D+ (${repLabel}, ${budgetLabel}).`;
      }
    }
  }

  // requestedStart (toujours le point litteralement demande, jamais
  // effectiveStart) + searchRadiusM (si la recherche elargie etait active)
  // - transmis pour que l'UI affiche ce point et le rayon sur la carte,
  // sans que l'utilisateur ait a deviner pourquoi le départ affiché n'est
  // pas exactement l'adresse saisie.
  return { options, warning, requestedStart: { lat: start.lat, lon: start.lon }, searchRadiusM: searchRadiusM || null };
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
  getCommunesForDepartment,
  searchStreet,
  getTownHall,
  destinationPoint,
  haversineDistance,
  generateLoop,
  generateLoopWithAlternates,
  bearingToCompassLabel,
  towardCompassPhrase,
  reorientLoopToClosestPoint,
  findSteepestSegment,
  findSteepestSegments,
  findRepeatedZoneIndexRange,
  buildRepeatedWaypoints,
  buildMultiRepeatedWaypoints,
  calibrateAscent,
  predictDurationMin,
  generateRouteOptions,
  buildGpxXml,
  TERRAIN_PROFILES,
  ASCENT_CALIBRATION_FACTOR,
};
