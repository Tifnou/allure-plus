// ═══════════════════════════════════════════════════════
// ANALYSE SEANCE PREVUE vs REALISEE
// Lie une seance du plan d'entrainement (campus.js) a une activite Garmin
// reelle (app.js) et compare les deux : volume, structure, allures,
// repetitions, regularite, pacing, recuperation, FC, derive cardiaque,
// coherence allure/FC, denivele (trail). Resultat stocke cote serveur
// (data/session_analyses.json) et rejoue depuis Entrainement ou Activites.
//
// Depend de campus.js (campusState, ALLURE_PLUS_ZONES, calcAllureRef(Trail),
// annotatePaceZones, isTrailSession, resolveZoneFromExercise, matchZoneFromPace,
// startOfDay, isNowInWeek, fmtWeekRange, fmtDuration, fmtPace, fmtDate,
// getVmaFromState, attachBackdropClose, fetchJSON) et de app.js (_allActivities,
// _fullyLoadedYears, isKmCircuits, classifyLaps, groupEffortsByDuration,
// describeDuration, calcHRMax, calcHRZones, loadProfileData, formatDateShort,
// formatDuration, formatPace, showToast, navigateTo, matchZoneFromPaceTrailAware,
// _avgRestingHR). Charge apres campus.js dans index.html.
// ═══════════════════════════════════════════════════════

// ─── Index des analyses deja liees (precharge une fois, reconstruit apres
//     chaque liaison/deliaison) — evite un aller-retour reseau par seance/activite ───
let _analysisIndex = { byActivity: {}, bySession: {}, list: [] };

function _analysisSessionKey(weekId, trainingIndex) {
  return weekId + '_' + (trainingIndex ?? 0);
}

function _rebuildAnalysisIndex(list) {
  const byActivity = {}, bySession = {};
  (list || []).forEach(a => {
    byActivity[String(a.activityId)] = a;
    if (a.planKey?.weekId) bySession[_analysisSessionKey(a.planKey.weekId, a.planKey.trainingIndex)] = a;
  });
  _analysisIndex = { byActivity, bySession, list: list || [] };
}

async function loadAnalysisIndex() {
  try {
    const res = await fetch('/api/session-analyses');
    if (res.ok) _rebuildAnalysisIndex(await res.json());
  } catch (e) { console.error('loadAnalysisIndex:', e); }
}

// ═══════════════════════════════════════════════════════
// CLASSIFICATION DU TYPE DE SEANCE + PONDERATION (cahier des charges §14-19/26)
// Meme ecart numerique != meme gravite selon le type de seance : les tables
// ci-dessous encodent cette regle comme donnee de config plutot que des
// branches de code eparpillees.
// ═══════════════════════════════════════════════════════
function classifySessionType(session, goalType, isTrail) {
  if (isTrail) return 'TRAIL';
  const cat = (session.trainingCategory || '').toLowerCase();
  if (cat.includes('long_run')) return 'SORTIE_LONGUE';
  if (cat.includes('basic_endurance')) return 'EF';
  if (cat.includes('threshold')) return 'SEUIL';
  if (cat.includes('vma')) return 'VMA';
  if (cat.includes('race_pace') || cat.includes('race_simulation')) {
    return goalType === 'marathon' ? 'MARATHON_AS42' : 'TEMPO';
  }
  if (cat.includes('intensity')) return 'SEUIL';
  return 'EF';
}

const SESSION_TYPE_PROFILES = {
  EF:            { priorityOrder: ['hr', 'duration', 'pace', 'drift'],             weights: { duration: .15, distance: .10, pace: .15, hr: .30, drift: .15, regularity: .15 } },
  TEMPO:         { priorityOrder: ['pace', 'hr', 'regularity', 'drift'],           weights: { pace: .25, hr: .25, regularity: .25, drift: .15, duration: .10 } },
  SEUIL:         { priorityOrder: ['pace', 'regularity', 'hr', 'structure'],       weights: { pace: .35, regularity: .25, hr: .20, structure: .20 } },
  VMA:           { priorityOrder: ['regularity', 'structure', 'pace', 'hr'],       weights: { regularity: .30, structure: .30, pace: .25, hr: .15 } },
  SORTIE_LONGUE: { priorityOrder: ['duration', 'hr', 'drift', 'pace'],             weights: { duration: .35, hr: .25, drift: .20, pace: .20 } },
  MARATHON_AS42: { priorityOrder: ['pace', 'regularity', 'hr', 'drift'],           weights: { pace: .35, regularity: .25, hr: .20, drift: .20 } },
  TRAIL:         { priorityOrder: ['duration', 'dplus', 'hr', 'pace'],             weights: { duration: .25, dplus: .30, hr: .20, structure: .15, pace: .10 } },
};

// Seuils de gravite (INFO/ATTENTION/IMPORTANT) sur l'ecart d'allure moyenne
// du bloc principal, en sec/km — plus stricts sur EF/Seuil/Marathon (la
// precision d'allure y est l'objectif meme), plus tolerants sur VMA/Trail.
const PACE_SEVERITY_THRESHOLDS = {
  EF:            { info: 8,  attention: 15, important: 25 },
  TEMPO:         { info: 10, attention: 18, important: 30 },
  SEUIL:         { info: 8,  attention: 15, important: 25 },
  VMA:           { info: 12, attention: 22, important: 35 },
  SORTIE_LONGUE: { info: 10, attention: 18, important: 30 },
  MARATHON_AS42: { info: 8,  attention: 15, important: 25 },
  TRAIL:         { info: 15, attention: 25, important: 40 },
};
const HR_SEVERITY_THRESHOLDS = {
  EF:            { info: 3, attention: 6,  important: 10 },
  TEMPO:         { info: 4, attention: 8,  important: 14 },
  SEUIL:         { info: 4, attention: 8,  important: 14 },
  VMA:           { info: 6, attention: 12, important: 20 },
  SORTIE_LONGUE: { info: 4, attention: 8,  important: 14 },
  MARATHON_AS42: { info: 4, attention: 8,  important: 14 },
  TRAIL:         { info: 5, attention: 10, important: 16 },
};
const VOLUME_SEVERITY_THRESHOLDS = { info: 8, attention: 18, important: 35 }; // % ecart
const DRIFT_SEVERITY_THRESHOLDS  = { info: 5, attention: 10, important: 18 }; // % derive

function severityFor(absValue, t) {
  if (absValue == null || t == null) return null;
  if (absValue >= t.important) return 'IMPORTANT';
  if (absValue >= t.attention) return 'ATTENTION';
  if (absValue >= t.info) return 'INFO';
  return null;
}
function downgradeSeverity(sev) {
  if (sev === 'IMPORTANT') return 'ATTENTION';
  if (sev === 'ATTENTION') return 'INFO';
  return null; // INFO -> plus d'anomalie du tout
}

// Types de seance ou la FC prime sur l'allure brute (§14-19) : courir plus
// vite que prevu SANS cout cardiaque excessif n'y est pas le signal
// d'alerte que representerait le meme ecart avec une FC elevee — c'est au
// contraire plutot bon signe (forme, capacite aerobie). Attenuer l'ecart
// d'allure dans ce cas precis, plutot que de le traiter comme n'importe
// quel autre depassement.
const HR_PRIORITY_SESSION_TYPES = ['EF', 'SORTIE_LONGUE', 'MARATHON_AS42'];
function isFasterButHrControlled(sessionTypeKey, deviationSecKm, hrVerdict) {
  return HR_PRIORITY_SESSION_TYPES.includes(sessionTypeKey)
    && deviationSecKm != null && deviationSecKm < 0
    && hrVerdict && hrVerdict !== 'elevee';
}

// Correspondance APPROXIMATIVE zone d'allure -> zone FC Karvonen (1=Z1..5=Z5),
// derivee des memes plages qualitatives que ALLURE_PLUS_ZONES[x].fcZone
// (campus.js) — jamais une egalite stricte, uniquement une bande indicative
// pour estimer un "temps en zone FC approximative".
const PACE_ZONE_TO_HR_ZONE_RANGE = {
  RECOVER: [1, 1], EF: [1, 2], TEMPO: [2, 3], AS42: [3, 3], SWEET_SPOT: [3, 3],
  AS21: [3, 4], S60: [4, 4], AS10: [4, 4], S30: [4, 5], VMA: [5, 5],
};

// ═══════════════════════════════════════════════════════
// EXTRACTION DE LA STRUCTURE PREVUE (exercisesBlocks)
// ═══════════════════════════════════════════════════════
function durationsToSeconds(durations) {
  return (durations || []).reduce((sum, d) => sum + (d.timeUnit === 'minutes' ? d.value * 60 : (d.value || 0)), 0);
}

function flattenPlannedExercises(session) {
  const out = [];
  (session.exercisesBlocks || []).forEach((block, blockIdx) => {
    const repeat = block.repeat || 1;
    for (let r = 0; r < repeat; r++) {
      (block.exercises || []).forEach(ex => out.push({ ...ex, blockType: block.blockType || null, blockIdx, repIdx: r, blockRepeat: repeat }));
    }
  });
  return out;
}

function resolvePlannedExerciseZone(ex, goalType) {
  return resolveZoneFromExercise(ex.pace, ex.pace?.zoneKind, goalType);
}

