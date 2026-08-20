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
const { getRouteAscent, getElevations } = require('./geoportail_client');

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

// Inverse de destinationPoint : releve initial (bearing, 0-360°) du point a
// vers le point b. Sert a etiqueter la direction d'une boucle alternative
// TELLE QU'ELLE APPARAIT REELLEMENT SUR LA CARTE depuis le point demande par
// l'utilisateur - jamais le bearing de recherche interne (qui peut avoir ete
// calcule depuis un depart alternatif decale de plusieurs km, cf
// generateOptionsAcrossSearchRadius), sous peine d'un libelle du genre
// "vers le sud-est" pour un tracé que la carte montre au sud-ouest (bug
// reel constate : recherche elargie ayant deplace le depart, le bearing de
// recherche restait relatif a ce depart deplace au lieu du point demande).
// Point du tracé le plus eloigne de `from` - repere le plus parlant pour
// dire "cette boucle va vers X" (l'apex de la boucle, a l'oppose du depart),
// utilise par bearingBetween pour l'etiquette de direction (voir plus haut).
function farthestPoint(points, from) {
  let best = points[0], bestDist = -1;
  for (const p of points) {
    const d = haversineDistance(from, p);
    if (d > bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function bearingBetween(a, b) {
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
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
// Tri des directions scannees : par PROXIMITE au D+ vise (targetAscentM)
// quand une cible existe, sinon par D+ decroissant (comportement d'origine,
// utile quand il n'y a rien a viser precisement - cf commentaire de
// generateLoop plus bas). Le tri "toujours le plus de D+" appliquait la
// meme logique meme quand la cible etait DEJA largement depassee par TOUTES
// les directions (terrain naturellement tres vallonne, ex: Beaufort/73270
// en plein massif du Beaufortain) : il choisissait alors systematiquement
// la direction la PLUS pentue au lieu de la plus proche de la cible,
// aggravant l'ecart au lieu de le minimiser (bug reel constate : 900 m de
// D+ vises, propositions entre 1638 et 2417 m). Le tri par proximite couvre
// aussi bien le cas "toutes les directions sont sous la cible" (la plus
// proche par valeur absolue est alors mecaniquement celle qui a le PLUS de
// D+, comportement inchange - la boucle "boostAscentViaRepeats" prend le
// relais ensuite si besoin) que le nouveau cas "toutes au-dessus" (la plus
// proche devient la MOINS pentue), sans code separe pour les deux cas.
async function scanDirections(start, targetDistanceM, profile, targetAscentM) {
  const radius = targetDistanceM / 4;
  const bearingsToTry = Array.from({ length: SEARCH_DIRECTIONS }, (_, k) => (360 / SEARCH_DIRECTIONS) * k);
  const scanResults = await Promise.all(bearingsToTry.map(async (bearing) => {
    try {
      const result = await routeThroughPoints(loopWaypointsForBearing(start, bearing, radius), profile, { trackname: `scan_${bearing}` });
      return { bearing, result };
    } catch (err) {
      // BRouter injoignable (Java/process down) : aucune direction ne
      // reussira jamais, inutile d'attendre les 7 autres pour finalement
      // afficher le message generique "boucle non trouvee" qui masquerait
      // la vraie cause (cf brouter_manager.js, err.brouterUnavailable).
      if (err.brouterUnavailable) throw err;
      return null; // direction non routable (hors reseau, zone isolee...)
    }
  }));
  const candidates = scanResults.filter(Boolean);
  if (targetAscentM) {
    candidates.sort((a, b) => Math.abs(a.result.filteredAscendM - targetAscentM) - Math.abs(b.result.filteredAscendM - targetAscentM));
  } else {
    candidates.sort((a, b) => b.result.filteredAscendM - a.result.filteredAscendM);
  }
  return { candidates, radius };
}

// Affine iterativement le rayon d'une boucle dans une direction fixee pour
// converger vers targetDistanceM (le scan initial, a rayon uniforme pour
// toutes les directions, tombe rarement pile sur la distance visee).
// Si l'utilisateur a vise une DUREE (opts.targetDurationMin + opts.paceMinPerKm
// fournis), converge sur la duree PREDITE (predictDurationMin, deja calculee
// par tranche de pente/pente reelle du trace) plutot que sur la distance -
// correctif d'un ecart systematique constate (ex: 2h48 obtenu pour 2h
// demandees) : la distance visee initiale (server.js) est deduite de la
// duree via l'allure A PLAT uniquement, qui ignore que du D+ ralentit
// fortement une boucle trail reelle. Sans cette convergence sur la duree
// reelle, l'algorithme grossissait la boucle jusqu'a cette distance trop
// genereuse, sans jamais se rendre compte que le terrain la rendait plus
// lente que prevu.
async function refineLoopFromBearing(start, bearing, initialResult, initialRadius, targetDistanceM, profile, maxRefineIterations, opts = {}) {
  const { targetDurationMin, paceMinPerKm, trailLevel } = opts;
  let best = initialResult;
  let bestRadius = initialRadius;
  for (let iter = 0; iter < maxRefineIterations; iter++) {
    const ratio = (targetDurationMin && (paceMinPerKm || trailLevel))
      ? targetDurationMin / predictDurationMin(best.points, paceMinPerKm, trailLevel)
      : targetDistanceM / best.distanceM;
    if (Math.abs(ratio - 1) < 0.15) break;
    // Clamp defensif : une estimation de duree bruitee sur un trace court/peu
    // detaille peut produire un ratio extreme (constate reel sur un aller-retour
    // court, cf generateOutAndBack) - sans plafond, une seule iteration peut
    // faire s'effondrer ou exploser le rayon au lieu de converger doucement.
    bestRadius *= Math.max(0.5, Math.min(2, ratio));
    try {
      best = await routeThroughPoints(loopWaypointsForBearing(start, bearing, bestRadius), profile, { trackname: `refine_${bearing}_${iter}` });
    } catch (err) {
      break; // le rayon affine n'est plus routable, on garde le meilleur resultat connu
    }
  }
  return best;
}

// Recolle un aller (points du depart vers le point de demi-tour) avec son
// retour EXACT (meme trace, sens inverse) - definition d'un aller-retour,
// par opposition a une boucle qui cherche un chemin different au retour.
// N'inclut pas deux fois le point de demi-tour (dernier point de `outPoints`).
function mirrorOutAndBack(outPoints) {
  const back = [...outPoints].slice(0, -1).reverse();
  return [...outPoints, ...back];
}

// Construit un aller-retour le long d'un bearing donne : route reelle
// (BRouter, point a point - pas de forme geometrique synthetique necessaire
// contrairement a une boucle) vers un point de demi-tour, puis retour par
// EXACTEMENT le meme trace inverse. Converge sur la distance/duree de
// l'ALLER-RETOUR complet (meme principe iteratif que refineLoopFromBearing).
// Interet specifique demande par l'utilisateur : reste jouable sur un
// sentier/une cote qui ne forme aucune boucle naturelle (impasse, cul-de-sac,
// reseau clairseme) - la ou une boucle echoue completement, l'aller-retour
// reste possible puisqu'il n'exige jamais de chemin de retour different.
// Plancher de rayon pour le point de demi-tour - sans ca, un ratio de
// convergence extreme (ex: premiere estimation de duree tres eloignee de la
// cible sur un aller court, peu de points donc estimation de pente bruitee)
// peut faire chuter le rayon pres de 0, BRouter accrochant alors start et le
// "demi-tour" au meme noeud du graphe et renvoyant un trace de longueur
// quasi nulle (bug reel constate : aller-retour a 0 m affiche).
const MIN_OUTBACK_RADIUS_M = 300;

async function generateOutAndBack(start, bearing, targetDistanceM, profile, opts = {}) {
  const maxRefineIterations = opts.maxRefineIterations ?? 2;
  const { targetDurationMin, paceMinPerKm, trailLevel } = opts;
  let radius = targetDistanceM / 2;
  let best = null;
  for (let iter = 0; iter <= maxRefineIterations; iter++) {
    const turnaround = destinationPoint(start.lat, start.lon, bearing, radius);
    let outLeg;
    try {
      outLeg = await routeThroughPoints([start, turnaround], profile, { trackname: `outback_${Math.round(bearing)}_${iter}` });
    } catch (err) {
      if (best) break;
      throw err;
    }
    // Garde-fou : un aller quasi nul (rayon effondre, cf MIN_OUTBACK_RADIUS_M)
    // n'est jamais un meilleur candidat que ce qu'on avait deja - on l'ignore
    // plutot que d'ecraser `best` avec un resultat degenere.
    if (outLeg.distanceM < MIN_OUTBACK_RADIUS_M) {
      if (best) break;
      throw new Error('Aller-retour trop court (rayon effondre) - direction non exploitable.');
    }
    // D+ aller-retour approxime a 2x le D+ de l'aller (l'ascension et la
    // descente s'inversent au retour) - approximation suffisante pour
    // converger ici ; le chiffre final vient de Geoportail sur le trace
    // complet (cf generateRouteOptions), pas de cette estimation.
    best = {
      points: mirrorOutAndBack(outLeg.points),
      distanceM: outLeg.distanceM * 2,
      filteredAscendM: outLeg.filteredAscendM * 2,
      outLegPoints: outLeg.points,
    };
    if (iter === maxRefineIterations) break;
    const ratio = (targetDurationMin && (paceMinPerKm || trailLevel))
      ? targetDurationMin / predictDurationMin(best.points, paceMinPerKm, trailLevel)
      : targetDistanceM / best.distanceM;
    if (Math.abs(ratio - 1) < 0.15) break;
    radius = Math.max(radius * Math.max(0.5, Math.min(2, ratio)), MIN_OUTBACK_RADIUS_M);
  }
  return best;
}

// Meme logique de repetition que boostAscentViaRepeats (cf plus bas), mais
// appliquee UNIQUEMENT a l'aller d'un aller-retour, jamais au retour -
// demande utilisateur explicite : "tu vas a un point A, tu la fait x fois,
// tu vas au point B, tu fais la cote x fois, PUIS TU REVIENS... SANS REFAIRE
// LES COTES". Les eventuelles repetitions restent donc uniquement sur le
// trajet aller ; le retour est toujours le trace direct (mirrorOutAndBack de
// l'aller NON boosté), jamais une deuxieme fois les detours de repetition.
async function boostOutAndBackViaRepeats(outAndBack, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel) {
  // Budgets divises par 2 : boostAscentViaRepeats ne voit que l'aller, dont
  // le round-trip final doublera mecaniquement distance/duree/D+ - heuristique
  // interne rapide comme partout ailleurs dans le fichier, le chiffre final
  // affiche vient de Geoportail sur le trace complet.
  const boost = await boostAscentViaRepeats(
    outAndBack.outLegPoints, targetAscentM ? targetAscentM / 2 : null, profile, paceMinPerKm,
    targetDurationMin ? targetDurationMin / 2 : null, targetDistanceM / 2, trailLevel
  );
  if (!boost) return null;
  const directReturn = [...outAndBack.outLegPoints].slice(0, -1).reverse();
  const directReturnDistanceM = outAndBack.distanceM / 2; // aller original (non booste)
  return {
    points: [...boost.repeated.points, ...directReturn],
    distanceM: boost.repeated.distanceM + directReturnDistanceM,
    // D+ retour approxime au D+ naturel de l'aller original (non booste) -
    // la descente aller devient l'ascension retour (meme heuristique
    // "ascension ~ descente" que generateOutAndBack) ; chiffre final corrige
    // par Geoportail sur le trace complet, comme partout ailleurs.
    filteredAscendM: boost.repeated.filteredAscendM + (outAndBack.filteredAscendM / 2),
    repeatedSegments: boost.repeatedSegments,
  };
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
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile, opts.targetAscentM);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }
  const top = candidates[0];
  return refineLoopFromBearing(start, top.bearing, top.result, radius, targetDistanceM, profile, maxRefineIterations, opts);
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
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile, opts.targetAscentM);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }

  const primary = candidates[0];
  const best = await refineLoopFromBearing(start, primary.bearing, primary.result, radius, targetDistanceM, profile, maxRefineIterations, opts);

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
      const refined = await refineLoopFromBearing(start, pick.bearing, pick.result, radius, targetDistanceM, profile, maxRefineIterations, opts);
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

// Repete le/les passage(s) le(s) plus efficace(s) en D+ d'un tracé donne
// jusqu'a s'approcher de targetAscentM (ou du budget distance/duree),
// exactement la logique de repetition deja utilisee pour l'option
// principale - extraite ici pour etre reutilisable sur les boucles
// alternatives aussi (voir generateRouteOptions : avant ce correctif, seule
// l'option principale recevait ce traitement, les alternatives gardaient
// leur D+ "naturel" brut meme tres en dessous de la cible - plainte
// utilisateur reelle, ex. 600 m vises, 154-280 m sur les alternatives).
// Retourne null si aucun segment exploitable n'a ete trouve.
async function boostAscentViaRepeats(basePoints, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel) {
  const segments = findSteepestSegments(basePoints, { maxSegments: MAX_REPEAT_SEGMENTS });
  if (segments.length === 0) return null;

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
      candidate = await routeThroughPoints(buildMultiRepeatedWaypoints(basePoints, segmentReps), profile, { trackname: `repeat_step${step}` });
    } catch (err) {
      repsBySegment[segIdx]--; // cette etape n'est pas routable - revient a l'etat precedent, garde le dernier resultat valide
      break;
    }
    const candidateDurationMin = predictDurationMin(candidate.points, paceMinPerKm, trailLevel);
    const overBudget = overshootBudgetMin ? candidateDurationMin > overshootBudgetMin : candidate.distanceM > overshootBudgetDistM;

    repeated = candidate;
    repeatedDurationMin = candidateDurationMin;
    if (overBudget) break; // on garde ce dernier essai (le meilleur compromis trouve dans le budget) et on s'arrete
    if (calibrateAscent(candidate.filteredAscendM) >= targetAscentM - ASCENT_TOLERANCE_M) break; // objectif atteint
  }
  if (!repeated) return null; // meme la toute premiere etape n'etait pas routable

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

  return { repeated, repeatedDurationMin, repeatedAscentM, repeatedSegments };
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

