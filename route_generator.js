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
const { queryNaturalAreas, isPointInAnyPolygon } = require('./overpass_client');

// Le profil 'trekking' (mode "route", utilise jusqu'en aout 2026) est un
// profil velo generique qui exclut bien les autoroutes mais ne compare les
// routes qu'a un hint binaire "isbike" (present/absent) avec un malus fixe
// (+2, via `avoid_unsafe`) - retour utilisateur reel : sur un test a Saclay,
// une departementale a ete choisie alors qu'une piste cyclable separee
// existait ~200 m plus loin. Remplace par 'fastbike-lowtraffic', qui integre
// un vrai modele de trafic (`estimated_traffic_class`, base sur le type de
// voie/nombre de voies/vitesse max, cf fastbike-lowtraffic.brf) : le malus
// de circulation est PROPORTIONNEL au trafic reel estime plutot qu'un forfait
// binaire, plafonne a 0.3 des qu'une piste cyclable existe sur le troncon
// (`hascycleway`) - une departementale rurale peu frequentee reste viable
// (comportement voulu par l'utilisateur : "en campagne c'est moins genant"),
// une departementale urbaine a fort trafic est fortement penalisee meme sans
// alternative directe. `consider_traffic=true` est deja la valeur par defaut
// du profil, explicite ici pour la documentation.
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
  'fastbike-lowtraffic': { consider_traffic: 'true' },
};
// Variantes de style pour le mode trail (retour utilisateur, aout 2026),
// en plus du niveau de traileur (vitesse) et de la rentabilite verticale
// (quelle cote repeter) deja geres ailleurs - celles-ci jouent sur QUEL
// TYPE DE VOIE BRouter privilegie DANS la direction choisie, via les memes
// deux leviers que le reglage manuel plus haut (Offroad_factor/path_preference,
// cf commentaires hiking-mountain.brf) :
// - "roulant" : favorise les chemins/pistes larges deja bien traces, evite
//   les detours vers un sentier etroit quand une alternative plus large
//   existe a proximite (Offroad_factor/path_preference bas, plus proches du
//   comportement par defaut de BRouter que la valeur "mixte").
// - "mixte" : comportement d'origine de l'app (valeurs historiques de
//   PROFILE_PARAMS['hiking-mountain'] avant l'ajout de ces variantes).
// - "technique" : accentue encore la preference pour les sentiers etroits/
//   hors-piste - va au-dela de la fourchette "Recommended -0.5 - +1.0" du
//   .brf pour l'Offroad_factor, choix volontairement plus marque assume
//   pour ce style.
const TRAIL_STYLE_PARAMS = {
  roulant: { Offroad_factor: '0.3', path_preference: '3' },
  mixte: { Offroad_factor: '1.0', path_preference: '10' },
  technique: { Offroad_factor: '2.0', path_preference: '20' },
};
const DEFAULT_TRAIL_STYLE = 'mixte';
function routeThroughPoints(waypoints, profile, opts = {}) {
  const profileParams = profile === 'hiking-mountain'
    ? (TRAIL_STYLE_PARAMS[opts.trailStyle] || TRAIL_STYLE_PARAMS[DEFAULT_TRAIL_STYLE])
    : (PROFILE_PARAMS[profile] || null);
  return routeThroughPointsRaw(waypoints, profile, { ...opts, profileParams });
}

// Zones interdites (cf `nogos` dans brouter_client.js) posees UNIQUEMENT sur
// l'approche finale du troncon (les nearM derniers metres avant le point
// d'arrivee, hors les tout derniers edgeBufferM pour ne pas enfermer le
// point d'arrivee lui-meme) - PAS sur tout le troncon. 1ere version
// (interdiction sur tout le troncon avant->nouveau point) trop large :
// sur une boucle etroite, ca bloquait aussi le chemin legitime de
// continuation vers "apres" (qui passe geometriquement pres du reste du 1er
// troncon sans jamais le reutiliser), forcant BRouter a partir chercher un
// chemin sans rapport ailleurs (retour utilisateur, capture d'ecran : un
// gros crochet par des sentiers de foret sans lien, gardant en plus
// l'ancien troncon). Le vrai symptome de l'aller-retour (repartir du point
// deplace en repassant par EXACTEMENT le dernier bout de chemin emprunte
// pour l'atteindre) ne concerne que cette approche finale - la bloquer
// suffit a forcer une sortie par un autre cote du reseau local, sans
// perturber le reste du reseau plus loin.
function buildNogoZonesNearEnd(points, { nearM = 60, stepM = 15, radius = 12, edgeBufferM = 15 } = {}) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineDistance(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  const end = total - edgeBufferM;
  const start = Math.max(0, end - nearM);
  if (end <= start) return [];
  const zones = [];
  let idx = 0;
  for (let at = start; at <= end; at += stepM) {
    while (idx < cum.length - 1 && cum[idx + 1] < at) idx++;
    const p = points[idx];
    zones.push({ lat: p.lat, lon: p.lon, radius });
  }
  return zones;
}

// Recalcule un troncon "avant -> nouveau point -> apres" en 2 requetes
// BRouter successives, avec des zones interdites posees sur l'approche
// finale du 1er troncon pour le 2e (retour utilisateur, aout 2026 :
// deplacer un point produisait systematiquement un aller-retour). Un seul
// appel BRouter avec les 3 points ordonnes (avant, ancien comportement)
// cherche independamment le chemin le plus court pour chaque jambe : si le
// nouveau point se trouve sur une petite boucle de sentiers, le plus court
// chemin pour rejoindre "apres" depuis "nouveau" est presque toujours de
// reprendre le meme sentier en sens inverse, meme quand un autre chemin
// existe reellement sur le terrain (BRouter ne "sait" pas qu'on
// prefererait un vrai contournement). En interdisant explicitement
// l'approche finale du 1er troncon au 2e (cf buildNogoZonesNearEnd), on
// force BRouter a sortir par un autre cote - donc a reformer une boucle
// plutot que de rebrousser chemin, quand un tel chemin existe. Repli sur le
// 2e troncon SANS zones interdites si aucune alternative n'est routable
// (vraie impasse) - mieux vaut l'ancien comportement (aller-retour) qu'un
// echec.
function pathLengthM(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineDistance(points[i - 1], points[i]);
  return d;
}
async function routeThroughViaPoint(before, via, after, profile, opts = {}) {
  const leg1 = await routeThroughPoints([before, via], profile, opts);
  const nogos = buildNogoZonesNearEnd(leg1.points);
  let leg2 = null;
  if (nogos.length) {
    try {
      const candidate = await routeThroughPoints([via, after], profile, { ...opts, nogos });
      // Garde-fou : si l'alternative sans aller-retour est un enorme detour
      // par rapport a la distance directe via->apres, ce n'est plus une
      // "vraie boucle" raisonnable mais un chemin sans rapport passant par
      // des sentiers eloignes (retour utilisateur, capture d'ecran) - mieux
      // vaut le court aller-retour original dans ce cas.
      const directM = haversineDistance(via, after);
      if (pathLengthM(candidate.points) <= Math.max(150, directM * 4)) leg2 = candidate;
    } catch (err) { /* pas d'alternative routable, repli ci-dessous */ }
  }
  if (!leg2) leg2 = await routeThroughPoints([via, after], profile, opts);
  return { points: [...leg1.points, ...leg2.points.slice(1)] };
}

