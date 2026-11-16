// ============================================================================
// race_predictor_app.js — colle entre le moteur pur (race_predictor.js) et l'app
// Lit les données déjà chargées par l'app (VO2max, courses, activités, profil) et
// les passe au moteur. AUCUN calcul ici : tout vit dans race_predictor.js.
// Chargé après records.js (_racesData) et app.js (_allActivities, calcVMA...).
// ============================================================================

// Courses saisies (records.js) : chargées à la demande si la page Records n'a jamais été ouverte
async function ensureRacesLoaded() {
  try {
    if (typeof _racesData !== 'undefined' && Array.isArray(_racesData) && _racesData.length) return;
    const r = await fetch('/api/races');
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) _racesData = d; }
  } catch (e) { /* le moteur fonctionne sans courses (confiance faible) */ }
}

function predictorProfileSex() {
  try { return (JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}').sex) === 'F' ? 'F' : 'M'; }
  catch (e) { return 'M'; }
}

function predictorRaces() {
  return (typeof _racesData !== 'undefined' && Array.isArray(_racesData) ? _racesData : [])
    .filter(r => r && r.date && r.distanceKm > 0 && r.durationSec > 0)
    .map(r => ({ dateMs: new Date(String(r.date).slice(0, 10) + 'T00:00:00').getTime(), distanceKm: r.distanceKm, durationSec: r.durationSec, type: r.type, elevationGain: r.elevationGain || 0, dnf: !!r.dnf, vo2max: r.vo2max }));
}

function predictorActivities() {
  const acts = (typeof _allActivities !== 'undefined' && Array.isArray(_allActivities)) ? _allActivities : [];
  return acts
    .filter(a => /run/i.test(a.activityType || '') && !/treadmill/i.test(a.activityType || '') && a.distanceKm > 0 && a.durationSec > 0)
    .map(a => ({ dateMs: new Date(String(a.date).replace(' ', 'T')).getTime(), distanceKm: a.distanceKm, durationSec: a.durationSec, avgHR: a.avgHR, maxHR: a.maxHR, elevationGain: a.elevationGain || 0 }));
}

/** Prédiction ROUTE pour la distance donnée, à la date du jour. opts.vo2max / opts.sex : surcharge. */
function predictRoadNow(distKm, dplusM, opts) {
  if (typeof RacePredictor === 'undefined' || !distKm) return null;
  const o = opts || {};
  const vo2 = o.vo2max != null ? o.vo2max
    : (typeof _latestVO2MaxPrecise !== 'undefined' && _latestVO2MaxPrecise) ? _latestVO2MaxPrecise
    : (typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null);
  const adj = (typeof getVmaAdjustment === 'function') ? getVmaAdjustment() : null;
  return RacePredictor.predictRoad({
    distKm, dplusM: dplusM || 0, nowMs: Date.now(), vo2max: vo2, sex: o.sex || predictorProfileSex(),
    vmaRatio: adj ? adj.ratio : 1, races: predictorRaces(), activities: predictorActivities(),
  });
}

/** Prédiction TRAIL (modèle trail-1) pour la distance et le D+ donnés, à la date du jour. */
function predictTrailNow(distKm, dplusM, opts) {
  if (typeof RacePredictor === 'undefined' || !distKm) return null;
  const o = opts || {};
  const vo2 = o.vo2max != null ? o.vo2max
    : (typeof _latestVO2MaxPrecise !== 'undefined' && _latestVO2MaxPrecise) ? _latestVO2MaxPrecise
    : (typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null);
  const adj = (typeof getVmaAdjustment === 'function') ? getVmaAdjustment() : null;
  return RacePredictor.predictTrail({
    distKm, dplusM: dplusM || 0, nowMs: Date.now(), vo2max: vo2, sex: o.sex || predictorProfileSex(),
    vmaRatio: adj ? adj.ratio : 1, races: predictorRaces(),
  });
}

const PREDICTOR_CONF_LABEL = { high: 'élevée', medium: 'moyenne', low: 'faible' };

/** Texte d'info (fourchette + confiance) et détail (facteurs) pour l'interface. */
function describeRoadPrediction(pred, fmt) {
  if (!pred) return { range: '', detail: '' };
  const f = fmt || (s => RacePredictor.fmtHm(s));
  return {
    range: `${f(pred.lowSec)} – ${f(pred.highSec)} · confiance ${PREDICTOR_CONF_LABEL[pred.confidence]}`,
    detail: `Modèle ${pred.model}. ` + pred.factors.join(' '),
  };
}