// Niveau de traileur -> vitesse A PLAT (km/h), appliquee a la "distance
// equivalente plat" (voir equivalentFlatKm juste en dessous) - table
// fournie par l'utilisateur (20/08, corrigee le 20/08 - une 1ere version
// donnait des vitesses bien trop lentes pour representer une allure a
// plat, ex: "Bon traileur" a 4.1-4.8 km/h, alors que ce sont des allures de
// COURSE reelles typiques 6.0-8.0 km/h), UNIQUEMENT pour la prediction de
// duree en trail dans le calcul d'itineraires (rien d'autre dans l'app
// n'est concerne). Remplace le decoupage par tranche de pente
// (GRADIENT_BUCKETS, pace_profile.js, calibre sur les sorties Garmin
// reelles de l'utilisateur) pour ce cas precis : ce decoupage n'a que 4
// tranches, dont "steep" (>8%) qui regroupe INDIFFEREMMENT un faux plat a
// 9% et un mur a 35% avec la MEME allure - bug reel constate : 3657 m D+ /
// 22,8 km estime a 3h19 par ce modele, la ou meme un excellent traileur
// mettrait plus de 3h30, les sorties reelles de l'utilisateur ne couvrant
// jamais un terrain aussi extreme pour calibrer correctement la tranche
// "steep".
const TRAIL_LEVELS = {
  elite:      { label: 'Élite / international', minKmh: 9.0,  maxKmh: 13.0 },
  excellent:  { label: 'Excellent traileur',     minKmh: 8.0,  maxKmh: 10.0 },
  tresbon:    { label: 'Très bon traileur',      minKmh: 7.0,  maxKmh: 9.0 },
  bon:        { label: 'Bon traileur',           minKmh: 6.0,  maxKmh: 8.0 },
  moyenplus:  { label: 'Moyen +',                minKmh: 5.5,  maxKmh: 7.0 },
  moyen:      { label: 'Moyen',                  minKmh: 4.5,  maxKmh: 6.0 },
  moyenmoins: { label: 'Moyen -',                minKmh: 3.5,  maxKmh: 5.0 },
  debutant:   { label: 'Débutant',               minKmh: 2.5,  maxKmh: 4.0 },
};