// Zone dominante ponderee par la DUREE planifiee (pas par un simple compte
// d'occurrences) : une seance "EF + lignes droites" a 1 bloc EF de 25 min
// (repeat 1) et 5 lignes droites de 15s (repeat 5) — en occurrences, VMA
// gagnerait (5 contre 1) alors que l'objectif reel de la seance reste
// l'endurance fondamentale (25 min contre 75s de lignes droites). Ponderer
// par la duree cumulee reflete correctement quel segment est l'objectif
// principal, sans avoir a lister les categories de seance au cas par cas.
function pickDominantZone(exercises, goalType) {
  const durations = {};
  exercises.forEach(ex => {
    const z = resolvePlannedExerciseZone(ex, goalType);
    if (z) durations[z] = (durations[z] || 0) + durationsToSeconds(ex.durations);
  });
  let best = null, bestDur = 0;
  Object.entries(durations).forEach(([z, d]) => { if (d > bestDur) { best = z; bestDur = d; } });
  return best;
}

// Duree d'effort planifiee cumulee (hors echauffement/recuperation/retour au
// calme) — cle de rapprochement pour la comparaison entre seances similaires
// a plusieurs semaines d'ecart (§27), arrondie a 30s pres.
function computePairingKey(session) {
  const flat = flattenPlannedExercises(session);
  const effortSec = flat
    .filter(ex => !ex.blockType && ex.exerciseType === 'running')
    .reduce((s, ex) => s + durationsToSeconds(ex.durations), 0);
  if (!effortSec) return null;
  return 'eff_' + (Math.round(effortSec / 30) * 30);
}

// VO2max GARMIN tel qu'il etait a une date donnee (pas le VO2max actuel) —
// repli utilise seulement quand l'activite elle-meme n'a pas de vO2MaxValue
// propre (voir getCorrectVma). Cherche dans l'historique (_vo2maxSeries,
// ~400 jours, trie chronologique) la derniere valeur connue A ou AVANT
// cette date.
function getHistoricalVo2Max(dateStr) {
  if (typeof _vo2maxSeries === 'undefined' || !_vo2maxSeries.length) return null;
  const targetTime = new Date(dateStr).getTime();
  let best = null;
  for (const entry of _vo2maxSeries) {
    if (new Date(entry.date).getTime() <= targetTime) best = entry;
    else break; // serie triee croissant par date (cf. loadDashboard)
  }
  // Activite plus ancienne que tout l'historique connu : repli sur le plus
  // ancien point disponible plutot que de ne rien avoir du tout.
  if (!best) best = _vo2maxSeries[0];
  return best ? best.value : null;
}

// VMA calibree utilisateur A LA DATE DE L'ACTIVITE analysee. Essentiel pour
// l'analyse seance prevue/realisee : la seance doit etre jugee avec la forme
// du coureur AU MOMENT de la course, jamais avec sa forme actuelle — sinon
// rouvrir ou recalculer une vieille analyse des mois plus tard changerait
// silencieusement les allures cibles en fonction des progres (ou regressions)
// faits entre-temps.
//
// Priorite : 1) activity.vO2MaxValue — l'estimation Garmin attachee A CETTE
// activite precise (deja stockee sur l'objet activite renvoye par
// /api/dashboard et /api/activities/year/:annee, donc gratuite, fiable a
// ~93% des activites de course, et immuable une fois l'activite creee) ;
// 2) a defaut, recherche dans l'historique VO2max par date (activites plus
// anciennes que la couverture Garmin, ou type d'activite sans estimation) ;
// 3) a defaut, VO2max actuel. Meme priorite Garmin-d'abord que
// renderSessionDetail (campus.js) — NE PAS reutiliser getVmaFromState()
// (campus.js) ici : cette fonction partagee inverse la priorite (Campus
// d'abord) pour ses propres besoins (estimation fin de plan), ce qui
// donnerait ici une allure cible incoherente avec celle deja affichee sur
// la fiche de seance — exactement l'erreur que CLAUDE.md interdit ("ne
// jamais utiliser les allures historiques de Campus").
function getCorrectVma(activity) {
  const vo2 = activity?.vO2MaxValue
    || (activity?.date ? getHistoricalVo2Max(activity.date) : null)
    || (typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null);
  if (vo2 && vo2 > 3.5) {
    const profile = loadProfileData();
    const factor = (profile.sex || 'M') === 'F' ? 0.315 : 0.313;
    return Math.round((vo2 - 3.5) * factor * 10) / 10;
  }
  return campusState.fitness?.vma || null;
}

