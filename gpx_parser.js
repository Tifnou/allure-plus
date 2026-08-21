// Parsing et analyse d'un GPX de course importe (page Objectifs) - extrait
// le trace (lat/lon/ele), calcule un profil altimetrique par tronçons
// (meme principe que computeGradeSegments cote client,
// frontend/js/session-analysis.js : bins de ~50m, seuil CLIMB_GRADE_PCT=3%
// pour distinguer plat/montee) afin d'affiner l'estimation de temps de
// course (actuellement une simple regle "1 m D+ = 10 m plat" appliquee au
// D+ total, cf estimateRaceTime dans app.js, qui ignore la descente et la
// repartition reelle des pentes) et d'alimenter la modale de visualisation
// du parcours.

const TRKPT_RE = /<trkpt[^>]*\slat="([^"]+)"[^>]*\slon="([^"]+)"[^>]*>[\s\S]*?<ele>([^<]+)<\/ele>[\s\S]*?<\/trkpt>|<trkpt[^>]*\slon="([^"]+)"[^>]*\slat="([^"]+)"[^>]*>[\s\S]*?<ele>([^<]+)<\/ele>[\s\S]*?<\/trkpt>/g;

const R_EARTH = 6371000;
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

// L'ordre lat/lon dans la balise <trkpt> est standard (lat puis lon), mais
// on tolere l'inverse (rencontre sur certains exports d'appareils/outils
// tiers) via le second groupe d'alternative de TRKPT_RE plutot que de
// planter silencieusement sur un fichier par ailleurs valide.
function parseGpxTrack(gpxText) {
  const points = [];
  let m;
  TRKPT_RE.lastIndex = 0;
  while ((m = TRKPT_RE.exec(gpxText)) !== null) {
    const lat = parseFloat(m[1] ?? m[5]);
    const lon = parseFloat(m[2] ?? m[4]);
    const ele = parseFloat(m[3] ?? m[6]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(ele)) points.push({ lat, lon, ele });
  }
  return points;
}

// Sous-echantillonne a un nombre de points geres par la carte/le graphique
// (meme esprit que MAX_PTS pour les traces d'activite, server.js) - une
// course longue (100 km+) peut compter plusieurs dizaines de milliers de
// points bruts GPS, inutile de tout garder pour l'affichage/le stockage.
const MAX_PROFILE_POINTS = 1200;
function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// Pente nette consideree "en cote" a partir de 3% (meme seuil que
// CLIMB_GRADE_PCT, session-analysis.js, pour rester coherent avec le reste
// de l'app) ; "en descente" symetriquement en dessous de -3% ; entre les
// deux = plat/faux-plat.
const CLIMB_GRADE_PCT = 3;
const DESCENT_GRADE_PCT = -3;
const BIN_SIZE_M = 50;

// Regroupe le trace en tronçons de ~BIN_SIZE_M, calcule la pente de chacun,
// puis agrege en statistiques globales (D+/D-, % plat/montee/descente,
// pente moyenne en montee, pente la plus marquee) - meme principe que
// computeGradeSegments cote client (session-analysis.js), adapte a un GPX de
// parcours (pas d'activite reelle, donc pas de FC).
function computeElevationProfile(points) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const bins = [];
  let cursor = 0, cursorDist = 0;
  let binStart = points[0], binDist = 0;
  for (let i = 1; i < points.length; i++) {
    const segDist = haversine(points[i - 1], points[i]);
    binDist += segDist;
    if (binDist >= BIN_SIZE_M || i === points.length - 1) {
      if (binDist > 5) { // ignore les tronçons quasi nuls (bruit GPS/altimetrique)
        const gradePct = ((points[i].ele - binStart.ele) / binDist) * 100;
        bins.push({ distM: binDist, gradePct, startIdx: cursor, endIdx: i });
      }
      binStart = points[i]; binDist = 0; cursor = i;
    }
  }
  if (!bins.length) return null;

  const totalDistM = bins.reduce((s, b) => s + b.distM, 0);
  const climbBins = bins.filter(b => b.gradePct >= CLIMB_GRADE_PCT);
  const descentBins = bins.filter(b => b.gradePct <= DESCENT_GRADE_PCT);
  const flatBins = bins.filter(b => b.gradePct > DESCENT_GRADE_PCT && b.gradePct < CLIMB_GRADE_PCT);

  const wAvgGrade = arr => {
    const tot = arr.reduce((s, b) => s + b.distM, 0);
    return tot > 0 ? arr.reduce((s, b) => s + b.gradePct * b.distM, 0) / tot : 0;
  };
  const sumDist = arr => arr.reduce((s, b) => s + b.distM, 0);

  let ascentM = 0, descentM = 0;
  bins.forEach(b => {
    const deltaEle = (b.gradePct / 100) * b.distM;
    if (deltaEle > 0) ascentM += deltaEle; else descentM += -deltaEle;
  });

  const maxClimbBin = climbBins.reduce((best, b) => (!best || b.gradePct > best.gradePct) ? b : best, null);
  const maxDescentBin = descentBins.reduce((best, b) => (!best || b.gradePct < best.gradePct) ? b : best, null);

  return {
    totalDistM: Math.round(totalDistM),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    pctFlat: Math.round((sumDist(flatBins) / totalDistM) * 100),
    pctClimb: Math.round((sumDist(climbBins) / totalDistM) * 100),
    pctDescent: Math.round((sumDist(descentBins) / totalDistM) * 100),
    avgClimbGradePct: climbBins.length ? Math.round(wAvgGrade(climbBins) * 10) / 10 : 0,
    avgDescentGradePct: descentBins.length ? Math.round(wAvgGrade(descentBins) * 10) / 10 : 0,
    maxClimbGradePct: maxClimbBin ? Math.round(maxClimbBin.gradePct * 10) / 10 : 0,
    maxDescentGradePct: maxDescentBin ? Math.round(maxDescentBin.gradePct * 10) / 10 : 0,
    // Bins conserves (index dans le trace sous-echantillonne, pas le trace
    // brut original) pour la coloration par pente de la carte/du graphique
    // cote client (cf renderGoalProfileModal, campus.js) - recalcules par
    // l'appelant sur le trace DEJA sous-echantillonne pour rester coherents
    // avec les points effectivement affiches.
  };
}

// Point d'entree : parse + calcule les stats sur le trace BRUT complet, PUIS
// sous-echantillonne pour le stockage/affichage. Bug reel constate (retour
// utilisateur : distance/D+ differents de l'import du meme GPX dans Garmin) :
// une version precedente calculait les stats sur le trace DEJA sous-
// echantillonne (1200 points max) - sur un fichier de plusieurs milliers de
// points (course longue), reduire l'index AVANT de mesurer coupe des
// virages/lacets et fausse aussi bien la distance que le D+ (les bins de
// pente de computeElevationProfile n'ont alors plus la meme base que le
// trace reel). Les stats et les points affiches doivent venir de deux
// passes independantes : la precision d'abord, l'affichage ensuite.
function analyzeGpx(gpxText) {
  const rawPoints = parseGpxTrack(gpxText);
  if (rawPoints.length < 2) return null;
  const stats = computeElevationProfile(rawPoints);
  if (!stats) return null;
  const points = downsample(rawPoints, MAX_PROFILE_POINTS);
  return { points, stats };
}

module.exports = { parseGpxTrack, computeElevationProfile, analyzeGpx, downsample, haversine, CLIMB_GRADE_PCT, DESCENT_GRADE_PCT };