// "Distance equivalente plat" = distance reelle (km) + D+ (m) / 100 -
// convention trail standard, confirmee par l'utilisateur sur son propre
// exemple : 22,8 km + 3657 m D+ = 22,8 + 36,57 = ~59 km equivalent
// ("l'equivalent d'une course de 59 km").
function equivalentFlatKm(distanceKm, ascentM) {
  return distanceKm + (ascentM || 0) / 100;
}

function trailLevelMidKmh(level) {
  const lvl = TRAIL_LEVELS[level];
  return lvl ? (lvl.minKmh + lvl.maxKmh) / 2 : null;
}

// Rejette une ALTERNATIVE (jamais l'option principale) trop eloignee de la
// cible - la convergence iterative de refineLoopFromBearing/
// generateOutAndBack (2 iterations, ratio de correction plafonne a x0.5/x2
// par iteration) peut echouer a converger correctement dans certaines
// directions precises (reseau de chemins plus circuitueux que prevu par le
// rayon initial, meme point de depart et memes criteres) - bug reel
// constate : une alternative aller-retour a 20,1 km/6h51 alors que les 5
// autres options generees pour la MEME cible (195 min) tournaient toutes
// entre 9,5 et 12,9 km/2h55-3h57 - "exotique" par rapport au reste des
// propositions. Ne s'applique jamais a l'option principale (toujours
// montree, avec ses propres avertissements existants si besoin) - une
// alternative doit rester une vraie variante "similaire ailleurs", pas un
// egarement de la recherche.
const ALT_MIN_CLOSENESS = 0.5;
function altCloseness(distanceM, durationMin, targetDistanceM, targetDurationMin) {
  return (targetDurationMin && durationMin)
    ? 1 - Math.abs(durationMin / targetDurationMin - 1)
    : 1 - Math.abs(distanceM / targetDistanceM - 1);
}