// ═══════════════════════════════════════════════════════
// FC — zones utilisateur (Karvonen) + bande approximative par zone d'allure
// ═══════════════════════════════════════════════════════
function getUserAgeFromProfile(p) {
  if (!p.birthDate) return p.age || null;
  const b = new Date(p.birthDate), now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

function getUserHRZones() {
  const p = loadProfileData();
  const age = getUserAgeFromProfile(p);
  const hrMax = calcHRMax(age, p.hrmax || null);
  if (!hrMax) return null;
  const hrRest = (typeof _avgRestingHR !== 'undefined' && _avgRestingHR) ? Math.round(_avgRestingHR) : null;
  return calcHRZones(hrMax, hrRest);
}

function approxHRBandForPaceZone(zoneKey, hrZones) {
  const range = PACE_ZONE_TO_HR_ZONE_RANGE[zoneKey];
  if (!range || !hrZones) return null;
  const [lowIdx, highIdx] = range;
  return { low: hrZones[lowIdx - 1].low, high: hrZones[highIdx - 1].high, approx: true };
}

// ═══════════════════════════════════════════════════════
// SCORING — fonctions de conversion ecart -> score 0-100
// ═══════════════════════════════════════════════════════
function scoreFromDeltaPct(deltaPct, tolerance, hardLimit) {
  if (deltaPct == null) return null;
  const abs = Math.abs(deltaPct);
  if (abs <= tolerance) return 100;
  return Math.max(0, Math.round(100 - ((abs - tolerance) / (hardLimit - tolerance)) * 100));
}
function scoreFromBand(absValue, goodBand, badBand) {
  if (absValue == null) return null;
  const abs = Math.abs(absValue);
  if (abs <= goodBand) return 100;
  return Math.max(0, Math.round(100 - ((abs - goodBand) / (badBand - goodBand)) * 100));
}
function scoreFromStructureReps(plannedReps, actualReps) {
  if (!plannedReps) return null;
  if (actualReps == null) return null;
  const ratio = Math.min(actualReps, plannedReps) / plannedReps;
  const extraPenalty = Math.max(0, actualReps - plannedReps) * 5;
  return Math.max(0, Math.min(100, Math.round(ratio * 100 - extraPenalty)));
}
function verdictForScore(score) {
  if (score >= 95) return { emoji: '🏆', label: 'Séance parfaitement réalisée' };
  if (score >= 85) return { emoji: '✅', label: 'Très bonne séance' };
  if (score >= 70) return { emoji: '👍', label: 'Séance globalement conforme' };
  if (score >= 50) return { emoji: '⚠️', label: 'Séance partiellement réalisée' };
  return { emoji: '❗', label: 'Séance très différente de celle prévue' };
}

// ═══════════════════════════════════════════════════════
// MOTEUR DE COMPARAISON — orchestrateur principal
// ═══════════════════════════════════════════════════════
async function buildSessionAnalysis(session, week, activity) {
  const goalType = campusState.goal?.goalType || '';
  const isTrail = isTrailSession(session);
  const sessionTypeKey = classifySessionType(session, goalType, isTrail);
  const profile = SESSION_TYPE_PROFILES[sessionTypeKey];
  const vma = getCorrectVma(activity);

  const plannedFlat = flattenPlannedExercises(session);
  const warmupEx   = plannedFlat.filter(e => e.blockType === 'warm-up');
  const cooldownEx = plannedFlat.filter(e => e.blockType === 'cool-down');
  const mainFlat   = plannedFlat.filter(e => !e.blockType);
  const runningEx  = mainFlat.filter(e => e.exerciseType === 'running');
  const recupEx    = mainFlat.filter(e => e.exerciseType === 'recuperation');
  // Seules les repetitions d'un bloc reellement repete (repeat > 1) comptent
  // comme "repetitions" — le bloc continu (repeat 1, ex: le corps d'un
  // footing EF) n'en est pas une, meme s'il est aussi de type "running".
  const repeatingRunningEx = mainFlat.filter(e => e.exerciseType === 'running' && (e.blockRepeat || 1) > 1);

  const plannedWarmupSec   = warmupEx.reduce((s, e) => s + durationsToSeconds(e.durations), 0);
  const plannedCooldownSec = cooldownEx.reduce((s, e) => s + durationsToSeconds(e.durations), 0);
  const plannedMainReps    = repeatingRunningEx.length;
  const hasStructuredReps  = plannedMainReps > 1;

  // Zone dominante (ponderee duree) = objectif principal de la seance, sert
  // a la ligne de synthese "Allure" et au score. Zone des repetitions = zone
  // propre au bloc repete (peut differer : ex EF domine la duree mais les
  // lignes droites visent la zone VMA) — sert uniquement au tableau
  // repetition par repetition, jamais a la ligne de synthese globale.
  const mainZoneKey = pickDominantZone(runningEx.length ? runningEx : mainFlat, goalType);
  const mainPaceRange = mainZoneKey && vma
    ? (isTrail ? calcAllureRefTrail(mainZoneKey, vma) : calcAllureRef(mainZoneKey, vma))
    : null;
  const repsZoneKey = hasStructuredReps ? pickDominantZone(repeatingRunningEx, goalType) : null;
  const repsPaceRange = repsZoneKey && vma
    ? (isTrail ? calcAllureRefTrail(repsZoneKey, vma) : calcAllureRef(repsZoneKey, vma))
    : null;
  // Les repetitions sont-elles l'objectif principal de la seance (Seuil, VMA
  // fractionne...) ou un accessoire secondaire greffe sur un footing continu
  // (EF + lignes droites) ? Determine si la moyenne du groupe de repetitions
  // doit representer la ligne de synthese globale, ou si celle-ci doit rester
  // la moyenne de l'ensemble de l'activite.
  const repsAreMainFocus = hasStructuredReps && repsZoneKey && repsZoneKey === mainZoneKey;
  const plannedRecupSec = recupEx.length
    ? recupEx.reduce((s, e) => s + durationsToSeconds(e.durations), 0) / recupEx.length
    : null;

  // ── Cote reel : laps Garmin ──
  let laps = [];
  try {
    const res = await fetch(`/api/activity/${activity.id}/laps`);
    if (res.ok) { const d = await res.json(); laps = Array.isArray(d.laps) ? d.laps : []; }
  } catch (e) { /* pas de laps -> analyse degradee sur les totaux d'activite */ }

  const circuits = laps.length ? isKmCircuits(laps) : false;
  const useRepsPath = hasStructuredReps && !circuits && laps.length > 0;

  const types = laps.length ? classifyLaps(laps) : [];
  const effortEntries = laps.reduce((acc, lap, idx) => { if (types[idx] === 'effort') acc.push({ lap, idx }); return acc; }, []);
  const restLaps   = laps.filter((_, i) => types[i] === 'rest');
  const warmupLaps = laps.filter((_, i) => types[i] === 'warmup');
  // Le dernier lap classe 'rest' (position) represente le retour au calme
  // (regle de classifyLaps) ; les autres 'rest' sont des recuperations entre repetitions.
  const lastIsRest = laps.length > 0 && types[types.length - 1] === 'rest';
  const cooldownLap = lastIsRest ? laps[laps.length - 1] : null;
  const recoveryLaps = restLaps.filter(l => l !== cooldownLap);

  // Deroule visuel de la seance (echauffement/effort/recuperation), un
  // segment par lap, largeur proportionnelle a sa duree — meme principe que
  // la vue "phases" de Garmin Connect. Construit independamment du chemin
  // repetitions/continu emprunte plus haut, tant que des laps existent.
  const timeline = laps.map((lap, idx) => {
    const durationSec = lap.elapsedDuration || lap.movingDuration || lap.duration || 0;
    const paceSecKm = lap.averageSpeed > 0 ? Math.round(1000 / lap.averageSpeed) : null;
    return { type: types[idx] || 'effort', durationSec, paceSecKm, hr: lap.averageHR ? Math.round(lap.averageHR) : null };
  }).filter(seg => seg.durationSec > 0);

  const groups = useRepsPath ? groupEffortsByDuration(effortEntries, vma, isTrail) : [];
  // Groupe principal = celui qui matche le mieux le nombre de repetitions prevues
  const mainGroup = groups.length
    ? groups.reduce((best, g) => Math.abs(g.repCount - plannedMainReps) < Math.abs((best?.repCount || 0) - plannedMainReps) ? g : best, groups[0])
    : null;

  // ── Volume ──
  const plannedDurationSec = session.stats?.expectedDuration || null;
  const plannedDistanceKm  = session.stats?.expectedDistance || null;
  const actualDurationSec  = activity.durationSec || null;
  const actualDistanceKm   = activity.distanceKm || null;
  const durDeltaPct  = (plannedDurationSec && actualDurationSec) ? Math.round(((actualDurationSec - plannedDurationSec) / plannedDurationSec) * 100) : null;
  const distDeltaPct = (plannedDistanceKm && actualDistanceKm) ? Math.round(((actualDistanceKm - plannedDistanceKm) / plannedDistanceKm) * 100) : null;
  const primaryDeltaPct = durDeltaPct != null ? durDeltaPct : distDeltaPct;
  const volume = {
    plannedDurationSec, actualDurationSec, plannedDistanceKm, actualDistanceKm,
    movingTimeSec: actualDurationSec, stoppedTimeSec: null,
    deltaPct: primaryDeltaPct,
    verdict: primaryDeltaPct == null ? null : (Math.abs(primaryDeltaPct) <= 10 ? 'conforme' : primaryDeltaPct > 0 ? 'plus_long' : 'plus_court'),
  };

  // ── Structure ──
  // Le comptage de repetitions n'a de sens que si le PLAN definit reellement
  // plusieurs repetitions (hasStructuredReps) — sur une seance continue (EF,
  // sortie longue...), un eventuel lap "effort" (ligne droite, sprint...)
  // detecte par classifyLaps ne doit jamais etre compare a un nombre de
  // repetitions prevues qui n'existe pas dans le plan.
  const actualWarmupSec   = warmupLaps.reduce((s, l) => s + (l.elapsedDuration || l.movingDuration || l.duration || 0), 0);
  const actualCooldownSec = cooldownLap ? (cooldownLap.elapsedDuration || cooldownLap.movingDuration || cooldownLap.duration || 0) : null;
  const actualMainReps    = hasStructuredReps ? (useRepsPath ? (mainGroup ? mainGroup.repCount : effortEntries.length) : null) : null;
  const structure = {
    plannedWarmupSec, actualWarmupSec: laps.length ? actualWarmupSec : null,
    plannedMainReps: hasStructuredReps ? plannedMainReps : null, actualMainReps,
    plannedCooldownSec, actualCooldownSec,
    anomalies: circuits && hasStructuredReps ? ['Répétitions non identifiables (laps automatiques au km, pas de laps manuels)'] : [],
  };

  // ── Allure(s) ──
  // La ligne de synthese "Allure" (et le score) refletent l'objectif
  // PRINCIPAL de la seance (mainZoneKey, dominant en duree) — l'allure
  // reelle a comparer est donc celle du groupe de repetitions UNIQUEMENT
  // quand ces repetitions SONT l'objectif principal (Seuil, VMA fractionne :
  // repsZoneKey === mainZoneKey). Sinon (EF + lignes droites : les
  // repetitions sont un accessoire greffe sur un footing continu), utiliser
  // la moyenne globale de l'activite — jamais les seuls laps "effort" de
  // classifyLaps, qui ne representeraient alors que quelques sprints
  // ponctuels et fausseraient totalement l'allure globale affichee.
  const actualPaceSecKm = (repsAreMainFocus && mainGroup) ? mainGroup.avgPaceSecKm : (activity.avgPaceSecPerKm || null);
  const deviationSecKm = (mainPaceRange && actualPaceSecKm) ? Math.round(actualPaceSecKm - (mainPaceRange.paceMin + mainPaceRange.paceMax) / 2) : null;
  const deviationPct   = (mainPaceRange && actualPaceSecKm) ? Math.round((deviationSecKm / ((mainPaceRange.paceMin + mainPaceRange.paceMax) / 2)) * 100) : null;
  // Laps pertinents pour le temps-en-zone : meme logique — le groupe de
  // repetitions seulement si elles sont l'objectif principal, sinon TOUS les
  // laps de l'activite (une seance continue n'a pas de sous-ensemble
  // "effort" fiable — classifyLaps est concu pour les seances fractionnees).
  const zoneRelevantLaps = (repsAreMainFocus && mainGroup) ? mainGroup.memberIdx.map(i => laps[i]) : laps.filter(l => l.averageSpeed > 0);
  let pctTimeInBand = null;
  if (mainPaceRange && zoneRelevantLaps.length) {
    let inTime = 0, totalTime = 0;
    zoneRelevantLaps.forEach(l => {
      const dur = l.elapsedDuration || l.movingDuration || l.duration || 0;
      totalTime += dur;
      const p = l.averageSpeed > 0 ? 1000 / l.averageSpeed : null;
      if (p != null && p >= mainPaceRange.paceMin && p <= mainPaceRange.paceMax) inTime += dur;
    });
    pctTimeInBand = totalTime > 0 ? Math.round((inTime / totalTime) * 100) : null;
  }
  const paceAnalysis = mainPaceRange ? [{
    segmentLabel: ALLURE_PLUS_ZONES[mainZoneKey]?.label || mainZoneKey,
    targetPaceMin: mainPaceRange.paceMin, targetPaceMax: mainPaceRange.paceMax,
    actualPaceSecKm: actualPaceSecKm ? Math.round(actualPaceSecKm) : null,
    deviationSecKm, deviationPct, pctTimeInBand,
  }] : [];

  // ── Repetitions ──
  // Chaque repetition est jugee contre la zone du BLOC REPETE (repsPaceRange),
  // jamais contre la zone dominante globale (mainPaceRange) qui peut
  // representer un tout autre segment de la seance (cf. EF + lignes droites).
  let reps = [];
  if (useRepsPath && mainGroup) {
    reps = mainGroup.memberIdx.map((lapIdx, i) => {
      const lap = laps[lapIdx];
      const p = lap.averageSpeed > 0 ? Math.round(1000 / lap.averageSpeed) : null;
      let classification = null;
      if (p != null && repsPaceRange) {
        if (p < repsPaceRange.paceMin) classification = (repsPaceRange.paceMin - p) > 15 ? 'too_fast' : 'slightly_fast';
        else if (p > repsPaceRange.paceMax) classification = (p - repsPaceRange.paceMax) > 15 ? 'too_slow' : 'slightly_slow';
        else classification = 'on_target';
      }
      return {
        index: i + 1,
        targetPaceMinSecKm: repsPaceRange ? repsPaceRange.paceMin : null,
        targetPaceMaxSecKm: repsPaceRange ? repsPaceRange.paceMax : null,
        actualPaceSecKm: p, classification,
        actualDurationSec: Math.round(lap.elapsedDuration || lap.movingDuration || lap.duration || 0),
        actualHR: lap.averageHR ? Math.round(lap.averageHR) : null,
      };
    });
  }

  // ── Regularite ──
  const regularity = mainGroup && mainGroup.regularityMaxEcart != null ? {
    maxEcartSecKm: mainGroup.regularityMaxEcart, label: mainGroup.regularityLabel,
    narrative: mainGroup.splitDiffSec == null ? null
      : mainGroup.splitDiffSec > 8 ? 'Votre rythme devient progressivement plus lent au cours de la séance.'
      : mainGroup.splitDiffSec < -8 ? 'Vous terminez plus vite que vous n\'avez commencé.'
      : 'Vos répétitions sont homogènes du début à la fin.',
  } : { maxEcartSecKm: null, label: null, narrative: null };

  // ── Strategie de pacing (negative/positive split, depart trop rapide...) ──
  const pacingStrategy = mainGroup && mainGroup.paces.length >= 2 ? detectPacingStrategy(mainGroup.paces) : 'stable';

  // ── Recuperation ──
  const recovery = {
    plannedDurationSec: plannedRecupSec,
    actualDurationSec: recoveryLaps.length ? Math.round(recoveryLaps.reduce((s, l) => s + (l.elapsedDuration || l.movingDuration || l.duration || 0), 0) / recoveryLaps.length) : null,
    regularityLabel: recoveryLaps.length >= 2 ? regularityLabelFromDurations(recoveryLaps.map(l => l.elapsedDuration || l.movingDuration || l.duration || 0)) : null,
    standingStillDetected: recoveryLaps.some(l => (l.averageSpeed || 0) < 0.3 && recupEx.some(e => (e.pace?.slug || '') !== 'slow')),
  };

  // ── FC ──
  const hrZones = getUserHRZones();
  const approxBand = mainZoneKey ? approxHRBandForPaceZone(mainZoneKey, hrZones) : null;
  let hr = null;
  if (activity.avgHR) {
    let pctTimeInTargetZone = null;
    if (approxBand && zoneRelevantLaps.length) {
      let inTime = 0, totalTime = 0;
      zoneRelevantLaps.forEach(l => {
        const dur = l.elapsedDuration || l.movingDuration || l.duration || 0;
        totalTime += dur;
        if (l.averageHR && l.averageHR >= approxBand.low && l.averageHR <= approxBand.high) inTime += dur;
      });
      pctTimeInTargetZone = totalTime > 0 ? Math.round((inTime / totalTime) * 100) : null;
    }
    hr = {
      avgHR: Math.round(activity.avgHR), maxHR: activity.maxHR ? Math.round(activity.maxHR) : null,
      approxTargetBand: approxBand, pctTimeInTargetZone,
      trendAcrossReps: (useRepsPath && mainGroup) ? zoneRelevantLaps.map(l => l.averageHR ? Math.round(l.averageHR) : null) : [],
      hrRecoveryBetweenReps: recoveryLaps.map(l => l.averageHR ? Math.round(l.averageHR) : null),
    };
  }

  // ── Derive cardiaque (1ere moitie vs 2e moitie de l'activite entiere) ──
  const cardiacDrift = computeCardiacDrift(laps);

  // ── Coherence allure / FC ──
  const paceVerdict = deviationSecKm == null ? null : (Math.abs(deviationSecKm) <= 10 ? 'conforme' : deviationSecKm < 0 ? 'rapide' : 'lente');
  const hrVerdict = (hr && approxBand) ? (hr.avgHR > approxBand.high ? 'elevee' : hr.avgHR < approxBand.low ? 'basse' : 'conforme') : null;
  const coherenceNarrative = computeCoherenceNarrative(paceVerdict, hrVerdict);

  // ── Temps passe plus vite / dans la cible / plus lent (bloc principal) ──
  let timeInZoneBreakdown = null;
  if (mainPaceRange && zoneRelevantLaps.length) {
    let fasterT = 0, inT = 0, slowerT = 0, totalT = 0;
    zoneRelevantLaps.forEach(l => {
      const dur = l.elapsedDuration || l.movingDuration || l.duration || 0;
      const p = l.averageSpeed > 0 ? 1000 / l.averageSpeed : null;
      if (p == null) return;
      totalT += dur;
      if (p < mainPaceRange.paceMin) fasterT += dur;
      else if (p > mainPaceRange.paceMax) slowerT += dur;
      else inT += dur;
    });
    if (totalT > 0) timeInZoneBreakdown = { pctFaster: Math.round((fasterT/totalT)*100), pctInTarget: Math.round((inT/totalT)*100), pctSlower: Math.round((slowerT/totalT)*100) };
  }

  // ── Trail : denivele ──
  let trail = null;
  if (isTrail) {
    const plannedDPlusM = session.stats?.expectedElevationGain || null;
    const actualDPlusM  = activity.elevationGain || null;
    const movingH = actualDurationSec ? actualDurationSec / 3600 : null;
    trail = {
      plannedDPlusM, actualDPlusM,
      deltaPct: (plannedDPlusM && actualDPlusM) ? Math.round(((actualDPlusM - plannedDPlusM) / plannedDPlusM) * 100) : null,
      plannedDMinusM: null, actualDMinusM: null,
      vamMPerH: (actualDPlusM && movingH) ? Math.round(actualDPlusM / movingH) : null,
    };
  }

  // ── Anomalies (severite dependante du type de seance, §26) ──
  const anomalies = [];
  const volSeverity = severityFor(primaryDeltaPct != null ? Math.abs(primaryDeltaPct) : null, VOLUME_SEVERITY_THRESHOLDS);
  if (volSeverity) anomalies.push({ code: primaryDeltaPct > 0 ? 'VOLUME_SUP' : 'VOLUME_INF', severity: volSeverity,
    message: primaryDeltaPct > 0 ? `Séance ${Math.abs(primaryDeltaPct)}% plus longue que prévu.` : `Séance ${Math.abs(primaryDeltaPct)}% plus courte que prévu.` });

  const rawPaceSeverity = severityFor(deviationSecKm != null ? Math.abs(deviationSecKm) : null, PACE_SEVERITY_THRESHOLDS[sessionTypeKey]);
  const paceLenient = isFasterButHrControlled(sessionTypeKey, deviationSecKm, hrVerdict);
  // Cas "plus vite mais FC maitrisee" : deux crans d'attenuation, pas un
  // seul — l'objectif est de ne PAS faire apparaitre ce cas dans "a
  // ameliorer" (reserve a ATTENTION/IMPORTANT), puisqu'il n'y a justement
  // rien a ameliorer physiologiquement, seulement une info a signaler
  // (deja valorisee separement dans les points positifs).
  const paceSeverity = paceLenient ? downgradeSeverity(downgradeSeverity(rawPaceSeverity)) : rawPaceSeverity;
  if (paceSeverity) anomalies.push({ code: deviationSecKm < 0 ? 'PACE_TROP_RAPIDE' : 'PACE_TROP_LENTE', severity: paceSeverity,
    message: paceLenient
      ? `Allure ${Math.abs(deviationSecKm)}s/km plus rapide que la cible, mais fréquence cardiaque maîtrisée — pas d'inquiétude particulière.`
      : `Allure moyenne ${deviationSecKm < 0 ? Math.abs(deviationSecKm) + 's/km plus rapide' : deviationSecKm + 's/km plus lente'} que la cible.` });

  if (hr && approxBand) {
    const hrOver = hr.avgHR - approxBand.high;
    const hrSeverity = hrOver > 0 ? severityFor(hrOver, HR_SEVERITY_THRESHOLDS[sessionTypeKey]) : null;
    if (hrSeverity) anomalies.push({ code: 'FC_ELEVEE', severity: hrSeverity, message: `FC moyenne (${hr.avgHR} bpm) au-dessus de la zone attendue.` });
  }

  if (cardiacDrift && cardiacDrift.driftPct != null) {
    const driftSeverity = severityFor(Math.abs(cardiacDrift.driftPct), DRIFT_SEVERITY_THRESHOLDS);
    if (driftSeverity) anomalies.push({ code: 'DERIVE_CARDIAQUE', severity: driftSeverity, message: `Dérive cardiaque de ${cardiacDrift.driftPct > 0 ? '+' : ''}${cardiacDrift.driftPct}% entre la 1ère et la 2ème moitié.` });
  }

  if (hasStructuredReps && structure.actualMainReps != null) {
    if (structure.actualMainReps < plannedMainReps) anomalies.push({ code: 'FRACTION_MANQUANTE', severity: 'ATTENTION', message: `${plannedMainReps - structure.actualMainReps} répétition(s) manquante(s) sur ${plannedMainReps} prévues.` });
    else if (structure.actualMainReps > plannedMainReps) anomalies.push({ code: 'FRACTION_SUPPLEMENTAIRE', severity: 'INFO', message: `${structure.actualMainReps - plannedMainReps} répétition(s) de plus que prévu.` });
  }

  if (plannedWarmupSec && structure.actualWarmupSec != null && structure.actualWarmupSec < plannedWarmupSec * 0.6) {
    anomalies.push({ code: 'ECHAUFFEMENT_INSUFFISANT', severity: 'ATTENTION', message: 'Échauffement nettement plus court que prévu.' });
  }
  if (plannedCooldownSec && (structure.actualCooldownSec == null || structure.actualCooldownSec < plannedCooldownSec * 0.5)) {
    anomalies.push({ code: 'RETOUR_AU_CALME_INSUFFISANT', severity: 'INFO', message: 'Retour au calme raccourci ou absent.' });
  }
  if (regularity.maxEcartSecKm != null && regularity.maxEcartSecKm > 25) {
    anomalies.push({ code: 'IRREGULARITE', severity: regularity.maxEcartSecKm > 40 ? 'IMPORTANT' : 'ATTENTION', message: 'Répétitions irrégulières (écarts d\'allure marqués entre répétitions).' });
  }
  if (recovery.standingStillDetected) {
    anomalies.push({ code: 'RECUP_ARRET', severity: 'INFO', message: 'Récupération réalisée à l\'arrêt alors qu\'une récupération active était prévue.' });
  }
  if (primaryDeltaPct != null && primaryDeltaPct < -50) {
    anomalies.push({ code: 'SEANCE_INTERROMPUE', severity: 'IMPORTANT', message: 'Séance très écourtée par rapport au prévu — possiblement interrompue.' });
  }

  // ── Points positifs / a ameliorer ──
  const positives = [];
  if (volume.verdict === 'conforme') positives.push('Volume prévu respecté.');
  if (hasStructuredReps && structure.actualMainReps >= plannedMainReps) positives.push(`Toutes les répétitions ont été réalisées (${structure.actualMainReps}/${plannedMainReps}).`);
  if (regularity.label && (regularity.label.includes('excellente') || regularity.label.includes('bonne'))) positives.push(`${regularity.label.charAt(0).toUpperCase() + regularity.label.slice(1)} entre les répétitions.`);
  if (paceVerdict === 'conforme') positives.push('Allure moyenne conforme à la zone visée.');
  else if (paceLenient) positives.push('Vous avez couru plus vite que prévu tout en gardant une fréquence cardiaque maîtrisée — bon signe de forme.');
  if (hrVerdict === 'conforme') positives.push('Fréquence cardiaque maîtrisée, cohérente avec l\'intensité visée.');
  if (cardiacDrift && cardiacDrift.driftPct != null && Math.abs(cardiacDrift.driftPct) <= 5) positives.push('Dérive cardiaque très faible, bonne gestion de l\'effort.');
  if (positives.length === 0) positives.push('Séance réalisée et liée avec succès à votre plan.');

  const improvements = anomalies
    .filter(a => a.severity === 'IMPORTANT' || a.severity === 'ATTENTION')
    .sort((a, b) => (a.severity === 'IMPORTANT' ? 0 : 1) - (b.severity === 'IMPORTANT' ? 0 : 1))
    .slice(0, 3)
    .map(a => a.message);

  // ── Score ──
  // Le composant allure n'est pas plafonne aussi bas quand l'ecart est un
  // "trop vite mais FC maitrisee" (paceLenient) : le veritable objectif
  // physiologique de ces seances est respecte, un ecart d'allure brut n'y
  // represente pas la meme gravite qu'avec une FC elevee (§26).
  const rawPaceScore = scoreFromBand(deviationSecKm, 10, 40);
  const components = {
    duration: scoreFromDeltaPct(durDeltaPct, 10, 50),
    distance: scoreFromDeltaPct(distDeltaPct, 10, 50),
    pace: (paceLenient && rawPaceScore != null) ? Math.max(rawPaceScore, 75) : rawPaceScore,
    hr: hr && hr.pctTimeInTargetZone != null ? hr.pctTimeInTargetZone : null,
    drift: cardiacDrift ? scoreFromBand(cardiacDrift.driftPct, 4, 18) : null,
    regularity: scoreFromBand(regularity.maxEcartSecKm, 8, 40),
    structure: scoreFromStructureReps(plannedMainReps, structure.actualMainReps),
    dplus: (trail && trail.deltaPct != null) ? scoreFromDeltaPct(trail.deltaPct, 10, 50) : null,
  };
  let scoreSum = 0, scoreW = 0;
  Object.entries(profile.weights).forEach(([key, w]) => {
    const v = components[key];
    if (v == null) return;
    scoreSum += v * w; scoreW += w;
  });
  const score = scoreW > 0 ? Math.round(Math.max(0, Math.min(100, scoreSum / scoreW))) : 50;
  const verdict = verdictForScore(score);

  // ── Commentaire genere ──
  const commentary = generateCommentary({
    sessionName: session.displayName || session.name, sessionTypeKey, score, verdict,
    volume, structure, plannedMainReps: structure.plannedMainReps, paceVerdict, deviationSecKm, regularity, pacingStrategy,
    hrVerdict, cardiacDrift, positives, improvements, paceLenient,
  });

  return {
    planKey: { weekId: week._id, trainingIndex: session.trainingIndex ?? 0 },
    activityId: String(activity.id),
    sessionSnapshot: {
      name: session.name, displayName: session.displayName || session.name,
      trainingCategory: session.trainingCategory, trainingType: session.trainingType, sport: session.sport,
      stats: session.stats || {}, paceZones: session.paceZones || [], exercisesBlocks: session.exercisesBlocks || [],
      weekDate: week.weekDate, isTrail, goalType,
    },
    activitySnapshot: {
      date: activity.date, name: activity.name, distanceKm: activity.distanceKm, durationSec: activity.durationSec,
      avgPaceSecPerKm: activity.avgPaceSecPerKm, avgHR: activity.avgHR, maxHR: activity.maxHR,
      elevationGain: activity.elevationGain, activityType: activity.activityType,
      // vO2MaxValue fige avec l'activite (voir getCorrectVma) : garantit que
      // "Recalculer" dans plusieurs mois retrouve exactement la meme VMA de
      // reference, meme si l'historique VO2max (_vo2maxSeries) n'est plus
      // charge ou ne couvre plus cette date.
      vO2MaxValue: activity.vO2MaxValue || null,
    },
    sessionTypeKey, score, verdict,
    volume, structure, paceAnalysis, reps, regularity, pacingStrategy, recovery, hr, cardiacDrift,
    coherenceNarrative, timeInZoneBreakdown, trail, anomalies, positives, improvements, commentary, timeline,
    pairingKey: computePairingKey(session),
  };
}

function regularityLabelFromDurations(durations) {
  if (durations.length < 2) return null;
  const ecart = Math.round(Math.max(...durations) - Math.min(...durations));
  return ecart <= 10 ? 'très régulières' : ecart <= 25 ? 'régulières' : 'irrégulières';
}

function detectPacingStrategy(paces) {
  if (!paces || paces.length < 2) return 'stable';
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mid = Math.floor(paces.length / 2);
  const diff = avg(paces.slice(mid)) - avg(paces.slice(0, mid)); // >0 = plus lent en 2e moitié
  const firstRepDelta = paces[0] - avg(paces.slice(1)); // <0 = 1er rep plus rapide que le reste
  if (Math.abs(diff) <= 5 && Math.abs(firstRepDelta) <= 5) return 'stable';
  if (firstRepDelta < -10) return 'went_out_fast';
  if (firstRepDelta > 10 && diff < 0) return 'cautious_start';
  return diff > 0 ? 'positive_split' : 'negative_split';
}

function computeCardiacDrift(laps) {
  const valid = laps.filter(l => l.averageSpeed > 0);
  if (valid.length < 4) return { firstHalfPace: null, secondHalfPace: null, firstHalfHR: null, secondHalfHR: null, driftPct: null, narrative: null };
  const mid = Math.floor(valid.length / 2);
  const first = valid.slice(0, mid), second = valid.slice(mid);
  const avgPace = arr => arr.reduce((s, l) => s + 1000 / l.averageSpeed, 0) / arr.length;
  const hrArr = arr => arr.filter(l => l.averageHR).map(l => l.averageHR);
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const firstHalfPace = avgPace(first), secondHalfPace = avgPace(second);
  const firstHalfHR = avg(hrArr(first)), secondHalfHR = avg(hrArr(second));
  let driftPct = null, narrative = null;
  if (firstHalfHR && secondHalfHR) {
    driftPct = Math.round(((secondHalfHR - firstHalfHR) / firstHalfHR) * 1000) / 10;
    narrative = Math.abs(driftPct) <= 4
      ? 'Votre fréquence cardiaque reste particulièrement stable pour cette durée d\'effort.'
      : driftPct > 0 ? 'Une dérive cardiaque apparaît dans la seconde partie de la séance.' : 'Votre fréquence cardiaque diminue en seconde partie de séance.';
  }
  return {
    firstHalfPace: Math.round(firstHalfPace), secondHalfPace: Math.round(secondHalfPace),
    firstHalfHR: firstHalfHR ? Math.round(firstHalfHR) : null, secondHalfHR: secondHalfHR ? Math.round(secondHalfHR) : null,
    driftPct, narrative,
  };
}

function computeCoherenceNarrative(paceVerdict, hrVerdict) {
  if (!paceVerdict || !hrVerdict) return null;
  if (paceVerdict === 'conforme' && hrVerdict === 'conforme') return 'Effort parfaitement maîtrisé : allure et fréquence cardiaque sont cohérentes avec l\'objectif de la séance.';
  if (paceVerdict === 'conforme' && hrVerdict === 'elevee') return 'Votre allure est conforme, mais votre fréquence cardiaque est supérieure à celle attendue — l\'effort semble avoir été plus coûteux que ce que laisse penser l\'allure.';
  if (paceVerdict === 'rapide' && hrVerdict === 'elevee') return 'Allure trop rapide et fréquence cardiaque élevée : la séance a probablement été réalisée à une intensité excessive.';
  if (paceVerdict === 'lente' && hrVerdict === 'elevee') return 'Allure plus lente que prévu mais fréquence cardiaque élevée — fatigue possible, chaleur, dénivelé ou conditions difficiles.';
  if (paceVerdict === 'rapide' && hrVerdict === 'conforme') return 'Votre allure est plus rapide que prévu, mais votre fréquence cardiaque reste dans la zone attendue — bon signe de forme, sans coût physiologique excessif.';
  if (paceVerdict === 'rapide' && hrVerdict === 'basse') return 'Vous avez couru plus vite que prévu avec une fréquence cardiaque basse — très bonne gestion physiologique de l\'effort.';
  if (paceVerdict === 'lente' && hrVerdict === 'conforme') return 'Allure plus lente que prévu mais fréquence cardiaque cohérente — rien d\'inquiétant, probablement une allure prudente.';
  if (paceVerdict === 'lente' && hrVerdict === 'basse') return 'Allure et fréquence cardiaque toutes deux en dessous de l\'attendu — marge de progression disponible pour la prochaine séance.';
  return null;
}

function generateCommentary(ctx) {
  const parts = [];
  if (ctx.score >= 85) parts.push(`Très bonne séance de type ${sessionTypeLabel(ctx.sessionTypeKey)}.`);
  else if (ctx.score >= 70) parts.push(`Séance globalement conforme (${sessionTypeLabel(ctx.sessionTypeKey)}).`);
  else parts.push(`Séance assez différente de ce qui était prévu (${sessionTypeLabel(ctx.sessionTypeKey)}).`);

  if (ctx.plannedMainReps > 0 && ctx.structure.actualMainReps != null) {
    parts.push(ctx.structure.actualMainReps >= ctx.plannedMainReps
      ? `Vous avez réalisé les ${ctx.plannedMainReps} répétitions prévues.`
      : `Seulement ${ctx.structure.actualMainReps} répétition(s) sur ${ctx.plannedMainReps} prévues.`);
  }
  if (ctx.paceVerdict === 'conforme') parts.push('L\'allure moyenne correspond à la cible.');
  else if (ctx.paceVerdict === 'rapide' && ctx.paceLenient) parts.push(`Vous avez couru ${Math.abs(ctx.deviationSecKm)}s/km plus vite que la cible, mais sans coût cardiaque excessif — bon signe de forme.`);
  else if (ctx.paceVerdict === 'rapide') parts.push(`Vous êtes parti plus vite que prévu (${Math.abs(ctx.deviationSecKm)}s/km sous la cible).`);
  else if (ctx.paceVerdict === 'lente') parts.push(`Votre allure est restée plus lente que la cible (+${ctx.deviationSecKm}s/km).`);

  if (ctx.pacingStrategy === 'went_out_fast') parts.push('Vous êtes parti nettement trop vite avant de ralentir sur la fin.');
  else if (ctx.pacingStrategy === 'positive_split') parts.push('Votre rythme a progressivement ralenti au fil de la séance.');
  else if (ctx.pacingStrategy === 'negative_split') parts.push('Vous avez accéléré en fin de séance.');
  else if (ctx.pacingStrategy === 'cautious_start') parts.push('Départ prudent suivi d\'une accélération progressive, bonne gestion de l\'effort.');

  if (ctx.hrVerdict === 'elevee') parts.push('Votre fréquence cardiaque a dépassé la zone attendue.');
  if (ctx.cardiacDrift?.narrative) parts.push(ctx.cardiacDrift.narrative);

  if (ctx.improvements.length) parts.push('À travailler la prochaine fois : ' + ctx.improvements[0].toLowerCase());

  return parts.join(' ');
}

function sessionTypeLabel(key) {
  const labels = { EF: 'endurance fondamentale', TEMPO: 'tempo', SEUIL: 'seuil', VMA: 'VMA', SORTIE_LONGUE: 'sortie longue', MARATHON_AS42: 'allure marathon', TRAIL: 'trail' };
  return labels[key] || key;
}

// ═══════════════════════════════════════════════════════
// COMPARAISON ENTRE SEANCES SIMILAIRES (§27, fonctionnalite bonus)
// ═══════════════════════════════════════════════════════
function findSimilarPastAnalyses(pairingKey, sessionTypeKey, excludeId) {
  if (!pairingKey) return null;
  const matches = (_analysisIndex.list || [])
    .filter(a => a.id !== excludeId && a.pairingKey === pairingKey && a.sessionTypeKey === sessionTypeKey)
    .sort((a, b) => new Date(b.activitySnapshot?.date || 0) - new Date(a.activitySnapshot?.date || 0));
  return matches[0] || null;
}

// Construit la note "comparé à votre séance similaire" en ne listant QUE les
// mesures disponibles des deux côtés — jamais un "— → —" qui n'apprend rien
// à l'utilisateur quand une donnée (ex: régularité, absente hors séances
// structurées) n'existe pas pour l'une des deux séances comparées.
function buildSimilarSessionNote(record, similar) {
  if (!similar) return '';
  const parts = [];
  const prevPace = similar.paceAnalysis?.[0]?.actualPaceSecKm;
  const currPace = record.paceAnalysis?.[0]?.actualPaceSecKm;
  if (prevPace && currPace) parts.push(`allure moyenne ${fmtPace(prevPace)} → ${fmtPace(currPace)}`);
  const prevReg = similar.regularity?.label;
  const currReg = record.regularity?.label;
  if (prevReg && currReg) parts.push(`régularité ${prevReg} → ${currReg}`);
  const prevHR = similar.hr?.avgHR;
  const currHR = record.hr?.avgHR;
  if (prevHR && currHR) parts.push(`FC moyenne ${prevHR} → ${currHR} bpm`);
  if (parts.length === 0 && similar.score != null && record.score != null) {
    parts.push(`score ${similar.score}% → ${record.score}%`);
  }
  if (parts.length === 0) return '';
  return `<div class="analysis-similar-note">Comparé à votre séance similaire du <strong>${fmtDate(similar.activitySnapshot?.date)}</strong> : ${parts.join(', ')}.</div>`;
}

function findWeekForDate(dateStr) {
  const t = new Date(dateStr).getTime();
  return (campusState.weeks || []).find(w => isNowInWeek(t, w.weekDate)) || null;
}

function isSessionAnalysable(session) {
  const isPPG = session.sport === 'ppg' || session.trainingCategory === 'gpp';
  const isComp = (session.trainingCategory || '').includes('competition');
  return !isPPG && !isComp;
}

// Bouton a inserer dans session-detail-actions (campus.js, renderSessionDetail) —
// identique pour plans importes ET plans Campus-synces (pas de condition sur
// usingImportedPlan, contrairement aux boutons fait/passe).
function renderSessionAnalysisButton(session, weekId) {
  if (!weekId || !isSessionAnalysable(session)) return '';
  const ti = session.trainingIndex ?? 0;
  const existing = _analysisIndex.bySession[_analysisSessionKey(weekId, ti)];
  if (existing) {
    return `<button type="button" class="btn-view-analysis" onclick="event.stopPropagation(); openStoredAnalysis('${existing.id}')">📊 Voir l'analyse (${existing.score}%)</button>`;
  }
  return `<button type="button" class="btn-link-analysis" onclick="event.stopPropagation(); openSessionLinkPicker('${weekId}', ${ti})">🔗 Analyser / Lier une activité</button>`;
}

// ═══════════════════════════════════════════════════════
// MODALE PICKER — depuis Entrainement (seance connue, choix de l'activite)
// ═══════════════════════════════════════════════════════
function _closeSessionAnalysisModals() {
  document.getElementById('session-link-picker-modal')?.remove();
  document.getElementById('session-analysis-result-modal')?.remove();
}

function openSessionLinkPicker(weekId, trainingIndex) {
  const week = (campusState.weeks || []).find(w => w._id === weekId);
  const session = week?.sessions?.find(s => (s.trainingIndex ?? 0) === Number(trainingIndex));
  if (!week || !session) { if (typeof showToast === 'function') showToast('Séance introuvable', 'error'); return; }

  _closeSessionAnalysisModals();
  const modal = document.createElement('div');
  modal.id = 'session-link-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:18px 20px 16px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      <div style="font-family:var(--font);font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:4px">Lier à une activité réalisée</div>
      <div style="font-family:var(--font-body);font-size:12px;color:var(--text-secondary);margin-bottom:14px">${session.displayName || session.name} — semaine du ${fmtWeekRange(week.weekDate)}</div>
      <div id="session-link-picker-list" style="font-family:var(--font-body);font-size:12.5px;color:var(--text-muted);padding:16px 0;text-align:center">Chargement…</div>
      <button id="session-link-picker-close" style="margin-top:14px;width:100%;padding:9px;border:1px solid var(--border);border-radius:9px;background:transparent;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;">Fermer</button>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#session-link-picker-close').addEventListener('click', close);
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);

  populateSessionLinkPickerList(week, weekId, trainingIndex);
}