// Sous-estimation observee du D+ BRouter (filtre) par rapport a ce
// qu'affiche une montre reelle. Base sur 2 comparaisons (session recherche
// aout 2026) - a recalculer avec plus d'echantillons quand disponibles.
const ASCENT_CALIBRATION_FACTOR = 1.26;

// Convergence de refineLoopFromBearing/generateOutAndBack vers la
// distance/duree visee : nombre d'iterations d'affinage du rayon, et seuil
// d'ecart en-dessous duquel on considere que c'est "assez proche" pour
// s'arreter. Resserre suite a une etude externe (aout 2026) sur les ecarts
// de duree constates par l'utilisateur (2h45 obtenues pour 1h55 visees) :
// l'ancien seuil de 15% sur seulement 2 iterations laissait trop de marge a
// la boucle de base AVANT meme que les repetitions de cote ne s'y ajoutent -
// une iteration de plus et un seuil plus strict rapprochent davantage la
// boucle de base de la cible en amont, ce qui laisse aussi un budget de
// duree plus fiable pour les repetitions eventuelles (cf DURATION_HARD_CEILING_RATIO).
const DEFAULT_REFINE_ITERATIONS = 3;
const REFINE_CONVERGENCE_TOLERANCE = 0.10;

// Budget de "reparation" reserve aux repetitions de cote (cf etude externe
// aout 2026, section 6.1/6.3 : generer une boucle de base volontairement
// plus courte que la cible plutot que de faire grossir toute la boucle
// jusqu'a la cible AVANT de verifier si le D+ est atteint). Sans ca, la
// boucle de base consomme tout le budget de duree en convergeant vers la
// cible complete - si le D+ naturel est insuffisant, il ne reste alors
// presque plus de marge pour les repetitions (cf DURATION_HARD_CEILING_RATIO),
// qui ne peuvent combler qu'une petite fraction du D+ manquant (constate en
// test reel : Saclay/115 min/490 m D+, une seule repetition possible avant
// le plafond). Applique uniquement quand le scan initial (avant tout
// affinage de rayon, cf scanDirections) suggere deja que la densite de D+
// naturelle de la meilleure direction est nettement en dessous de la
// densite visee - sinon (terrain deja assez vallonne pour la distance
// visee), le comportement d'origine (converger sur la cible complete) reste
// inchange, pour ne pas sous-viser inutilement une boucle qui n'aura jamais
// besoin de repetition.
const BASE_LOOP_REPAIR_FRACTION = 0.85;
const DENSITY_SHORTFALL_MARGIN = 0.85;

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
async function scanDirections(start, targetDistanceM, profile, targetAscentM, trailStyle) {
  const radius = targetDistanceM / 4;
  const bearingsToTry = Array.from({ length: SEARCH_DIRECTIONS }, (_, k) => (360 / SEARCH_DIRECTIONS) * k);
  const scanResults = await Promise.all(bearingsToTry.map(async (bearing) => {
    try {
      const result = await routeThroughPoints(loopWaypointsForBearing(start, bearing, radius), profile, { trackname: `scan_${bearing}`, trailStyle });
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
  const { targetDurationMin, paceMinPerKm, trailLevel, trailStyle } = opts;
  let best = initialResult;
  let bestRadius = initialRadius;
  for (let iter = 0; iter < maxRefineIterations; iter++) {
    const ratio = (targetDurationMin && (paceMinPerKm || trailLevel))
      ? targetDurationMin / predictDurationMin(best.points, paceMinPerKm, trailLevel)
      : targetDistanceM / best.distanceM;
    if (Math.abs(ratio - 1) < REFINE_CONVERGENCE_TOLERANCE) break;
    // Clamp defensif : une estimation de duree bruitee sur un trace court/peu
    // detaille peut produire un ratio extreme (constate reel sur un aller-retour
    // court, cf generateOutAndBack) - sans plafond, une seule iteration peut
    // faire s'effondrer ou exploser le rayon au lieu de converger doucement.
    bestRadius *= Math.max(0.5, Math.min(2, ratio));
    try {
      best = await routeThroughPoints(loopWaypointsForBearing(start, bearing, bestRadius), profile, { trackname: `refine_${bearing}_${iter}`, trailStyle });
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
  const maxRefineIterations = opts.maxRefineIterations ?? DEFAULT_REFINE_ITERATIONS;
  const { targetDurationMin, paceMinPerKm, trailLevel, trailStyle } = opts;
  let radius = targetDistanceM / 2;
  let best = null;
  for (let iter = 0; iter <= maxRefineIterations; iter++) {
    const turnaround = destinationPoint(start.lat, start.lon, bearing, radius);
    let outLeg;
    try {
      outLeg = await routeThroughPoints([start, turnaround], profile, { trackname: `outback_${Math.round(bearing)}_${iter}`, trailStyle });
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
    if (Math.abs(ratio - 1) < REFINE_CONVERGENCE_TOLERANCE) break;
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
async function boostOutAndBackViaRepeats(outAndBack, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle) {
  // Budgets divises par 2 : boostAscentViaRepeats ne voit que l'aller, dont
  // le round-trip final doublera mecaniquement distance/duree/D+ - heuristique
  // interne rapide comme partout ailleurs dans le fichier, le chiffre final
  // affiche vient de Geoportail sur le trace complet.
  const boost = await boostAscentViaRepeats(
    outAndBack.outLegPoints, targetAscentM ? targetAscentM / 2 : null, profile, paceMinPerKm,
    targetDurationMin ? targetDurationMin / 2 : null, targetDistanceM / 2, trailLevel, trailStyle
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
    // Index du dernier point de l'aller (avec repetitions) dans `points` -
    // cf outLegPointCount plus bas (buildOutAndBackOptionsAtSinglePoint) :
    // permet a l'UI de distinguer visuellement le retour (meme trace que
    // l'aller, par definition d'un aller-retour) des repetitions de cote
    // (portion de l'aller reellement reparcourue plusieurs fois pour le D+) -
    // retour utilisateur explicite : ces deux notions etaient visuellement
    // confondues (les deux en orange), alors qu'elles n'ont pas le meme sens.
    outLegPointCount: boost.repeated.points.length,
  };
}

// Compare la densite de D+ (m par metre de distance) du candidat de scan
// initial (avant tout affinage de rayon) a la densite visee - si elle est
// nettement en dessous, reduit la cible distance/duree transmise a
// refineLoopFromBearing/generateOutAndBack pour reserver un budget de
// repetitions (cf BASE_LOOP_REPAIR_FRACTION). Ne s'applique qu'en trail avec
// un D+ vise ; sans ca (route, ou trail sans D+ vise), rien a reparer.
function reserveRepairBudget(scanResult, targetDistanceM, targetDurationMin, targetAscentM) {
  if (!targetAscentM || !scanResult.distanceM) return { targetDistanceM, targetDurationMin };
  const scanDensity = calibrateAscent(scanResult.filteredAscendM) / scanResult.distanceM;
  const targetDensity = targetAscentM / targetDistanceM;
  if (scanDensity >= targetDensity * DENSITY_SHORTFALL_MARGIN) return { targetDistanceM, targetDurationMin };
  return {
    targetDistanceM: targetDistanceM * BASE_LOOP_REPAIR_FRACTION,
    targetDurationMin: targetDurationMin ? targetDurationMin * BASE_LOOP_REPAIR_FRACTION : null,
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
  const maxRefineIterations = opts.maxRefineIterations ?? DEFAULT_REFINE_ITERATIONS;
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile, opts.targetAscentM, opts.trailStyle);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }
  const top = candidates[0];
  const budget = reserveRepairBudget(top.result, targetDistanceM, opts.targetDurationMin, opts.targetAscentM);
  return refineLoopFromBearing(start, top.bearing, top.result, radius, budget.targetDistanceM, profile, maxRefineIterations, { ...opts, targetDurationMin: budget.targetDurationMin });
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
  const maxRefineIterations = opts.maxRefineIterations ?? DEFAULT_REFINE_ITERATIONS;
  const { candidates, radius } = await scanDirections(start, targetDistanceM, profile, opts.targetAscentM, opts.trailStyle);
  if (candidates.length === 0) {
    throw new Error('Impossible de generer une boucle exploitable autour de ce depart.');
  }

  const primary = candidates[0];
  const primaryBudget = reserveRepairBudget(primary.result, targetDistanceM, opts.targetDurationMin, opts.targetAscentM);
  const best = await refineLoopFromBearing(start, primary.bearing, primary.result, radius, primaryBudget.targetDistanceM, profile, maxRefineIterations, { ...opts, targetDurationMin: primaryBudget.targetDurationMin });

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
      const pickBudget = reserveRepairBudget(pick.result, targetDistanceM, opts.targetDurationMin, opts.targetAscentM);
      const refined = await refineLoopFromBearing(start, pick.bearing, pick.result, radius, pickBudget.targetDistanceM, profile, maxRefineIterations, { ...opts, targetDurationMin: pickBudget.targetDurationMin });
      alternates.push({ bearing: pick.bearing, result: refined });
    } catch (err) { /* direction devenue non routable en affinant - on garde les autres */ }
  }

  return { best, bestBearing: primary.bearing, alternates };
}

// Cout (minutes) d'un aller-retour sur CHAQUE segment consecutif du trace,
// cumule en deux tableaux prefix-sum : cumUp[k] = cout pour parcourir
// points[0..k] dans le sens naturel (montee = allure de montee), cumDown[k]
// = cout pour parcourir CES MEMES segments mais en sens inverse (pente
// negee - c'est la descente qu'on ferait en repartant de k vers 0). Le cout
// aller-retour d'un segment [i,j] est alors (cumUp[j]-cumUp[i]) [montee] +
// (cumDown[j]-cumDown[i]) [descente du retour] - lookup O(1) au lieu de
// recalculer predictDurationMin (couteux) a chaque fenetre candidate du
// double-boucle de findSteepestSegments. Uniquement pour le mode
// paceMinPerKm (tranches de pente) - le mode trailLevel a une formule directe
// plus simple (equivalentFlatKm), geree a part dans findSteepestSegments.
function buildRoundTripCostCumulative(points, paceMinPerKm) {
  const n = points.length;
  const cumUp = new Array(n).fill(0);
  const cumDown = new Array(n).fill(0);
  for (let k = 1; k < n; k++) {
    const segDist = haversineDistance(points[k - 1], points[k]);
    const eleDelta = points[k].ele - points[k - 1].ele;
    const grade = segDist > 0 ? eleDelta / segDist : 0;
    cumUp[k] = cumUp[k - 1] + (segDist / 1000) * paceMinPerKm[bucketForGrade(grade)];
    cumDown[k] = cumDown[k - 1] + (segDist / 1000) * paceMinPerKm[bucketForGrade(-grade)];
  }
  return { cumUp, cumDown };
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
// Classement par "rentabilite verticale" (m D+ par minute de repetition,
// etude externe aout 2026, section 6.4) quand paceMinPerKm/trailLevel sont
// fournis, plutot que par gain brut - une cote longue mais peu raide peut
// avoir plus de gain absolu qu'une cote courte et raide, mais couter bien
// plus de temps a repeter pour ce meme gain ; preferer la plus efficace,
// pas la plus haute. Repli sur le gain brut (comportement d'origine) si
// aucune info d'allure n'est fournie. Le seuil MIN_VIABLE_SEGMENT_GAIN_M est
// verifie DES la comparaison (pas seulement sur le resultat final) : sans ca,
// un micro-rebond de 2m sur 10m afficherait une "rentabilite" enorme et
// gagnerait a tort face a une vraie cote.
function findSteepestSegments(points, { minDistM = 150, maxDistM = 1000, maxSegments = 3, paceMinPerKm = null, trailLevel = null } = {}) {
  const useEfficiency = !!(paceMinPerKm || trailLevel);
  const cum = (useEfficiency && !trailLevel) ? buildRoundTripCostCumulative(points, paceMinPerKm) : null;
  const midKmh = trailLevel ? trailLevelMidKmh(trailLevel) : null;

  const excluded = new Array(points.length).fill(false);
  const found = [];
  for (let s = 0; s < maxSegments; s++) {
    let best = { gainM: 0, efficiency: -Infinity };
    for (let i = 0; i < points.length; i++) {
      if (excluded[i]) continue;
      let dist = 0;
      for (let j = i + 1; j < points.length && dist < maxDistM; j++) {
        if (excluded[j]) break; // ne traverse pas une zone deja retenue
        dist += haversineDistance(points[j - 1], points[j]);
        const gain = points[j].ele - points[i].ele;
        if (dist < minDistM || gain < MIN_VIABLE_SEGMENT_GAIN_M) continue;

        let efficiency = gain; // repli : gain brut si pas d'info d'allure
        if (useEfficiency) {
          const costMin = midKmh
            ? (equivalentFlatKm((2 * dist) / 1000, gain) / midKmh) * 60
            : (cum.cumUp[j] - cum.cumUp[i]) + (cum.cumDown[j] - cum.cumDown[i]);
          efficiency = costMin > 0 ? gain / costMin : 0;
        }
        if (efficiency > best.efficiency) {
          best = { gainM: gain, distM: dist, startIdx: i, endIdx: j, from: points[i], to: points[j], efficiency };
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
async function boostAscentViaRepeats(basePoints, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle) {
  const segments = findSteepestSegments(basePoints, { maxSegments: MAX_REPEAT_SEGMENTS, paceMinPerKm, trailLevel });
  if (segments.length === 0) return null;

  const overshootBudgetMin = targetDurationMin ? targetDurationMin * MAX_DURATION_OVERSHOOT_RATIO : null;
  const overshootBudgetDistM = !targetDurationMin ? targetDistanceM * MAX_DISTANCE_OVERSHOOT_RATIO : null;

  let repeated = null;
  let repeatedDurationMin = 0;
  const repsBySegment = new Array(segments.length).fill(0);
  for (let step = 0; step < MAX_REPEAT_STEPS; step++) {
    const segIdx = step % segments.length;
    repsBySegment[segIdx]++;
    const segmentReps = segments.map((segment, i) => ({ segment, reps: repsBySegment[i] }));
    let candidate;
    try {
      candidate = await routeThroughPoints(buildMultiRepeatedWaypoints(basePoints, segmentReps), profile, { trackname: `repeat_step${step}`, trailStyle });
    } catch (err) {
      repsBySegment[segIdx]--; // cette etape n'est pas routable - revient a l'etat precedent, garde le dernier resultat valide
      break;
    }
    const candidateDurationMin = predictDurationMin(candidate.points, paceMinPerKm, trailLevel);
    const overBudget = overshootBudgetMin ? candidateDurationMin > overshootBudgetMin : candidate.distanceM > overshootBudgetDistM;
    // Budget depasse : cette etape est rejetee (pas gardee) - la duree est une
    // contrainte quasi dure (cf etude externe aout 2026), donc on revient au
    // dernier candidat encore dans le budget plutot que d'accepter celui qui
    // vient tout juste de le franchir. Avant ce correctif, `repeated` etait
    // affecte AVANT ce test et donc le candidat hors-budget restait quand
    // meme le resultat final (bug reel constate : +30% de budget nominal,
    // mais des sorties observees a +43% de la duree visee).
    if (overBudget) { repsBySegment[segIdx]--; break; }

    repeated = candidate;
    repeatedDurationMin = candidateDurationMin;
    if (calibrateAscent(candidate.filteredAscendM) >= targetAscentM - ASCENT_TOLERANCE_M) break; // objectif atteint
  }
  if (!repeated) return null; // meme la toute premiere etape n'etait pas routable (ou deja hors budget)

  const repeatedAscentM = calibrateAscent(repeated.filteredAscendM);
  // Tous les segments (reps=0 inclus) pour reconstruire EXACTEMENT la meme
  // sequence de waypoints que celle ayant produit `repeated` (cf
  // buildMultiRepeatedWaypoints, appele avec repsBySegment tel quel a
  // l'etape gagnante) - necessaire pour que le reperage des zones
  // (computeRepeatedZones) parte de la bonne geometrie ; filtre seulement a
  // la toute fin (reps>0) pour l'affichage.
  const allSegmentReps = segments.map((segment, i) => ({ segment, reps: repsBySegment[i] }));
  const repeatedSegments = computeRepeatedZones(basePoints, allSegmentReps, repeated.points)
    .filter(s => s.reps > 0); // exclut les segments jamais sollicites (objectif deja atteint avant leur tour)

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

// Meme construction que buildMultiRepeatedWaypoints, mais garde aussi trace,
// pour chaque segment, de l'INDEX DANS LA SEQUENCE DE WAYPOINTS du dernier
// waypoint avant ses repetitions (le point naturel, une fois) et du dernier
// waypoint de sa derniere repetition (le sommet apres la derniere ascension)
// - ces deux reperes, une fois traduits en index du trace de sortie (cf
// matchWaypointsForward), delimitent exactement la "zone repetee" a colorer.
function buildMultiRepeatedWaypointsWithZones(basePoints, segmentReps) {
  const sorted = [...segmentReps].sort((a, b) => a.segment.endIdx - b.segment.endIdx);
  const waypoints = [];
  const zoneWaypointRanges = [];
  let cursor = 0;
  for (const { segment, reps } of sorted) {
    waypoints.push(...basePoints.slice(cursor, segment.endIdx + 1));
    const startWpIdx = waypoints.length - 1;
    for (let k = 0; k < reps; k++) waypoints.push(segment.from, segment.to);
    const endWpIdx = waypoints.length - 1;
    zoneWaypointRanges.push({ segment, reps, startWpIdx, endWpIdx });
    cursor = segment.endIdx + 1;
  }
  waypoints.push(...basePoints.slice(cursor));
  return { waypoints: waypoints.map(p => ({ lat: p.lat, lon: p.lon })), zoneWaypointRanges };
}

// Associe chaque waypoint (dans l'ORDRE) au point du trace de sortie le plus
// proche, en ne cherchant JAMAIS en arriere du dernier point deja associe
// (correspondance strictement croissante) et en bornant la recherche a une
// fenetre de distance parcourue (windowM) a partir de ce curseur. Remplace
// une premiere version qui recherchait `segment.to` par simple proximite
// spatiale n'importe ou dans le trace - fragile des qu'une boucle repasse a
// moins de quelques dizaines de metres du sommet d'une cote ailleurs dans le
// parcours (croisement de deux branches proches), ce qui faussait
// completement la zone detectee (bug reel constate, y compris apres un
// premier correctif par regroupement spatial : toujours des cas en defaut).
// Ici, comme l'ORDRE des waypoints est connu avec certitude (c'est nous qui
// l'avons construit), une correspondance strictement sequentielle ne peut
// plus se tromper de repetition, seulement au pire de quelques metres sur le
// point exact.
function matchWaypointsForward(points, waypoints, windowM = 5000) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineDistance(points[i - 1], points[i]));
  let cursor = 0;
  const matchedIdx = [];
  for (const wp of waypoints) {
    let bestIdx = cursor, bestDist = Infinity;
    for (let i = cursor; i < points.length && (cum[i] - cum[cursor]) <= windowM; i++) {
      const d = haversineDistance(points[i], wp);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    matchedIdx.push(bestIdx);
    cursor = bestIdx;
  }
  return matchedIdx;
}

// Point d'entree : calcule, pour chaque segment repete, la plage d'indices
// [startIdx,endIdx] dans le trace final `finalPoints` correspondant a sa
// zone repetee - cote UI, sert a colorer cette portion differemment sur la
// carte (cf routes.js renderRouteMap). `segmentReps` doit contenir TOUS les
// segments consideres (reps=0 inclus) pour reconstruire exactement la meme
// sequence de waypoints que celle ayant produit `finalPoints`.
function computeRepeatedZones(basePoints, segmentReps, finalPoints) {
  const { waypoints, zoneWaypointRanges } = buildMultiRepeatedWaypointsWithZones(basePoints, segmentReps);
  const matched = matchWaypointsForward(finalPoints, waypoints);
  return zoneWaypointRanges.map(({ segment, reps, startWpIdx, endWpIdx }) => ({
    fromLat: segment.from.lat, fromLon: segment.from.lon, toLat: segment.to.lat, toLon: segment.to.lon, gainM: segment.gainM,
    reps,
    startIdx: matched[startWpIdx] ?? null,
    endIdx: matched[endWpIdx] ?? null,
  }));
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

// true si le trace a DEJA atteint le plafond dur de duree (cf
// DURATION_HARD_CEILING_RATIO) - dans ce cas, ajouter une repetition pour
// combler le D+ ne peut que degrader encore l'ecart de duree, deja hors
// tolerance ; mieux vaut s'arreter et l'annoncer que d'aggraver l'ecart pour
// grappiller un peu de D+ (cf etude externe aout 2026, principe "la duree
// doit etre plus fortement protegee que le D+"). Ne s'applique qu'en mode
// duree - sans cible de duree, seul le budget de distance des repetitions
// s'applique (voir MAX_DISTANCE_OVERSHOOT_RATIO).
function isAtDurationCeiling(points, targetDurationMin, paceMinPerKm, trailLevel) {
  if (!targetDurationMin) return false;
  return predictDurationMin(points, paceMinPerKm, trailLevel) >= targetDurationMin * DURATION_HARD_CEILING_RATIO;
}

// Etiquette de correspondance duree affichee sur chaque option finale (cf
// etude externe aout 2026, section 12 "ce que l'interface peut afficher") -
// rend visible l'ecart reel a la cible plutot que de laisser l'utilisateur
// comparer lui-meme des chiffres bruts. Seuils inspires des "zones de
// tolerance" de l'etude (zone ideale ~±5%, maximum conseille ~+7%), elargis
// legerement pour Bonne car la granularite d'une repetition entiere (tout un
// aller-retour de cote) ne permet pas toujours de converger aussi finement.
const DURATION_MATCH_EXCELLENT_RATIO = 0.05;
const DURATION_MATCH_GOOD_RATIO = 0.10;
function durationMatchInfo(predictedMin, targetMin) {
  const deltaMin = Math.round(predictedMin - targetMin);
  const relDelta = Math.abs(predictedMin - targetMin) / targetMin;
  const label = relDelta <= DURATION_MATCH_EXCELLENT_RATIO ? 'Excellente'
    : relDelta <= DURATION_MATCH_GOOD_RATIO ? 'Bonne'
    : 'Compromis';
  return { targetMin, deltaMin, label };
}

// Meme principe pour le D+ - seuils repris directement des "zones de
// tolerance" de l'etude externe (section 4 : zone excellente ~±6%, zone
// acceptable ~±13%). Retour utilisateur explicite : une option a l'heure
// mais loin du D+ vise (ex: -100 m sur 490 m) ne doit pas etre etiquetee
// "Excellente" pour autant - la correspondance globale (matchLabel,
// generateRouteOptions) prend donc la PIRE des deux correspondances plutot
// que de ne regarder que la duree.
const ASCENT_MATCH_EXCELLENT_RATIO = 0.06;
const ASCENT_MATCH_GOOD_RATIO = 0.13;
function ascentMatchInfo(ascentM, targetAscentM) {
  const deltaM = Math.round(ascentM - targetAscentM);
  const relDelta = Math.abs(ascentM - targetAscentM) / targetAscentM;
  const label = relDelta <= ASCENT_MATCH_EXCELLENT_RATIO ? 'Excellente'
    : relDelta <= ASCENT_MATCH_GOOD_RATIO ? 'Bonne'
    : 'Compromis';
  return { targetM: targetAscentM, deltaM, label };
}

// Meme principe pour la distance, quand c'est ELLE le critere choisi par
// l'utilisateur (mode "distance", pas de duree visee) - retour utilisateur
// explicite : en mode route/distance, aucune correspondance n'etait jamais
// affichee (durationMatch ne se declenchait qu'avec une cible de duree).
// Memes seuils que la duree (cf DURATION_MATCH_*), meme logique.
const DISTANCE_MATCH_EXCELLENT_RATIO = 0.05;
const DISTANCE_MATCH_GOOD_RATIO = 0.10;
function distanceMatchInfoOption(distanceM, targetDistanceM) {
  const deltaM = Math.round(distanceM - targetDistanceM);
  const relDelta = Math.abs(distanceM - targetDistanceM) / targetDistanceM;
  const label = relDelta <= DISTANCE_MATCH_EXCELLENT_RATIO ? 'Excellente'
    : relDelta <= DISTANCE_MATCH_GOOD_RATIO ? 'Bonne'
    : 'Compromis';
  return { targetM: targetDistanceM, deltaM, label };
}

const MATCH_LABEL_RANK = { Excellente: 0, Bonne: 1, Compromis: 2 };
function worseMatchLabel(a, b) {
  if (!a) return b;
  if (!b) return a;
  return MATCH_LABEL_RANK[a] >= MATCH_LABEL_RANK[b] ? a : b;
}

// Classement d'un parcours par type de voie (% route / chemin / piste
// cyclable) - retour utilisateur explicite (aout 2026) : "sommes-nous en
// mesure de dire X% route, X% chemin, X% piste cyclable ?". Rendu possible
// par `format=geojson` de BRouter (cf brouter_client.js), qui expose les
// tags OSM bruts de chaque segment reellement emprunte (WayTags) - jamais
// exploite jusqu'ici, seule la geometrie et le D+ etaient lus.
// Un amenagement cyclable (piste separee OU simple bande/voie partagee sur
// une route) prime sur le type de voie porteur - c'est la distinction qui
// interesse l'utilisateur ("les routes pour voitures sont le dernier
// recours"), peu importe que ce soit techniquement une route secondaire
// avec bande cyclable ou une vraie piste separee.
// Route "a fort trafic" separee de "calme/residentielle" - regroupement
// initial trop grossier (bug reel constate : 89% "route" affiche sur un
// test reel, alors qu'une inspection des WayTags a montre que 72 points de
// pourcentage etaient en fait highway=residential/unclassified/service -
// des rues locales calmes par nature en France, PAS le meme risque qu'une
// route secondaire/primaire a fort trafic. BRouter lui-meme distingue les
// deux (cf trackerpenalty/estimated_traffic_class dans fastbike-lowtraffic.brf,
// qui ne s'applique qu'a partir de tertiary) - notre classification les
// confondait, donnant une image bien plus alarmante que la realite.
const SURFACE_CATEGORY_CYCLE = 'Piste cyclable / voie mixte';
const SURFACE_CATEGORY_ROAD_BUSY = 'Route à fort trafic';
const SURFACE_CATEGORY_ROAD_CALM = 'Route calme / résidentielle';
const SURFACE_CATEGORY_PATH = 'Chemin / sentier';
const SURFACE_CATEGORY_OTHER = 'Autre';
const SURFACE_ROAD_BUSY_HIGHWAYS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
const SURFACE_ROAD_CALM_HIGHWAYS = new Set(['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);
const SURFACE_PATH_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian', 'steps']);
function classifyWayTags(wayTags) {
  if (!wayTags) return SURFACE_CATEGORY_OTHER;
  const hwMatch = /highway=([a-z_]+)/.exec(wayTags);
  const highway = hwMatch ? hwMatch[1] : null;
  const hasCycleInfra = /cycleway(:[a-z]+)?=(track|lane|shared_lane|opposite_track|opposite_lane)/.test(wayTags)
    || /bicycle=designated/.test(wayTags)
    || highway === 'cycleway';
  if (hasCycleInfra) return SURFACE_CATEGORY_CYCLE;
  if (highway && SURFACE_ROAD_BUSY_HIGHWAYS.has(highway)) return SURFACE_CATEGORY_ROAD_BUSY;
  if (highway && SURFACE_ROAD_CALM_HIGHWAYS.has(highway)) return SURFACE_CATEGORY_ROAD_CALM;
  if (highway && SURFACE_PATH_HIGHWAYS.has(highway)) return SURFACE_CATEGORY_PATH;
  return SURFACE_CATEGORY_OTHER;
}

// Sous-echantillonne les points du trace final en un nombre raisonnable de
// waypoints pour la requete de classification (cf computeSurfaceBreakdown) -
// renvoyer les 400-600 points du trace tels quels ferait router BRouter
// via_point par via_point sur autant de segments quasi nuls, inutilement
// lent. Un trace reel n'a generalement pas d'alternative aussi courte entre
// deux points espaces de quelques centaines de metres sur le MEME reseau de
// chemins, donc cet echantillonnage reproduit en pratique le meme itineraire
// - risque residuel de leger ecart geometrique assume, cette classification
// restant une INFORMATION, jamais un critere de decision de l'algorithme.
const SURFACE_BREAKDOWN_MAX_WAYPOINTS = 60;
function subsampleForClassification(points, maxWaypoints) {
  if (points.length <= maxWaypoints) return points.map(p => ({ lat: p.lat, lon: p.lon }));
  const step = (points.length - 1) / (maxWaypoints - 1);
  const out = [];
  for (let i = 0; i < maxWaypoints; i++) out.push(points[Math.round(i * step)]);
  return out.map(p => ({ lat: p.lat, lon: p.lon }));
}

// Repli silencieux sur null en cas d'echec (reseau, BRouter temporairement
// indisponible...) - fonctionnalite d'appoint, jamais bloquante pour
// l'affichage du reste de l'option (meme philosophie que getRouteAscent).
async function computeSurfaceBreakdown(points, profile, trailStyle) {
  try {
    const waypoints = subsampleForClassification(points, SURFACE_BREAKDOWN_MAX_WAYPOINTS);
    if (waypoints.length < 2) return null;
    const result = await routeThroughPoints(waypoints, profile, { trackname: 'surface_classify', trailStyle });
    if (!result.wayMessages || result.wayMessages.length === 0) return null;
    const totals = {};
    let totalDist = 0;
    for (const msg of result.wayMessages) {
      const cat = classifyWayTags(msg.wayTags);
      totals[cat] = (totals[cat] || 0) + msg.distM;
      totalDist += msg.distM;
    }
    if (totalDist === 0) return null;
    return Object.entries(totals)
      .map(([label, distanceM]) => ({ label, distanceM: Math.round(distanceM), pct: Math.round((distanceM / totalDist) * 100) }))
      .sort((a, b) => b.distanceM - a.distanceM);
  } catch (err) {
    return null;
  }
}

const TERRAIN_PROFILES = { trail: 'hiking-mountain', route: 'fastbike-lowtraffic' };
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
// des repetitions pour chercher le D+ a tout prix). Distinction duree/distance
// ajoutee suite a une etude externe (aout 2026, note "Calculateur d'itineraire
// trail") : en entrainement, la duree est une contrainte QUASI DURE (une
// seance a 1h55 ne doit pas devenir 2h45 pour quelques dizaines de m de D+
// en plus) alors que la distance (mode "distance" only, sans duree visee)
// reste plus souple - deux budgets separes plutot qu'un seul commun.
const MAX_DURATION_OVERSHOOT_RATIO = 1.12;
const MAX_DISTANCE_OVERSHOOT_RATIO = 1.3;
// Plafond dur au-dela duquel on renonce a ajouter des repetitions meme si le
// D+ vise n'est pas atteint - ajouter une repetition a une boucle DEJA a ce
// niveau ne peut que degrader encore l'ecart de duree (cf etude externe,
// principe "durée protégée avant la beauté de la boucle").
const DURATION_HARD_CEILING_RATIO = 1.12;

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

// Repere les zones les plus vallonnees ET boisees dans searchRadiusM autour
// de `start`, via un quadrillage bearing x rayon echantillonne cote
// Geoportail (relief) et Overpass (bois/foret/parc naturel) - AUCUN appel
// BRouter ici, donc rapide malgre le nombre de centres testes. Renvoie
// jusqu'a `count` centres, toujours en incluant le point demande en premier
// (l'utilisateur doit toujours voir ce qui est possible sans se deplacer),
// tries par presence en zone naturelle PUIS relief decroissant, avec un
// ecart geographique minimal entre eux pour couvrir vraiment le rayon
// plutot que de proposer 5 fois le meme versant.
// Le critere "boise" prime sur le relief (retour utilisateur explicite,
// aout 2026) : une recherche elargie en trail pouvait renvoyer une boucle
// avec de grosses portions en zone urbaine simplement parce que le relief y
// etait suffisant (denivele urbain — parkings, ponts, echangeurs — compte
// autant qu'un vrai relief naturel pour ce quadrillage), sans que la zone
// soit un vrai terrain de trail. Cherche d'abord un endroit propice
// (bois/foret proche du relief detecte), pas seulement "le plus de D+".
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

  // Independants (Geoportail vs Overpass) - lances en parallele pour ne pas
  // doubler la latence de ce reperage.
  const [elevations, naturalAreas] = await Promise.all([
    getElevations(samplePoints),
    queryNaturalAreas(start.lat, start.lon, searchRadiusM),
  ]);
  // Geoportail indisponible : repli sur le seul point demande - pas de
  // degradation par rapport a avant l'existence de ce mecanisme, juste pas
  // d'aide au reperage pour cette generation.
  if (!elevations) return [{ lat: start.lat, lon: start.lon }];

  const scored = centers.map((c, idx) => {
    const zs = elevations.slice(sampleStartIdx[idx], sampleStartIdx[idx] + 5).filter(z => z != null);
    const relief = zs.length >= 2 ? Math.max(...zs) - Math.min(...zs) : 0;
    // Overpass indisponible (naturalAreas === null) : inForest reste false
    // partout, le tri retombe alors sur le relief seul (comportement
    // d'origine) - jamais bloquant.
    const inForest = naturalAreas ? isPointInAnyPolygon(c, naturalAreas) : false;
    return { ...c, relief, inForest };
  });

  const startEntry = scored[0]; // centers[0] est toujours `start`
  const minSepM = Math.max(searchRadiusM * HOTSPOT_MIN_SEPARATION_FRACTION, HOTSPOT_MIN_SEPARATION_FLOOR_M);
  const picked = [startEntry];
  const ranked = [...scored].sort((a, b) => (b.inForest - a.inForest) || (b.relief - a.relief));
  for (const cand of ranked) {
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
async function buildZoneCandidate(shape, start, hotspot, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle) {
  let result;
  try {
    result = shape === 'outback'
      ? await generateOutAndBack(start, bearingBetween(start, hotspot), targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel, trailStyle })
      : await generateLoop(hotspot, targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel, trailStyle, targetAscentM: terrain === 'trail' ? targetAscentM : null });
  } catch (err) {
    return null; // zone non routable dans cette forme depuis ce centre
  }
  if (!result) return null;

  let ascentM = calibrateAscent(result.filteredAscendM);
  let repeatedSegments = null;
  const needsMoreAscent = terrain === 'trail' && targetAscentM && ascentM < targetAscentM - ASCENT_TOLERANCE_M
    && !isAtDurationCeiling(result.points, targetDurationMin, paceMinPerKm, trailLevel);
  if (needsMoreAscent) {
    // Repetition acceptee comme filet de securite (demande utilisateur
    // explicite : "si il faut faire 5 fois la cote car ma demande est trop
    // restrictive OK") - mais seulement APRES avoir cherche une zone
    // naturellement riche, jamais comme premier reflexe. En aller-retour,
    // les repetitions ne portent que sur l'aller (cf boostOutAndBackViaRepeats)
    // - le retour reste toujours le trace direct, sans repeter les cotes.
    const boost = shape === 'outback'
      ? await boostOutAndBackViaRepeats(result, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle)
      : await boostAscentViaRepeats(result.points, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle);
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
async function generateOptionsAcrossSearchRadius({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, searchRadiusM, profile, routeShape = 'loop', trailLevel, trailStyle }) {
  const hotspots = await findHillyCandidateCenters(start, searchRadiusM, HOTSPOT_CANDIDATE_COUNT);
  const shapes = routeShape === 'both' ? ['loop', 'outback'] : [routeShape];

  const candidates = [];
  for (const hotspot of hotspots) {
    for (const shape of shapes) {
      const candidate = await buildZoneCandidate(shape, start, hotspot, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle);
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
    const outLegPointCount = c.shape === 'outback'
      ? (c.result.outLegPointCount ?? (c.result.outLegPoints ? c.result.outLegPoints.length : null))
      : null;
    return {
      type: c.shape === 'outback' ? 'aller-retour' : (c.repeatedSegments ? 'boucle-repetitions' : 'boucle-naturelle'),
      shape: c.shape,
      label,
      points,
      outLegPointCount,
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
async function buildLoopOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle }) {
  let { best: natural, alternates } = await generateLoopWithAlternates(start, targetDistanceM, profile, { targetDurationMin, paceMinPerKm, trailLevel, trailStyle, targetAscentM: terrain === 'trail' ? targetAscentM : null });
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

    const altNeedsMoreAscent = terrain === 'trail' && targetAscentM && altAscentM < targetAscentM - ASCENT_TOLERANCE_M
      && !isAtDurationCeiling(altPoints, targetDurationMin, paceMinPerKm, trailLevel);
    if (altNeedsMoreAscent) {
      const boost = await boostAscentViaRepeats(altPoints, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle);
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

  const naturalAtDurationCeiling = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M
    && isAtDurationCeiling(natural.points, targetDurationMin, paceMinPerKm, trailLevel);
  const needsMoreAscent = terrain === 'trail' && targetAscentM
    && naturalOption.ascentM < targetAscentM - ASCENT_TOLERANCE_M
    && !naturalAtDurationCeiling;

  if (needsMoreAscent) {
    // Escalade fine, UN SEUL segment incremente d'UNE seule repetition a
    // chaque etape (tournicoti round-robin entre les segments trouves) -
    // teste apres CHAQUE etape et s'arrete des que le D+ vise est atteint OU
    // que le budget (duree/distance) est depasse - voir boostAscentViaRepeats.
    const boost = await boostAscentViaRepeats(natural.points, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle);
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
  } else if (naturalAtDurationCeiling) {
    // La boucle de base a deja atteint le plafond dur de duree (cf
    // DURATION_HARD_CEILING_RATIO) sans avoir atteint le D+ vise - ajouter une
    // repetition ne ferait qu'aggraver l'ecart de duree pour grappiller du D+,
    // contraire au principe "duree quasi dure" (etude externe aout 2026).
    warning = `La durée visée (${targetDurationMin} min) est déjà atteinte sans avoir atteint le D+ visé (${targetAscentM} m — ${naturalOption.ascentM} m obtenus) — pas de répétition ajoutée pour ne pas dépasser davantage la durée demandée. Essayez une durée plus longue, ou un D+ visé moins élevé.`;
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
async function buildOutAndBackOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle }) {
  const { candidates } = await scanDirections(start, targetDistanceM, profile, terrain === 'trail' ? targetAscentM : null, trailStyle);
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
  const bearingCandidates = [primary, ...altPicks];

  const options = [];
  let warning = null;
  for (let i = 0; i < bearingCandidates.length; i++) {
    const { bearing, result: scanResult } = bearingCandidates[i];
    let result;
    try {
      // Reserve un budget de repetitions si le scan initial de cette
      // direction suggere deja un terrain trop plat pour le D+ vise - meme
      // logique que pour les boucles, cf reserveRepairBudget.
      const budget = reserveRepairBudget(scanResult, targetDistanceM, targetDurationMin, terrain === 'trail' ? targetAscentM : null);
      result = await generateOutAndBack(start, bearing, budget.targetDistanceM, profile, { targetDurationMin: budget.targetDurationMin, paceMinPerKm, trailLevel, trailStyle });
    } catch (err) {
      continue; // direction non routable en aller-retour, on garde les autres
    }
    let ascentM = calibrateAscent(result.filteredAscendM);
    let repeatedSegments = null;
    const needsMoreAscent = terrain === 'trail' && targetAscentM && ascentM < targetAscentM - ASCENT_TOLERANCE_M
      && !isAtDurationCeiling(result.points, targetDurationMin, paceMinPerKm, trailLevel);
    if (needsMoreAscent) {
      const boost = await boostOutAndBackViaRepeats(result, targetAscentM, profile, paceMinPerKm, targetDurationMin, targetDistanceM, trailLevel, trailStyle);
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
    // outLegPointCount : `result` est soit le retour brut de generateOutAndBack
    // (outLegPoints expose), soit celui de boostOutAndBackViaRepeats
    // (outLegPointCount deja calcule) - cf leurs commentaires respectifs.
    // Permet a l'UI de distinguer le retour (meme trace que l'aller) des
    // repetitions de cote.
    const outLegPointCount = result.outLegPointCount ?? (result.outLegPoints ? result.outLegPoints.length : null);
    options.push({
      type: repeatedSegments ? 'aller-retour-repetitions' : 'aller-retour',
      shape: 'outback',
      label: i === 0
        ? `Aller-retour ${toward}${repeatedSegments ? ' (avec répétitions)' : ''}`
        : `Aller-retour alternatif ${i} — ${toward}${repeatedSegments ? ' (avec répétitions)' : ''}`,
      points: result.points,
      outLegPointCount,
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
async function generateOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, routeShape = 'loop', trailLevel, trailStyle }) {
  const options = [];
  let warning = null;

  if (routeShape === 'loop' || routeShape === 'both') {
    const loopResult = await buildLoopOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle });
    options.push(...loopResult.options);
    warning = loopResult.warning;
  }

  if (routeShape === 'outback' || routeShape === 'both') {
    try {
      const outbackResult = await buildOutAndBackOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, trailLevel, trailStyle });
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
async function generateRouteOptions({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain = 'trail', paceMinPerKm, searchRadiusM, routeShape = 'loop', trailLevel, trailStyle }) {
  // Verifie l'infrastructure avant toute tentative de routage : sans ca, les
  // echecs de generateLoop (qui retente avec un rayon reduit, pensant a un
  // probleme de terrain) masqueraient un message clair du type "BRouter non
  // configure" derriere un message generique trompeur ("secteur non routable").
  if (!isBrouterConfigured()) {
    throw new Error('BRouter n\'est pas configuré sur ce serveur (fichiers manquants dans le dossier brouter/) — voir le setup dans le README avant de générer un itinéraire.');
  }

  const profile = TERRAIN_PROFILES[terrain] || TERRAIN_PROFILES.trail;
  const { options, warning } = searchRadiusM
    ? await generateOptionsAcrossSearchRadius({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, searchRadiusM, profile, routeShape, trailLevel, trailStyle })
    : await generateOptionsAtSinglePoint({ start, targetDistanceM, targetAscentM, targetDurationMin, terrain, paceMinPerKm, profile, routeShape, trailLevel, trailStyle });

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
    if (targetDurationMin) opt.durationMatch = durationMatchInfo(opt.predictedDurationMin, targetDurationMin);
    // Mode "distance" (pas de duree visee) : targetDistanceM est alors le
    // VRAI critere choisi par l'utilisateur (en mode duree, ce parametre
    // n'est qu'une estimation interne deduite de la duree, pas une cible
    // reelle) - retour utilisateur explicite : en mode route/distance,
    // aucune correspondance n'etait jamais affichee jusqu'ici.
    if (!targetDurationMin && targetDistanceM) opt.distanceMatch = distanceMatchInfoOption(opt.distanceM, targetDistanceM);
    if (terrain === 'trail' && targetAscentM) opt.ascentMatch = ascentMatchInfo(opt.ascentM, targetAscentM);
    // Correspondance globale = la pire des correspondances applicables (cf
    // worseMatchLabel) - une option ne peut pas etre "Excellente" globalement
    // si l'un des criteres vises est loin de la cible.
    if (opt.durationMatch || opt.distanceMatch || opt.ascentMatch) {
      opt.matchLabel = worseMatchLabel(
        worseMatchLabel(opt.durationMatch && opt.durationMatch.label, opt.distanceMatch && opt.distanceMatch.label),
        opt.ascentMatch && opt.ascentMatch.label
      );
    }
    // % route / chemin / piste cyclable - meme philosophie que la correction
    // IGN ci-dessus (une fois par option finale, jamais bloquant si echec).
    opt.surfaceBreakdown = await computeSurfaceBreakdown(opt.points, profile, trailStyle);
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
  routeThroughViaPoint,
  generateLoop,
  generateLoopWithAlternates,
  generateOutAndBack,
  mirrorOutAndBack,
  bearingToCompassLabel,
  towardCompassPhrase,
  reorientLoopToClosestPoint,
  findSteepestSegment,
  findSteepestSegments,
  computeRepeatedZones,
  matchWaypointsForward,
  buildRepeatedWaypoints,
  buildMultiRepeatedWaypoints,
  calibrateAscent,
  predictDurationMin,
  TRAIL_LEVELS,
  equivalentFlatKm,
  trailLevelMidKmh,
  findHillyCandidateCenters,
  classifyWayTags,
  computeSurfaceBreakdown,
  generateRouteOptions,
  buildGpxXml,
  routeThroughPoints,
  TERRAIN_PROFILES,
  TRAIL_STYLE_PARAMS,
  DEFAULT_TRAIL_STYLE,
  ASCENT_CALIBRATION_FACTOR,
};