// Duree reelle predite : decoupe le tracé en segments (fusionnes jusqu'a
// >=15m pour lisser le bruit). Deux modes : allure reelle par tranche de
// pente (comportement d'origine, ecart constate de 40%+ sur une sortie
// testee avec une allure unique) si `trailLevel` est absent ; sinon, vitesse
// du niveau de traileur choisi appliquee a la distance equivalente plat du
// trace entier (distance + D+ cumule / 100) - voir TRAIL_LEVELS ci-dessus.
function predictDurationMin(points, paceMinPerKm, trailLevel) {
  const midKmh = trailLevel ? trailLevelMidKmh(trailLevel) : null;
  let totalMin = 0;
  let totalDistM = 0;
  let totalAscentM = 0;
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    let segDist = haversineDistance(points[i], points[j]);
    while (segDist < 15 && j < points.length - 1) { j++; segDist = haversineDistance(points[i], points[j]); }
    const eleDelta = points[j].ele - points[i].ele;
    if (midKmh) {
      totalDistM += segDist;
      if (eleDelta > 0) totalAscentM += eleDelta;
    } else {
      const grade = segDist > 0 ? eleDelta / segDist : 0;
      totalMin += (segDist / 1000) * paceMinPerKm[bucketForGrade(grade)];
    }
    i = j;
  }
  if (midKmh) {
    return (equivalentFlatKm(totalDistM / 1000, totalAscentM) / midKmh) * 60;
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
// Seuil (au-dela du D+ vise) a partir duquel on avertit l'utilisateur que le
// secteur est trop vallonne pour approcher sa cible, plutot que de laisser
// une boucle 50%+ au-dessus du D+ demande sans aucune explication.
const ASCENT_OVERSHOOT_WARNING_RATIO = 0.5;
// Un "segment le plus efficace" avec moins que ça de gain n'est que du bruit
// GPS/altimetrique sur terrain plat, pas une vraie cote exploitable - le
// signaler plutot que de repeter indefiniment un quasi-rien.
const MIN_VIABLE_SEGMENT_GAIN_M = 8;
// Les repetitions ne doivent jamais faire deraper la sortie loin au-dela de
// ce qui a ete demande (bug reel constate : 1h05/300m D+ -> proposition a
// 41 km, faute de plafond sur la duree/distance reelle pendant qu'on ajoute
// des repetitions pour chercher le D+ a tout prix).
const MAX_OVERSHOOT_RATIO = 1.3;

// Quadrillage bearing x rayon utilise par findHillyCandidateCenters pour
// reperer les zones vallonnees dans le rayon de recherche elargie, cote
// Geoportail (rapide) AVANT de lancer le moindre appel BRouter (couteux).
// Remplace l'ancien mecanisme (4 points cardinaux x 3 rayons, aveugle au
// relief reel - ratait systematiquement les secteurs situes entre deux
// points cardinaux, ex: Bois de Verrieres/Bures-sur-Yvette a 190-242° depuis
// Saclay, entre les sondes sud/ouest). 12 directions (tous les 30°, plus fin
// que les 8 de scanDirections) x 4 rayons = 48 centres + le point demande.
const HOTSPOT_BEARINGS = 12;
const HOTSPOT_RADIUS_FRACTIONS = [0.25, 0.5, 0.75, 1.0];
// Rayon du petit "plus" (nord/est/sud/ouest) echantillonne autour de chaque
// centre candidat - le relief local (ecart max-min d'altitude sur ces 5
// points) sert de proxy rapide pour "ce secteur est-il vallonne", sans
// router quoi que ce soit.
const HOTSPOT_SAMPLE_OFFSET_M = 400;
// Nombre de zones reellement testees via BRouter (les mieux notees en
// relief) - chacune coute un scanDirections complet (8 appels), a garder
// raisonnable. Doit rester >= MIN_SEARCH_OPTIONS pour pouvoir en proposer
// autant meme si quelques-unes s'averent non routables.
const HOTSPOT_CANDIDATE_COUNT = 7;
// Nombre minimal de circuits distincts proposes quand une recherche elargie
// est demandee (retour utilisateur : "si l'utilisateur demande de chercher
// dans un rayon, on lui propose au moins 5 circuits possibles, pas juste 1
// ou 2 dans le meme secteur").
const MIN_SEARCH_OPTIONS = 5;
// Ecart geographique minimal entre deux centres retenus, en fraction du
// rayon de recherche (avec un plancher absolu) - sans ca, les meilleurs
// scores de relief se regroupent souvent sur le meme versant (5 centres
// quasi identiques a quelques centaines de metres les uns des autres), pas
// des zones vraiment distinctes a proposer.
const HOTSPOT_MIN_SEPARATION_FRACTION = 0.2;
const HOTSPOT_MIN_SEPARATION_FLOOR_M = 800;

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

// Meme mesure de proximite que distanceCloseness (formule unite-agnostique),
// mais sur la duree REELLE predite (predictDurationMin, deja calculee par
// tranche de pente) quand un objectif de duree est fourni - evite qu'un
// avertissement "distance non atteinte" se declenche a tort une fois que
// refineLoopFromBearing converge correctement sur la duree plutot que sur
// targetDistanceM (qui reste une simple estimation de depart, deduite de
// l'allure a plat, cf server.js) : une boucle plus courte que cette
// estimation peut tres bien coller pile a la duree visee si elle est plus
// vallonnee/lente que prevu, et inversement.
function goalCloseness(loop, targetDistanceM, targetDurationMin, paceMinPerKm, trailLevel) {
  if (targetDurationMin && (paceMinPerKm || trailLevel)) {
    return distanceCloseness(predictDurationMin(loop.points, paceMinPerKm, trailLevel), targetDurationMin);
  }
  return distanceCloseness(loop.distanceM, targetDistanceM);
}

// Repere les zones les plus vallonnees dans searchRadiusM autour de `start`,
// via un quadrillage bearing x rayon echantillonne cote Geoportail - AUCUN
// appel BRouter ici, juste des lectures d'altitude en points isoles
// (getElevations), donc rapide (quelques centaines de points en 1-2 appels
// chunkes) malgre le nombre de centres testes. Renvoie jusqu'a `count`
// centres, toujours en incluant le point demande en premier (l'utilisateur
// doit toujours voir ce qui est possible sans se deplacer), tries par relief
// decroissant sinon, avec un ecart geographique minimal entre eux pour
// couvrir vraiment le rayon plutot que de proposer 5 fois le meme versant.
async function findHillyCandidateCenters(start, searchRadiusM, count) {
  const centers = [{ lat: start.lat, lon: start.lon }];
  for (const frac of HOTSPOT_RADIUS_FRACTIONS) {
    const radiusM = searchRadiusM * frac;
    for (let i = 0; i < HOTSPOT_BEARINGS; i++) {
      centers.push(destinationPoint(start.lat, start.lon, (360 / HOTSPOT_BEARINGS) * i, radiusM));
    }
  }

  const samplePoints = [];
  const sampleStartIdx = [];
  centers.forEach(c => {
    sampleStartIdx.push(samplePoints.length);
    samplePoints.push(c);
    [0, 90, 180, 270].forEach(b => samplePoints.push(destinationPoint(c.lat, c.lon, b, HOTSPOT_SAMPLE_OFFSET_M)));
  });

  const elevations = await getElevations(samplePoints);
  // Geoportail indisponible : repli sur le seul point demande - pas de
  // degradation par rapport a avant l'existence de ce mecanisme, juste pas
  // d'aide au reperage pour cette generation.
  if (!elevations) return [{ lat: start.lat, lon: start.lon }];

  const scored = centers.map((c, idx) => {
    const zs = elevations.slice(sampleStartIdx[idx], sampleStartIdx[idx] + 5).filter(z => z != null);
    const relief = zs.length >= 2 ? Math.max(...zs) - Math.min(...zs) : 0;
    return { ...c, relief };
  });

  const startEntry = scored[0]; // centers[0] est toujours `start`
  const minSepM = Math.max(searchRadiusM * HOTSPOT_MIN_SEPARATION_FRACTION, HOTSPOT_MIN_SEPARATION_FLOOR_M);
  const picked = [startEntry];
  for (const cand of [...scored].sort((a, b) => b.relief - a.relief)) {
    if (picked.length >= count) break;
    if (haversineDistance(cand, start) < 1) continue; // deja inclus (= start)
    if (picked.every(p => haversineDistance(p, cand) >= minSepM)) picked.push(cand);
  }
  return picked;
}

// Meme esprit que generateOptionsAtSinglePoint (voir plus bas), mais pour le
// cas "recherche elargie" : plutot qu'une seule zone (le point demande, ou
// UN point alternatif choisi a l'aveugle), genere un candidat par zone
// vallonnee reperee par findHillyCandidateCenters et retourne les
// MIN_SEARCH_OPTIONS meilleures comme options DISTINCTES - retour
// utilisateur explicite : "il faut que nous trouvions les endroits... qui
// nous donnent le meilleur terrain de jeu", "au moins 5 circuits possibles,
// pas juste 1 ou 2 dans le meme secteur".
// Construit un seul candidat (boucle OU aller-retour) pour un hotspot donne
// - factorise la logique commune (repetition, mesure de proximite a la
// cible) entre les deux formes, chacune ayant sa propre construction de
// trace mais le meme traitement ensuite. Renvoie null si la zone n'est pas
// routable dans cette forme depuis ce centre.
async function buildZoneCandidate(shape, start, hotspot, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel) {
  let result;
  try {
    result = shape === 'outback'
      ? await generateOutAndBack(start, bearingBetween(start, hotspot), targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel })
      : await generateLoop(hotspot, targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel, targetAscentM: terrain === 'trail' ? targetAscentM : null });
  } catch (err) {
    return null; // zone non routable dans cette forme depuis ce centre
  }
  if (!result) return null;

  let ascentM = calibrateAscent(result.filteredAscendM);
  let repeatedSegments = null;
  const needsMoreAscent = terrain === 'trail' && targetAscentM && ascentM < targetAscentM - ASCENT_TOLERANCE_M;
  if (needsMoreAscent) {
    // Repetition acceptee comme filet de securite (demande utilisateur
    // explicite : "si il faut faire 5 fois la cote car ma demande est trop
    // restrictive OK") - mais seulement APRES avoir cherche une zone
    // naturellement riche, jamais comme premier reflexe. En aller-retour,
    // les repetitions ne portent que sur l'aller (cf boostOutAndBackViaRepeats)
    // - le retour reste toujours le trace direct, sans repeter les cotes.
    const boost = shape === 'outback'
      ? await boostOutAndBackViaRepeats(result, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel)
      : await boostAscentViaRepeats(result.points, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel);
    if (boost) {
      const boostedAscentM = calibrateAscent(boost.repeated ? boost.repeated.filteredAscendM : boost.filteredAscendM);
      if (boostedAscentM > ascentM) {
        result = shape === 'outback' ? boost : boost.repeated;
        ascentM = boostedAscentM;
        repeatedSegments = boost.repeatedSegments;
      }
    }
  }

  return {
    shape, hotspot, result, ascentM, repeatedSegments,
    closeness: goalCloseness(result, targetDistanceM, targetDurationMin, paceMinPerKm, trailLevel),
  };
}