async function _ensureYearActivitiesLoaded(year) {
  if (_fullyLoadedYears.has(year)) return;
  try {
    const resp = await fetch('/api/activities/year/' + year);
    if (resp.ok) {
      const data = await resp.json();
      if (data.activities && data.activities.length) {
        _allActivities = _allActivities.filter(a => {
          const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
          return isNaN(d) || d.getFullYear() !== year;
        }).concat(data.activities);
      }
      _fullyLoadedYears.add(year);
    }
  } catch (e) { /* silencieux, la liste sera juste incomplete */ }
}

function _candidateActivitiesForWeek(week) {
  const weekStart = startOfDay(week.weekDate);
  const weekEnd = weekStart + 7 * 86400000;
  return (_allActivities || []).filter(a => {
    const t = (a.activityType || '').toLowerCase();
    if (!(t.includes('run') || t.includes('trail'))) return false;
    const d = startOfDay(new Date(a.date).getTime());
    if (!(d >= weekStart && d < weekEnd)) return false;
    if (_analysisIndex.byActivity[String(a.id)]) return false; // deja liee a une autre seance
    return true;
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function _renderActivityPickerRow(a, onPick) {
  const row = document.createElement('div');
  row.className = 'session-link-picker-row';
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 8px;border-bottom:1px solid var(--border-light);';
  row.innerHTML = `
    <div>
      <div style="font-family:var(--font-body);font-weight:600;font-size:13px;color:var(--text-primary)">${a.name || 'Activité'}</div>
      <div style="font-family:var(--font-body);font-size:11.5px;color:var(--text-secondary)">${formatDateShort(a.date, true)} · ${a.distanceKm ? a.distanceKm.toFixed(2)+' km' : '—'} · ${fmtDuration(a.durationSec)} · ${fmtPace(a.avgPaceSecPerKm)}</div>
    </div>
    <button type="button" style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:1px solid var(--brand-green);background:var(--brand-green);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Lier &amp; analyser</button>`;
  row.querySelector('button').addEventListener('click', () => onPick(a));
  return row;
}

async function populateSessionLinkPickerList(week, weekId, trainingIndex) {
  const listEl = document.getElementById('session-link-picker-list');
  if (!listEl) return;
  const year = new Date(startOfDay(week.weekDate)).getFullYear();
  await _ensureYearActivitiesLoaded(year);

  const candidates = _candidateActivitiesForWeek(week);
  if (!document.getElementById('session-link-picker-list')) return; // modale fermee entre-temps
  if (candidates.length === 0) {
    listEl.innerHTML = 'Aucune activité de course disponible cette semaine-là.';
    return;
  }
  listEl.style.textAlign = '';
  listEl.innerHTML = '';
  candidates.forEach(a => listEl.appendChild(_renderActivityPickerRow(a, act => linkSessionToActivity(weekId, trainingIndex, act.id))));
}

async function linkSessionToActivity(weekId, trainingIndex, activityId) {
  const week = (campusState.weeks || []).find(w => w._id === weekId);
  const session = week?.sessions?.find(s => (s.trainingIndex ?? 0) === Number(trainingIndex));
  const activity = (_allActivities || []).find(a => String(a.id) === String(activityId));
  if (!week || !session || !activity) { if (typeof showToast === 'function') showToast('Données introuvables', 'error'); return; }

  const listEl = document.getElementById('session-link-picker-list');
  if (listEl) listEl.innerHTML = '<div style="padding:20px 0;text-align:center;font-family:var(--font-body);font-size:12.5px;color:var(--text-muted)">Analyse en cours…</div>';

  try {
    const record = await buildSessionAnalysis(session, week, activity);
    const resp = await fetch('/api/session-analyses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
    });
    const body = await resp.json();
    if (!resp.ok) {
      if (typeof showToast === 'function') showToast(body.error || 'Erreur de liaison', 'error');
      if (listEl) populateSessionLinkPickerList(week, weekId, trainingIndex);
      return;
    }
    await loadAnalysisIndex();
    _closeSessionAnalysisModals();
    if (typeof renderSessionList === 'function' && campusState.selectedWeekIdx > -1) renderSessionList(campusState.selectedWeekIdx);
    openAnalysisModal(body.analysis);
  } catch (e) {
    console.error('linkSessionToActivity:', e);
    if (typeof showToast === 'function') showToast('Erreur pendant l\'analyse', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// MODALE PICKER — depuis Activites (activite connue, choix de la seance)
// ═══════════════════════════════════════════════════════
function openActivityLinkPicker(activity) {
  const week = findWeekForDate(activity.date);
  if (!week) { if (typeof showToast === 'function') showToast('Aucune semaine de plan ne correspond à la date de cette activité.', 'info'); return; }
  const weekId = week._id;
  const eligible = (week.sessions || []).filter(s => isSessionAnalysable(s) && !_analysisIndex.bySession[_analysisSessionKey(weekId, s.trainingIndex ?? 0)]);

  _closeSessionAnalysisModals();
  const modal = document.createElement('div');
  modal.id = 'session-link-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:18px 20px 16px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      <div style="font-family:var(--font);font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:4px">Lier à une séance du plan</div>
      <div style="font-family:var(--font-body);font-size:12px;color:var(--text-secondary);margin-bottom:14px">${activity.name || 'Activité'} — semaine du ${fmtWeekRange(week.weekDate)}</div>
      <div id="session-link-picker-list"></div>
      <button id="session-link-picker-close" style="margin-top:14px;width:100%;padding:9px;border:1px solid var(--border);border-radius:9px;background:transparent;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;">Fermer</button>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#session-link-picker-close').addEventListener('click', close);
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);

  const listEl = modal.querySelector('#session-link-picker-list');
  if (eligible.length === 0) {
    listEl.innerHTML = '<div style="font-family:var(--font-body);font-size:12.5px;color:var(--text-muted);padding:16px 0;text-align:center">Aucune séance disponible cette semaine-là (déjà liées ou non analysables).</div>';
    return;
  }
  eligible.forEach(s => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 8px;border-bottom:1px solid var(--border-light);';
    row.innerHTML = `
      <div>
        <div style="font-family:var(--font-body);font-weight:600;font-size:13px;color:var(--text-primary)">${s.displayName || s.name}</div>
        <div style="font-family:var(--font-body);font-size:11.5px;color:var(--text-secondary)">${getCategoryStyle(s.trainingCategory).label}</div>
      </div>
      <button type="button" style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:1px solid var(--brand-green);background:var(--brand-green);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Lier &amp; analyser</button>`;
    row.querySelector('button').addEventListener('click', () => linkSessionToActivity(weekId, s.trainingIndex ?? 0, activity.id));
    listEl.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════
// MODALE RESULTATS (§24) + reouverture
// ═══════════════════════════════════════════════════════
function _rowIcon(ok) { return ok ? '✅' : '⚠️'; }

// Deroule visuel de la seance (barre segmentee proportionnelle a la duree
// de chaque phase), meme principe que la vue "phases" de Garmin Connect :
// rouge = echauffement, bleu = effort, gris = recuperation.
const TIMELINE_COLORS = { warmup: '#ef4444', effort: '#3b82f6', rest: '#94a3b8' };
const TIMELINE_LABELS = { warmup: 'Échauffement', effort: 'Effort', rest: 'Récupération' };
function _escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function buildTimelineHtml(timeline) {
  if (!timeline || !timeline.length) return '';
  const total = timeline.reduce((s, seg) => s + seg.durationSec, 0);
  if (!total) return '';
  const bar = timeline.map(seg => {
    const pct = (seg.durationSec / total) * 100;
    const title = `${TIMELINE_LABELS[seg.type] || seg.type} — ${describeDuration(seg.durationSec)}`
      + (seg.paceSecKm ? ` · ${fmtPace(seg.paceSecKm)}/km` : '')
      + (seg.hr ? ` · ${seg.hr} bpm` : '');
    return `<div class="analysis-timeline-seg" style="flex:${pct} 0 auto;background:${TIMELINE_COLORS[seg.type] || TIMELINE_COLORS.effort}" title="${_escapeAttr(title)}"></div>`;
  }).join('');
  const legend = Object.keys(TIMELINE_LABELS)
    .filter(k => timeline.some(s => s.type === k))
    .map(k => `<span class="analysis-timeline-legend-item"><span class="analysis-timeline-dot" style="background:${TIMELINE_COLORS[k]}"></span>${TIMELINE_LABELS[k]}</span>`)
    .join('');
  return `
    <div class="analysis-section-title">Déroulé de la séance</div>
    <div class="analysis-timeline-bar">${bar}</div>
    <div class="analysis-timeline-legend">${legend}</div>`;
}

function repClassificationLabel(c) {
  const map = { too_fast: '⚠ Trop rapide', slightly_fast: '⚠ Rapide', on_target: '✅ Cible', slightly_slow: '⚠ Lent', too_slow: '⚠ Trop lent' };
  return map[c] || '—';
}

function buildAnalysisModalHtml(record) {
  const s = record.sessionSnapshot, a = record.activitySnapshot;
  const isTrail = record.sessionTypeKey === 'TRAIL' && record.trail;
  const rows = [];

  if (a.distanceKm != null || s.stats?.expectedDistance != null) {
    rows.push({ label: 'Distance', planned: s.stats?.expectedDistance ? s.stats.expectedDistance.toFixed(2) + ' km' : '—', actual: a.distanceKm ? a.distanceKm.toFixed(2) + ' km' : '—', ok: record.volume.verdict !== 'plus_court' && record.volume.verdict !== 'plus_long' });
  }
  if (a.durationSec != null || s.stats?.expectedDuration != null) {
    rows.push({ label: 'Durée', planned: s.stats?.expectedDuration ? fmtDuration(s.stats.expectedDuration) : '—', actual: a.durationSec ? fmtDuration(a.durationSec) : '—', ok: record.volume.verdict !== 'plus_court' && record.volume.verdict !== 'plus_long' });
  }
  if (record.structure.plannedMainReps) {
    rows.push({ label: 'Répétitions', planned: String(record.structure.plannedMainReps), actual: record.structure.actualMainReps != null ? String(record.structure.actualMainReps) : '—', ok: record.structure.actualMainReps >= record.structure.plannedMainReps });
  }
  if (record.paceAnalysis.length) {
    const p = record.paceAnalysis[0];
    rows.push({ label: 'Allure', planned: `${fmtPace(p.targetPaceMin)} – ${fmtPace(p.targetPaceMax)}/km`, actual: p.actualPaceSecKm ? fmtPace(p.actualPaceSecKm) + '/km' : '—', ok: p.deviationSecKm == null || Math.abs(p.deviationSecKm) <= 10, muted: isTrail });
  }
  if (record.hr) {
    const band = record.hr.approxTargetBand;
    rows.push({ label: 'FC', planned: band ? `~${band.low}-${band.high} bpm` : '—', actual: `${record.hr.avgHR} bpm`, ok: !band || record.hr.avgHR <= band.high });
  }

  const summaryRowsHtml = rows.map(r => `
    <div class="analysis-summary-row${r.muted ? ' analysis-summary-row--muted' : ''}">
      <span class="analysis-summary-label">${r.label}</span>
      <span class="analysis-summary-values"><span class="analysis-summary-planned">${r.planned}</span> → <span class="analysis-summary-actual">${r.actual}</span></span>
      <span class="analysis-summary-icon">${_rowIcon(r.ok)}</span>
    </div>`).join('');

  const trailRowHtml = isTrail ? `
    <div class="analysis-summary-row">
      <span class="analysis-summary-label">Dénivelé (D+)</span>
      <span class="analysis-summary-values"><span class="analysis-summary-planned">${record.trail.plannedDPlusM ? Math.round(record.trail.plannedDPlusM) + ' m' : '—'}</span> → <span class="analysis-summary-actual">${record.trail.actualDPlusM ? Math.round(record.trail.actualDPlusM) + ' m' : '—'}${record.trail.vamMPerH ? ' · VAM ' + record.trail.vamMPerH + ' m/h' : ''}</span></span>
      <span class="analysis-summary-icon">${_rowIcon(record.trail.deltaPct == null || Math.abs(record.trail.deltaPct) <= 15)}</span>
    </div>` : '';

  const repsTableHtml = record.reps.length ? `
    <div class="analysis-section-title">Répétitions</div>
    <table class="analysis-reps-table">
      <thead><tr><th>#</th><th>Cible</th><th>Réalisé</th><th>Analyse</th></tr></thead>
      <tbody>${record.reps.map(r => `
        <tr>
          <td>${r.index}</td>
          <td>${(r.targetPaceMinSecKm && r.targetPaceMaxSecKm) ? (fmtPace(r.targetPaceMinSecKm) + '–' + fmtPace(r.targetPaceMaxSecKm)) : '—'}</td>
          <td>${r.actualPaceSecKm ? fmtPace(r.actualPaceSecKm) : '—'}</td>
          <td>${repClassificationLabel(r.classification)}</td>
        </tr>`).join('')}</tbody>
    </table>` : '';

  const positivesHtml = record.positives.length ? `
    <div class="analysis-section-title">Points positifs</div>
    <ul class="analysis-list analysis-list--positive">${record.positives.map(p => `<li>✓ ${p}</li>`).join('')}</ul>` : '';

  const improvementsHtml = record.improvements.length ? `
    <div class="analysis-section-title">À améliorer</div>
    <ul class="analysis-list analysis-list--improve">${record.improvements.map(p => `<li>→ ${p}</li>`).join('')}</ul>` : '';

  const similar = findSimilarPastAnalyses(record.pairingKey, record.sessionTypeKey, record.id);
  const similarHtml = buildSimilarSessionNote(record, similar);
  const timelineHtml = buildTimelineHtml(record.timeline);

  return `
    <div class="analysis-modal-header">
      <div class="analysis-modal-title">${s.displayName}</div>
      <div class="analysis-modal-score">${record.verdict.emoji} <strong>${record.score}%</strong> — ${record.verdict.label}</div>
    </div>
    <div class="analysis-summary-block">${summaryRowsHtml}${trailRowHtml}</div>
    ${timelineHtml}
    ${repsTableHtml}
    ${positivesHtml}
    ${improvementsHtml}
    ${record.coherenceNarrative ? `<div class="analysis-coherence-note">${record.coherenceNarrative}</div>` : ''}
    <div class="analysis-commentary">${record.commentary}</div>
    ${similarHtml}
  `;
}

function openAnalysisModal(record) {
  _closeSessionAnalysisModals();
  const modal = document.createElement('div');
  modal.id = 'session-analysis-result-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:20px 22px 18px;width:100%;max-width:640px;max-height:88vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      ${buildAnalysisModalHtml(record)}
      <div style="display:flex;gap:10px;margin-top:16px">
        <button id="session-analysis-recalc" class="btn-analysis-recalc" title="Refaire le calcul (utile si le moteur d'analyse a evolue depuis la liaison)">🔄 Recalculer</button>
        <button id="session-analysis-unlink" class="btn-analysis-unlink">Délier cette activité</button>
        <button id="session-analysis-close" class="btn-analysis-close-modal">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#session-analysis-close').addEventListener('click', close);
  modal.querySelector('#session-analysis-unlink').addEventListener('click', () => unlinkAnalysis(record.id, close));
  modal.querySelector('#session-analysis-recalc').addEventListener('click', () => recalculateAnalysis(record));
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);
}

// Recalcule une analyse existante avec le moteur actuel (utile apres une
// evolution du moteur, ou si le profil/VO2max de l'utilisateur a change
// depuis la liaison initiale) — reutilise les instantanes stockes (seance +
// activite), pas besoin de re-choisir quoi que ce soit.
async function recalculateAnalysis(record) {
  try {
    const week = { _id: record.planKey.weekId, weekDate: record.sessionSnapshot.weekDate };
    const session = { ...record.sessionSnapshot, trainingIndex: record.planKey.trainingIndex };
    const activity = { id: record.activityId, ...record.activitySnapshot };
    const fresh = await buildSessionAnalysis(session, week, activity);
    const resp = await fetch('/api/session-analyses/' + record.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fresh),
    });
    const body = await resp.json();
    if (!resp.ok) { if (typeof showToast === 'function') showToast(body.error || 'Erreur de recalcul', 'error'); return; }
    await loadAnalysisIndex();
    if (typeof renderSessionList === 'function' && campusState.selectedWeekIdx > -1) renderSessionList(campusState.selectedWeekIdx);
    openAnalysisModal(body.analysis);
    if (typeof showToast === 'function') showToast('Analyse recalculée', 'success');
  } catch (e) {
    console.error('recalculateAnalysis:', e);
    if (typeof showToast === 'function') showToast('Erreur pendant le recalcul', 'error');
  }
}

async function openStoredAnalysis(id) {
  let record = (_analysisIndex.list || []).find(a => a.id === id);
  if (!record) {
    try {
      const res = await fetch('/api/session-analyses');
      if (res.ok) { _rebuildAnalysisIndex(await res.json()); record = (_analysisIndex.list || []).find(a => a.id === id); }
    } catch (e) {}
  }
  if (!record) { if (typeof showToast === 'function') showToast('Analyse introuvable', 'error'); return; }
  openAnalysisModal(record);
}

async function unlinkAnalysis(id, afterClose) {
  let ok = true;
  if (typeof showConfirmModal === 'function') {
    ok = await showConfirmModal({ title: 'Délier cette activité ?', message: 'L\'analyse sera supprimée. Vous pourrez relier une autre activité à cette séance.', confirmLabel: 'Délier', danger: true });
  }
  if (!ok) return;
  try {
    await fetch('/api/session-analyses/' + id, { method: 'DELETE' });
    await loadAnalysisIndex();
    if (typeof renderSessionList === 'function' && campusState.selectedWeekIdx > -1) renderSessionList(campusState.selectedWeekIdx);
    if (typeof afterClose === 'function') afterClose();
    if (typeof showToast === 'function') showToast('Activité déliée', 'success');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Erreur lors de la déliaison', 'error');
  }
}

// ═══════════════════════════════════════════════════════
// Integration page Activites (badge + bouton, app.js)
// ═══════════════════════════════════════════════════════
function activityAnalysisBadge(activityId) {
  const rec = _analysisIndex.byActivity[String(activityId)];
  return rec ? ` <span class="activity-analysis-badge" title="Séance analysée — clic pour voir">📊</span>` : '';
}

function renderActivityAnalysisButtons(activity) {
  const existing = _analysisIndex.byActivity[String(activity.id)];
  if (existing) {
    return `<button type="button" class="activity-link" id="btn-view-session-analysis" style="cursor:pointer">📊 Voir l'analyse (${existing.score}%)</button>`;
  }
  const t = (activity.activityType || '').toLowerCase();
  if (!(t.includes('run') || t.includes('trail'))) return '';
  if (!findWeekForDate(activity.date)) return '';
  return `<button type="button" class="activity-link" id="btn-link-session-analysis" style="cursor:pointer">🔗 Lier à une séance</button>`;
}

function wireActivityAnalysisButtons(activity) {
  const viewBtn = document.getElementById('btn-view-session-analysis');
  if (viewBtn) {
    const existing = _analysisIndex.byActivity[String(activity.id)];
    if (existing) viewBtn.onclick = () => openStoredAnalysis(existing.id);
  }
  const linkBtn = document.getElementById('btn-link-session-analysis');
  if (linkBtn) linkBtn.onclick = () => openActivityLinkPicker(activity);
}