// Recherche elargie : repere les zones vallonnees (findHillyCandidateCenters,
// cout Geoportail negligeable) puis construit, pour chacune, une boucle
// et/ou un aller-retour selon routeShape ('loop' | 'outback' | 'both') -
// demande utilisateur explicite ("il faut donc proposer boucle, A/R ou les
// deux") : un aller-retour reste jouable meme sur un sentier qui ne forme
// aucune boucle naturelle (impasse, cul-de-sac), la ou une boucle echoue
// completement - les deux formes sont donc complementaires, pas redondantes.
async function generateOptionsAcrossSearchRadius({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, searchRadiusM, profile, routeShape = 'loop', trailLevel }) {
  const hotspots = await findHillyCandidateCenters(start, searchRadiusM, HOTSPOT_CANDIDATE_COUNT);
  const shapes = routeShape === 'both' ? ['loop', 'outback'] : [routeShape];

  const candidates = [];
  for (const hotspot of hotspots) {
    for (const shape of shapes) {
      const candidate = await buildZoneCandidate(shape, start, hotspot, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel);
      if (candidate) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    throw new Error('Impossible de generer un circuit exploitable dans ce rayon de recherche.');
  }

  // En trail avec D+ vise, la richesse en denivele prime (c'est l'objet meme
  // d'une recherche elargie en trail) ; sinon, la proximite a la
  // distance/duree visee.
  const rankByAscent = terrain === 'trail' && !!targetAscentM;
  candidates.sort((a, b) => rankByAscent ? (b.ascentM - a.ascentM) : (b.closeness - a.closeness));
  const kept = candidates.slice(0, MIN_SEARCH_OPTIONS);

  const options = kept.map((c, i) => {
    const points = c.shape === 'outback' ? c.result.points : reorientLoopToClosestPoint(c.result.points, start);
    const toward = towardCompassPhrase(bearingBetween(start, farthestPoint(points, start)));
    const distFromStartM = haversineDistance(start, c.hotspot);
    const isAtRequestedStart = distFromStartM < 50;
    const shapeLabel = c.shape === 'outback' ? 'Aller-retour' : 'Boucle';
    const label = isAtRequestedStart
      ? `${shapeLabel} au départ demandé`
      : `${shapeLabel} ${i + 1} — ${toward}${c.repeatedSegments ? ' (avec répétitions)' : ''}`;
    let commentary = isAtRequestedStart
      ? `${shapeLabel} construite directement au départ demandé, sans se déplacer.`
      : `Zone plus vallonnée repérée à ${(distFromStartM / 1000).toFixed(1)} km ${toward} du départ, dans le rayon de recherche — à rejoindre avant de courir.`;
    if (c.shape === 'outback') {
      commentary += ` Aller-retour : le retour emprunte exactement le même tracé que l'aller.`;
    }
    if (c.repeatedSegments) {
      commentary += c.shape === 'outback'
        ? ` Le D+ naturel de ce secteur ne suffisait pas seul — une ou plusieurs côtes sont répétées à l'aller uniquement, le retour reste direct.`
        : ` Le D+ naturel de ce secteur ne suffisait pas seul, complété par répétition d'une côte.`;
    }
    return {
      type: c.shape === 'outback' ? 'aller-retour' : (c.repeatedSegments ? 'boucle-repetitions' : 'boucle-naturelle'),
      shape: c.shape,
      label,
      points,
      distanceM: c.result.distanceM,
      ascentM: c.ascentM,
      repeatedSegments: c.repeatedSegments,
      predictedDurationMin: predictDurationMin(points, paceMinPerKm, trailLevel),
      commentary,
      alternateStart: isAtRequestedStart ? null : { lat: c.hotspot.lat, lon: c.hotspot.lon, distanceFromRequestedM: distFromStartM },
    };
  });

  let warning = null;
  const best = kept[0];
  if (terrain === 'trail' && targetAscentM && best.ascentM < targetAscentM - ASCENT_TOLERANCE_M) {
    warning = `Le rayon de recherche exploré (${(searchRadiusM / 1000).toFixed(0)} km, ${hotspots.length} zones testées) ne permet pas d'atteindre ${targetAscentM} m de D+ sans dépasser largement ce qui a été demandé — meilleure option trouvée : ${best.ascentM} m de D+.`;
  } else if (candidates.length < MIN_SEARCH_OPTIONS) {
    warning = `Seules ${candidates.length} option(s) routable(s) trouvée(s) dans ce rayon (sur ${hotspots.length * shapes.length} tentées) — essayez un rayon plus large pour plus de choix.`;
  }

  return { options, warning };
}

// Recherche a un seul point de depart (pas de recherche elargie), boucles
// uniquement : boucle naturelle + jusqu'a 2 alternatives (cf
// generateLoopWithAlternates), avec repetition de cote si le D+ naturel ne
// suffit pas. Utilise pour la forme 'loop' - voir generateOptionsAtSinglePoint
// pour le dispatcher qui gere aussi 'outback'/'both', et
// generateOptionsAcrossSearchRadius pour la recherche elargie.
async function buildLoopOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel }) {
  let { best: natural, alternates } = await generateLoopWithAlternates(start, targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel, targetAscentM: terrain === 'trail' ? targetAscentM : null });
  let naturalAscentM = calibrateAscent(natural.filteredAscendM);
  const initialNeedsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalAscentM < targetAscentM - ASCENT_TOLERANCE_M;

  // Reoriente chaque boucle (naturelle + alternatives) pour qu'elle
  // commence/finisse au point de son propre tracé le plus proche du point
  // REELLEMENT demande (toujours `start`, meme si la recherche elargie a
  // ancre la boucle ailleurs pour trouver du D+) - cf reorientLoopToClosestPoint.
  natural = { ...natural, points: reorientLoopToClosestPoint(natural.points, start) };
  alternates = alternates.map(alt => ({ ...alt, result: { ...alt.result, points: reorientLoopToClosestPoint(alt.result.points, start) } }));

  const naturalOption = {
    type: 'boucle-naturelle',
    shape: 'loop',
    label: 'Boucle sans répétition',
    points: natural.points,
    distanceM: natural.distanceM,
    ascentM: naturalAscentM,
    predictedDurationMin: predictDurationMin(natural.points, paceMinPerKm, trailLevel),
    commentary: terrain === 'trail'
      ? `Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour du départ pour trouver le meilleur dénivelé naturel du secteur, sans répétition de côte.`
      : `Boucle construite en explorant ${SEARCH_DIRECTIONS} directions autour du départ pour coller au mieux à la distance/durée visée.`,
    alternateStart: null,
  };

  const options = [naturalOption];

  // Boucles alternatives : mêmes critères (distance/durée), mais dans une
  // direction suffisamment différente pour être un vrai autre choix plutôt
  // qu'une variante quasi identique - cf generateLoopWithAlternates.
  // IMPORTANT (correctif) : avant, seule l'option principale recevait le
  // traitement "répétition de côte" pour atteindre le D+ visé - les
  // alternatives gardaient leur D+ naturel brut, souvent très en dessous
  // de la cible (plainte utilisateur réelle : 600 m visés, 154-280 m sur
  // les alternatives, "comme si l'appli disait j'ai au moins 1 critère donc
  // ça va"). Chaque alternative reçoit maintenant le même boostAscentViaRepeats
  // que l'option principale si besoin - séquentiel (pas en parallèle avec les
  // autres alternatives) pour ne pas saturer BRouter de requêtes concurrentes.
  for (let i = 0; i < alternates.length; i++) {
    const alt = alternates[i];
    // Direction telle qu'affichee sur la carte depuis le point REELLEMENT
    // demande (start), jamais le bearing de recherche interne (alt.bearing)
    // - voir le commentaire de bearingBetween plus haut.
    const toward = towardCompassPhrase(bearingBetween(start, farthestPoint(alt.result.points, start)));
    let altPoints = alt.result.points;
    let altDistanceM = alt.result.distanceM;
    let altAscentM = calibrateAscent(alt.result.filteredAscendM);
    let altDurationMin = predictDurationMin(altPoints, paceMinPerKm, trailLevel);
    let altCommentary = `Autre tracé possible, orienté ${toward} plutôt que vers le secteur retenu pour l'option principale — pour varier l'itinéraire tout en visant les mêmes critères.`;
    let altRepeatedSegments = null;

    const altNeedsMoreAscent = terrain === 'trail' && targetAscentM && altAscentM < targetAscentM - ASCENT_TOLERANCE_M;
    if (altNeedsMoreAscent) {
      const boost = await boostAscentViaRepeats(altPoints, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel);
      if (boost && boost.repeatedAscentM > altAscentM) {
        const stillShort = boost.repeatedAscentM < targetAscentM - ASCENT_TOLERANCE_M;
        altPoints = boost.repeated.points;
        altDistanceM = boost.repeated.distanceM;
        altAscentM = boost.repeatedAscentM;
        altDurationMin = boost.repeatedDurationMin;
        altRepeatedSegments = boost.repeatedSegments;
        altCommentary = `Autre tracé possible, orienté ${toward} — le D+ naturel de ce secteur (${calibrateAscent(alt.result.filteredAscendM)} m) était en dessous de la cible, complété par répétition d'une côte pour s'en rapprocher.`
          + (stillShort ? ` Reste en dessous du D+ visé (${targetAscentM} m) sans dépasser largement la distance/durée demandée.` : '');
      } else {
        // Aucune côte exploitable trouvée pour booster cette alternative -
        // le dire plutôt que de proposer silencieusement un D+ trop faible
        // sans que l'utilisateur comprenne pourquoi cette option diffère
        // tant de la cible qu'il a demandée.
        altCommentary = `Autre tracé possible, orienté ${toward} — D+ naturel de ce secteur : ${altAscentM} m, en dessous de la cible (${targetAscentM} m) et aucune côte exploitable trouvée à répéter ici.`;
      }
    }

    // Alternative trop eloignee de la cible (echec de convergence propre a
    // cette direction, cf ALT_MIN_CLOSENESS) - ecartee plutot que proposee
    // comme si elle etait une variante valable au meme titre que les autres.
    if (altCloseness(altDistanceM, altDurationMin, targetDistanceM, targetDurationMin) < ALT_MIN_CLOSENESS) continue;

    options.push({
      type: 'boucle-alternative',
      shape: 'loop',
      label: `Boucle alternative ${i + 1} — ${toward}`,
      points: altPoints,
      distanceM: altDistanceM,
      ascentM: altAscentM,
      repeatedSegments: altRepeatedSegments,
      predictedDurationMin: altDurationMin,
      commentary: altCommentary,
      alternateStart: naturalOption.alternateStart,
    });
  }

  let warning = null;

  // Pas de mecanisme de "repetition" equivalent pour la distance
  // (contrairement au D+ en trail, cf bloc plus bas) : si le secteur reste
  // en-dehors de la tolerance sur la distance/duree, c'est le signal final -
  // averti ici, independamment du bloc de repetitions ci-dessous qui reste
  // specifique au D+ trail. Ne se declenche pas si c'est le D+ qui pilotait
  // la recherche (deja couvert par son propre warning plus bas le cas echeant).
  const finalDistanceShortfall = !initialNeedsMoreAscent
    && goalCloseness(natural, targetDistanceM, targetDurationMin, paceMinPerKm, trailLevel) < (1 - DISTANCE_SHORTFALL_TOLERANCE);
  if (finalDistanceShortfall) {
    const gotLabel = targetDurationMin ? `${Math.round(naturalOption.predictedDurationMin)} min` : `${(natural.distanceM / 1000).toFixed(1)} km`;
    const targetLabel = targetDurationMin ? `${targetDurationMin} min` : `${(targetDistanceM / 1000).toFixed(1)} km`;
    warning = `Le secteur ne permet pas d'atteindre ${targetLabel} sans trop s'écarter — essayez la recherche élargie pour explorer plus loin — meilleure option trouvée : ${gotLabel}.`;
  }

  const needsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M;

  if (needsMoreAscent) {
    // Escalade fine, UN SEUL segment incremente d'UNE seule repetition a
    // chaque etape (tournicoti round-robin entre les segments trouves) -
    // teste apres CHAQUE etape et s'arrete des que le D+ vise est atteint OU
    // que le budget (duree/distance) est depasse - voir boostAscentViaRepeats.
    const boost = await boostAscentViaRepeats(natural.points, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel);
    if (!boost) {
      warning = `Aucune côte exploitable trouvée pour compléter le D+ dans ce secteur — seule la boucle naturelle (${naturalOption.ascentM} m) est proposée.`;
    } else {
      const { repeated, repeatedDurationMin, repeatedAscentM, repeatedSegments } = boost;
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
        shape: 'loop',
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
        const repLabel = segCount > 1 ? `${segCount} côtes, ${totalReps} répétitions au total` : `${totalReps} répétition${totalReps > 1 ? 's' : ''}`;
        warning = `Le secteur ne permet pas d'atteindre ${targetAscentM} m de D+ sans dépasser largement ce qui a été demandé — essayez la recherche élargie pour explorer plus loin — meilleure option trouvée : ${repeatedAscentM} m de D+ (${repLabel}, ${budgetLabel}).`;
      }
    }
  } else if (terrain === 'trail' && targetAscentM && naturalOption.ascentM > targetAscentM * (1 + ASCENT_OVERSHOOT_WARNING_RATIO)) {
    // Symetrique du warning "pas assez de D+" ci-dessus, pour le cas inverse
    // (terrain deja tres vallonne, ex: Beaufort/73270) : meme apres le tri
    // par proximite de scanDirections (voir son commentaire), la direction
    // la PLUS PROCHE de la cible peut rester tres au-dessus si litteralement
    // aucune direction locale n'approche le D+ demande - avant ce correctif,
    // ce cas restait silencieux (seul le manque de D+ etait signale), alors
    // que l'ecart est tout aussi genant pour l'utilisateur (retour reel :
    // 900 m vises, 1638 a 2417 m proposes sans aucun avertissement).
    warning = `Le secteur est plus vallonné que le D+ visé (${targetAscentM} m) : impossible de descendre en dessous de ${naturalOption.ascentM} m sans trop s'écarter de la distance/durée demandée — essayez une distance/durée plus longue, ou un D+ visé plus élevé.`;
  }

  return { options, warning };
}

// Meme scan de directions que buildLoopOptionsAtSinglePoint (reutilise le
// classement par D+ naturel deja calcule par scanDirections - une direction
// vallonnee pour une boucle l'est generalement aussi pour un aller-retour,
// inutile de rescanner), mais construit un aller-retour le long de chaque
// bearing retenu plutot qu'une boucle. Utilise pour la forme 'outback' - cf
// generateOptionsAtSinglePoint (dispatcher) et generateOutAndBack.
async function buildOutAndBackOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel }) {
  const { candidates } = await scanDirections(start, targetDistanceM, profile, terrain === 'trail' ? targetAscentM : null);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer un aller-retour exploitable autour de ce depart.');
  }

  const primary = candidates[0];
  const chosenBearings = [primary.bearing];
  const altPicks = [];
  for (const c of candidates.slice(1)) {
    if (altPicks.length >= MAX_ALT_DIRECTIONS) break;
    if (chosenBearings.every(b => bearingDiff(b, c.bearing) >= ALT_DIRECTION_MIN_BEARING_DIFF)) {
      altPicks.push(c);
      chosenBearings.push(c.bearing);
    }
  }
  const bearings = [primary.bearing, ...altPicks.map(p => p.bearing)];

  const options = [];
  let warning = null;
  for (let i = 0; i < bearings.length; i++) {
    const bearing = bearings[i];
    let result;
    try {
      result = await generateOutAndBack(start, bearing, targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel });
    } catch (err) {
      continue; // direction non routable en aller-retour, on garde les autres
    }
    let ascentM = calibrateAscent(result.filteredAscendM);
    let repeatedSegments = null;
    const needsMoreAscent = terrain === 'trail' && targetAscentM && ascentM < targetAscentM - ASCENT_TOLERANCE_M;
    if (needsMoreAscent) {
      const boost = await boostOutAndBackViaRepeats(result, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel);
      if (boost) {
        const boostedAscentM = calibrateAscent(boost.filteredAscendM);
        if (boostedAscentM > ascentM) {
          result = boost;
          ascentM = boostedAscentM;
          repeatedSegments = boost.repeatedSegments;
        }
      }
      if (!repeatedSegments && i === 0) {
        warning = `Aucune côte exploitable trouvée pour compléter le D+ en aller-retour dans ce secteur — seul le tracé naturel (${ascentM} m) est proposé.`;
      }
    }

    const outbackDurationMin = predictDurationMin(result.points, paceMinPerKm, trailLevel);
    // Alternative (jamais l'option principale, i===0) trop eloignee de la
    // cible - echec de convergence propre a cette direction, cf
    // ALT_MIN_CLOSENESS.
    if (i > 0 && altCloseness(result.distanceM, outbackDurationMin, targetDistanceM, targetDurationMin) < ALT_MIN_CLOSENESS) continue;

    const toward = towardCompassPhrase(bearing);
    options.push({
      type: repeatedSegments ? 'aller-retour-repetitions' : 'aller-retour',
      shape: 'outback',
      label: i === 0
        ? `Aller-retour ${toward}${repeatedSegments ? ' (avec répétitions)' : ''}`
        : `Aller-retour alternatif ${i} — ${toward}${repeatedSegments ? ' (avec répétitions)' : ''}`,
      points: result.points,
      distanceM: result.distanceM,
      ascentM,
      repeatedSegments,
      predictedDurationMin: outbackDurationMin,
      commentary: `Aller-retour ${toward} : le retour emprunte exactement le même tracé que l'aller.`
        + (repeatedSegments ? ` Le D+ naturel ne suffisait pas seul — une ou plusieurs côtes sont répétées à l'aller uniquement, le retour reste direct.` : ''),
      alternateStart: null,
    });
  }

  if (options.length === 0) {
    throw new Error('Impossible de generer un aller-retour exploitable autour de ce depart.');
  }

  return { options, warning };
}

// Dispatcher pour la recherche a un seul point de depart (pas de recherche
// elargie) : construit des boucles et/ou des aller-retours selon routeShape
// ('loop' | 'outback' | 'both') - demande utilisateur explicite ("il faut
// donc proposer boucle, A/R ou les deux"). Voir generateOptionsAcrossSearchRadius
// pour le cas "recherche elargie" (plusieurs zones distinctes).
async function generateOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, routeShape = 'loop', trailLevel }) {
  const options = [];
  let warning = null;

  if (routeShape === 'loop' || routeShape === 'both') {
    const loopResult = await buildLoopOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel });
    options.push(...loopResult.options);
    warning = loopResult.warning;
  }

  if (routeShape === 'outback' || routeShape === 'both') {
    try {
      const outbackResult = await buildOutAndBackOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel });
      options.push(...outbackResult.options);
      if (!warning) warning = outbackResult.warning;
    } catch (err) {
      // Si 'both' et que seule la forme boucle a reussi, ne pas faire
      // echouer toute la generation pour autant - l'utilisateur a deja au
      // moins une option valable.
      if (routeShape === 'outback' || options.length === 0) throw err;
    }
  }

  return { options, warning };
}

// Point d'entree public : verifie l'infrastructure, delegue a
// generateOptionsAcrossSearchRadius (searchRadiusM fourni - plusieurs zones
// distinctes explorees via Geoportail) ou generateOptionsAtSinglePoint
// (recherche simple au point demande), puis applique la correction finale de
// D+ via l'API Altimetrie IGN a toutes les options obtenues, quel que soit
// le chemin emprunte.
async function generateRouteOptions({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain = 'trail', paceMinPerKm, searchRadiusM, routeShape = 'loop', trailLevel }) {
  // Verifie l'infrastructure avant toute tentative de routage : sans ca, les
  // echecs de generateLoop (qui retente avec un rayon reduit, pensant a un
  // probleme de terrain) masqueraient un message clair du type "BRouter non
  // configure" derriere un message generique trompeur ("secteur non routable").
  if (!isBrouterConfigured()) {
    throw new Error('BRouter n\'est pas configuré sur ce serveur (fichiers manquants dans le dossier brouter/) — voir le setup dans le README avant de générer un itinéraire.');
  }

  const profile = TERRAIN_PROFILES[terrain] || TERRAIN_PROFILES.trail;
  const { options, warning } = searchRadiusM
    ? await generateOptionsAcrossSearchRadius({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, searchRadiusM, profile, routeShape, trailLevel })
    : await generateOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, routeShape, trailLevel });

  // Correction finale du D+ affiche via l'API Altimetrie IGN (donnees RGE
  // ALTI, precision LIDAR) - remplace le D+ estime par BRouter (MNT
  // grossier + facteur correctif approximatif, source des ecarts constates,
  // ex: 500 m vises, 19 m obtenus reellement). Volontairement fait ICI, une
  // seule fois par option finale, plutot qu'a chaque etape de la
  // recherche/l'affinage plus haut : ces etapes internes pilotent leurs
  // propres decisions sur l'estimation BRouter rapide - la refaire a chaque
  // etape multiplierait les appels IGN par dizaines, inutile et hors du
  // quota de 5 req/s. Le texte des messages d'avertissement ci-dessus reste
  // donc base sur l'estimation BRouter (generalement proche, cf test
  // empirique dans geoportail_client.js) - seul le chiffre de D+ affiche sur
  // chaque carte d'option est corrige. Repli silencieux sur l'estimation
  // BRouter si l'appel echoue (zone hors couverture RGE ALTI, service
  // indisponible...) - fonctionnalite d'appoint, jamais bloquante.
  for (const opt of options) {
    const measured = await getRouteAscent(opt.points);
    if (measured) opt.ascentM = measured.ascentM;
  }

  // requestedStart (toujours le point litteralement demande) + searchRadiusM
  // (si la recherche elargie etait active) - transmis pour que l'UI affiche
  // ce point et le rayon sur la carte, sans que l'utilisateur ait a deviner
  // pourquoi le départ affiché n'est pas exactement l'adresse saisie.
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
  bearingBetween,
  farthestPoint,
  haversineDistance,
  generateLoop,
  generateLoopWithAlternates,
  generateOutAndBack,
  mirrorOutAndBack,
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
  TRAIL_LEVELS,
  equivalentFlatKm,
  trailLevelMidKmh,
  findHillyCandidateCenters,
  generateRouteOptions,
  buildGpxXml,
  TERRAIN_PROFILES,
  ASCENT_CALIBRATION_FACTOR,
};
