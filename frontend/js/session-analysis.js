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

// VO2max GARMIN tel qu'il etait AVANT une date donnee (jamais le VO2max
// actuel, ni celui du jour meme — voir getCorrectVma pour le pourquoi).
// _vo2maxSeries vient de l'historique quotidien officiel Garmin (un point
// par JOUR calendaire, deja trie croissant par date — cf. loadDashboard/
// server.js /api/dashboard), donc l'entree du jour J peut deja integrer le
// recalcul declenche PAR une activite de ce meme jour J. On exclut donc
// deliberement le jour de l'activite elle-meme et on ne garde que la
// derniere valeur connue d'un jour STRICTEMENT anterieur.
function getHistoricalVo2Max(dateStr) {
  if (typeof _vo2maxSeries === 'undefined' || !_vo2maxSeries.length) return null;
  const activityDay = String(dateStr).slice(0, 10); // 'YYYY-MM-DD' depuis 'YYYY-MM-DDTHH:mm:ss...'
  let best = null;
  for (const entry of _vo2maxSeries) {
    if (entry.date < activityDay) best = entry;
    else break; // serie triee croissant par date
  }
  return best ? best.value : null;
}

// VMA calibree utilisateur AU DEBUT DE L'ACTIVITE analysee (pas apres, pas
// la VMA actuelle). Essentiel pour l'analyse seance prevue/realisee : la
// seance doit etre jugee avec la forme du coureur AU MOMENT ou elle a
// commence, jamais avec sa forme actuelle — sinon rouvrir ou recalculer une
// vieille analyse des mois plus tard changerait silencieusement les allures
// cibles en fonction des progres (ou regressions) faits entre-temps.
//
// Priorite : 1) l'historique VO2max officiel Garmin (getHistoricalVo2Max) A
// LA VEILLE de l'activite (jour STRICTEMENT anterieur, jamais le jour meme —
// voir sa doc) ; 2) a defaut (aucun historique ne couvre encore cette
// periode — activite trop ancienne, ou tout premier jour suivi), repli sur
// activity.vO2MaxValue ; 3) a defaut, VO2max actuel.
//
// NE PAS remonter la priorite de activity.vO2MaxValue au-dessus de
// l'historique : ce champ est l'estimation Garmin issue du RECALCUL fait a
// partir de cette activite meme (le \"jour ou l'activite a declenche une
// mise a jour\"), donc il reflete l'etat APRES la seance, pas celui prevu au
// depart — bug reel constate (compte de l'epouse, seance cote S04-03 Free
// Solo) : VO2max 45.9 avant la seance -> allures cibles S60 annoncees pour
// 45.9 (5'30-5'42/km), puis 45.8 juste apres synchro (le S60 recalcule sur
// 45.8 aurait alors ete compare a tort, 5'33-5'45/km ajuste trail). Le
// meme biais explique pourquoi /api/dashboard (server.js) a deja bascule sa
// propre courbe VO2max sur cet historique officiel plutot que sur le champ
// par-activite (\"une sortie donnee n'est pas forcement celle qui declenche
// le recalcul Garmin d'un jour donne\") — ici on applique la meme logique,
// en plus du decalage temporel (veille, pas jour meme).
// NE PAS reutiliser getVmaFromState() (campus.js) ici : cette fonction
// partagee inverse la priorite (Campus d'abord) pour ses propres besoins
// (estimation fin de plan), ce qui donnerait ici une allure cible
// incoherente avec celle deja affichee sur la fiche de seance — exactement
// l'erreur que CLAUDE.md interdit ("ne jamais utiliser les allures
// historiques de Campus").
// VO2max Garmin tel qu'il etait juste APRES la DERNIERE seance CAP/Trail qui
// precede celle analysee (peu importe le jour) — vO2MaxValue sur une
// activite reflete l'etat APRES le recalcul qu'ELLE a declenche (voir
// getCorrectVma), donc celui de la derniere sortie course/trail precedente
// est la meilleure estimation disponible de "la valeur juste avant" la
// seance analysee : plus precis qu'une simple veille calendaire
// (getHistoricalVo2Max) quand le VO2max change LE JOUR MEME de la seance,
// entre son debut et sa fin (bug reel constate : seance seuil dont le VO2max
// Garmin passe de 47.5 a 47.8 entre le debut et la fin de CETTE MEME seance
// — la veille calendaire ne suffit pas a isoler ce cas). Restreint aux
// activites CAP/Trail (activityType contenant "run", couvre aussi
// trail_running/track_running/treadmill_running) : Garmin calcule un VO2max
// DIFFERENT par sport (course vs velo...), donc une activite non-course
// juste avant (marche, velo, PPG...) ne porte pas la bonne valeur meme si
// son champ vO2MaxValue est renseigne (retour utilisateur : le 1er essai qui
// prenait n'importe quelle activite precedente donnait encore un resultat
// different de l'attendu). _allActivities (app.js) est deja triee par Garmin
// la plus recente en premier, donc on cherche la plus RECENTE activite
// CAP/Trail strictement anterieure, pas juste la premiere du tableau.
function getPrevActivityVo2Max(activity) {
  if (typeof _allActivities === 'undefined' || !_allActivities.length || !activity?.date) return null;
  const t = new Date(activity.date).getTime();
  const activityId = activity.id != null ? String(activity.id) : null;
  let best = null, bestT = -Infinity;
  for (const a of _allActivities) {
    if (a.vO2MaxValue == null || !a.date) continue;
    if (activityId != null && String(a.id) === activityId) continue;
    if (!(a.activityType || '').toLowerCase().includes('run')) continue;
    const at = new Date(a.date).getTime();
    if (at < t && at > bestT) { bestT = at; best = a.vO2MaxValue; }
  }
  return best;
}

// Instantane quotidien du VO2max capture par Allure+ lui-meme
// (captureHealthSnapshot('vo2max', ...), server.js, appele a CHAQUE
// chargement du dashboard) — un seul instantane GARDE par jour calendaire, le
// PREMIER vu ce jour-la (ecriture ignoree si une entree existe deja pour
// cette date, cf server.js captureHealthSnapshot). On prend la valeur de la
// VEILLE de l'activite (jour STRICTEMENT anterieur), jamais celle du jour
// meme : le "premier instantane du jour" peut tres bien avoir ete capture
// APRES la seance elle-meme (ex : premiere ouverture de l'app ce jour-la
// faite pour consulter l'analyse juste apres avoir couru), auquel cas il
// porterait deja la valeur post-seance — retour utilisateur (03/09) confirme
// par les donnees reelles (data/health_snapshots.json) : l'instantane du jour
// de la seance valait deja 47.8 (post-seance), celui de la VEILLE valait
// 47.5, exactement la valeur qui redonne la cible 5'00-5'11 realement
// affichee ce matin-la sur la page Entrainement (verifie : S60 84-87% VMA,
// VMA(47.5)=13.77km/h -> 5'00-5'11/km au sec pres). Priorite la plus haute
// dans getCorrectVma : plus fiable que l'historique Garmin officiel
// (_vo2maxSeries/getHistoricalVo2Max), qui s'est avere donner une valeur
// encore trop proche du post-seance sur ce meme cas reel (4'58-5'08) — et que
// la derniere sortie CAP/Trail precedente (getPrevActivityVo2Max), trop
// ancienne pour refleter la progression recente (5'04-5'15 sur ce meme cas).
let _vo2maxDailySnapshotsPromise = null;
function fetchVo2maxDailySnapshots() {
  if (!_vo2maxDailySnapshotsPromise) {
    _vo2maxDailySnapshotsPromise = fetch('/api/health-history/vo2max')
      .then(res => res.ok ? res.json() : [])
      .catch(() => []);
  }
  return _vo2maxDailySnapshotsPromise;
}
async function getAppSnapshotVo2MaxBeforeDay(dateStr) {
  if (!dateStr) return null;
  const activityDay = String(dateStr).slice(0, 10);
  const snapshots = await fetchVo2maxDailySnapshots();
  if (!snapshots || !snapshots.length) return null;
  let best = null;
  for (const entry of snapshots) { // deja trie croissant par date (cf server.js)
    if (entry.date < activityDay) best = entry; else break;
  }
  if (!best) return null;
  const v = best.value;
  return (v && typeof v === 'object') ? (v.precise ?? v.vo2max ?? null) : (v ?? null);
}

async function getCorrectVma(activity) {
  const vo2 = await getAppSnapshotVo2MaxBeforeDay(activity?.date)
    || getPrevActivityVo2Max(activity)
    || (activity?.date ? getHistoricalVo2Max(activity.date) : null)
    || activity?.vO2MaxValue
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
  const vma = await getCorrectVma(activity);

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

  // Classification effort/repos/echauffement par lap (Garmin intensityType en
  // priorite, sinon heuristiques position/vitesse) — calculee ici (avant le
  // bloc trail/GAP juste en dessous) car les deux en ont besoin : le trail
  // pour isoler les laps d'effort du GAP moyen (voir plus bas), le chemin
  // repetitions plus loin pour les tableaux effort/recup.
  const types = laps.length ? classifyLaps(laps) : [];

  // ── Trail : pente reelle & effort (GAP) ──
  // GAP moyen : directement depuis les laps Garmin (avgGradeAdjustedSpeed) —
  // c'est exactement le meme chiffre que la colonne "GAP moyenne" affichee
  // par Garmin Connect sur les circuits, fiable a l'echelle du lap.
  // Pourquoi comparer le GAP a la cible NON ajustee (calcAllureRef, pas
  // calcAllureRefTrail) : la cible "ajustee" (trailRowHtml/ligne Allure) est
  // deja la cible plate majoree d'un forfait fixe (+7%/+8%, cf. trailCorr
  // dans campus.js) pour anticiper le terrain — un GAP (deja normalise
  // terrain par Garmin) compare a cette cible DEJA majoree compterait
  // l'ajustement deux fois et ferait paraitre l'allure "trop rapide" a tort
  // (cas verifie avec l'utilisateur sur "Sortie Longue" du 16/08 : GAP moyen
  // ~7'00/km bien dans la cible plate 6'18-7'08, alors que l'allure brute
  // 7'57/km sortait de la cible ajustee 6'44-7'37 et declenchait une fausse
  // alerte). La ligne "Allure" (brute vs ajustee) reste affichee telle
  // quelle par ailleurs, mutee, pour donner une idee du temps reel passe.
  let climbAnalysis = null;
  if (isTrail && laps.length) {
    // Sur une seance a repetitions (ex: 3x6' en cote), moyenner le GAP sur
    // TOUS les laps dilue l'effort reel avec les footings de recuperation
    // entre repetitions (souvent 2 a 3x plus lents) — constat reel : 3
    // repetitions a GAP ~5'05/km chacune, mais une moyenne globale annoncee a
    // 6'09/km a cause des laps de recup inclus dedans. Restreindre aux laps
    // classes 'effort' (types, calcule juste au-dessus) dans ce cas. Sur une
    // seance continue (sortie longue en D+, pas de repetitions), tous les
    // laps SONT l'effort (pas de recup a exclure) — garder la moyenne sur
    // l'ensemble, comportement deja valide avec l'utilisateur (cas du 16/08).
    // Pondere par le temps de DEPLACEMENT (pas elapsed) : un lap contenant un
    // arret (ex: photo, pause) a sinon un poids artificiellement gonfle dans
    // la moyenne alors que ce temps d'arret ne reflete aucun effort au GAP de
    // ce lap - retour utilisateur 29/08, constate concretement sur cette
    // meme sortie (un lap avec elapsedDuration=892s / movingDuration=698s,
    // soit 194s d'arret, etait aussi le lap au GAP le plus lent : le ponderer
    // par elapsed tirait a tort la moyenne globale vers le bas).
    const gapLaps = laps
      .map((l, idx) => ({ durSec: l.movingDuration || l.elapsedDuration || l.duration || 0, gapMps: l.avgGradeAdjustedSpeed > 0 ? l.avgGradeAdjustedSpeed : null, isEffort: types[idx] === 'effort' }))
      .filter(l => l.durSec > 0 && l.gapMps != null && (!hasStructuredReps || l.isEffort));
    const gapTotalSec = gapLaps.reduce((s, l) => s + l.durSec, 0);
    // Moyenne HARMONIQUE (temps total / distance-equivalente-GAP totale), PAS
    // une moyenne arithmetique des allures par lap ponderee par la duree :
    // moyenner des allures (secondes/km, l'inverse d'une vitesse) ecrase le
    // resultat vers les laps les plus lents au lieu de refleter la vitesse
    // moyenne reelle - piege statistique classique (les vitesses s'additionnent
    // correctement en moyenne ponderee, pas leurs inverses). Retour
    // utilisateur 29/08 : l'ecart entre "Allure moy. en deplacement" et
    // "Allure moy. ajustee a la pente" semblait bien trop faible pour une
    // sortie a +12.9% de pente moyenne en cote - verifie sur cette meme
    // sortie : la moyenne arithmetique donnait 524s/km (8'44"), la moyenne
    // harmonique 492s/km (8'12"), bien plus coherente et proche de Garmin (8:19).
    const gapTotalEquivM = gapLaps.reduce((s, l) => s + l.gapMps * l.durSec, 0);
    const gapAvgSecKm = (gapTotalSec > 0 && gapTotalEquivM > 0) ? gapTotalSec / (gapTotalEquivM / 1000) : null;
    const flatPaceRange = (mainZoneKey && vma) ? calcAllureRef(mainZoneKey, vma) : null;

    let gapDeviationSecKm = null, gapVerdict = null;
    if (flatPaceRange && gapAvgSecKm != null) {
      if (gapAvgSecKm > flatPaceRange.paceMax) gapDeviationSecKm = Math.round(gapAvgSecKm - flatPaceRange.paceMax);
      else if (gapAvgSecKm < flatPaceRange.paceMin) gapDeviationSecKm = Math.round(gapAvgSecKm - flatPaceRange.paceMin);
      else gapDeviationSecKm = 0;
      gapVerdict = Math.abs(gapDeviationSecKm) <= 10 ? 'conforme' : gapDeviationSecKm < 0 ? 'rapide' : 'lente';
    }

    // Pente reelle / FC cote-vs-plat : PAS depuis les laps (1km, voire plus)
    // — un lap entier dilue une cote courte et repetee (ex: 320m pour 45m de
    // D+, ~14%) en une pente nette quasi nulle des que le reste du lap
    // redescend ou est plat (constat utilisateur : 3.9% affiche au lieu de
    // ~14% reel). Recalcule a partir de la trace GPS fine de l'activite
    // (points espaces de quelques metres a quelques dizaines de metres),
    // regroupee en tronçons de ~50m — cf. computeGradeSegments.
    let gradeStats = null, movementSplit = null;
    try {
      const gpsRes = await fetch(`/api/activity/${activity.id}/gps`);
      if (gpsRes.ok) {
        const { elevation } = await gpsRes.json();
        gradeStats = computeGradeSegments(elevation);
        movementSplit = computeMovementSplit(elevation);
      }
    } catch (e) { /* pas de trace GPS -> pas de detail pente/FC cote-plat ni detection course/marche, GAP reste dispo */ }

    if (gapAvgSecKm != null || gradeStats) {
      climbAnalysis = {
        avgGradePctClimb: gradeStats?.avgGradePctClimb ?? null,
        maxGradePct: gradeStats?.maxGradePct ?? null,
        pctDistanceClimbing: gradeStats?.pctDistanceClimbing ?? null,
        hrClimb: gradeStats?.hrClimb ?? null,
        hrFlat: gradeStats?.hrFlat ?? null,
        climbs: gradeStats?.climbs ?? [],
        gapAvgSecKm: gapAvgSecKm != null ? Math.round(gapAvgSecKm) : null,
        flatPaceRange, gapDeviationSecKm, gapVerdict,
        movementSplit,
      };
    }
  }

  const circuits = laps.length ? isKmCircuits(laps) : false;
  const useRepsPath = hasStructuredReps && !circuits && laps.length > 0;

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
  // La classification par lap (types) ne reflete une VRAIE structure que si
  // le plan prevoit lui-meme un echauffement/retour au calme/repetitions —
  // sur une seance continue (ex: sortie longue) sans variation d'allure
  // prevue, classifyLaps colore quand meme le 1er/dernier lap par simple
  // position (regle de classifyLaps) : sans ce garde-fou, la barre affiche a
  // tort 3 couleurs alors que rien de different n'etait prevu.
  const hasPlannedStructure = plannedWarmupSec > 0 || plannedCooldownSec > 0 || hasStructuredReps;
  const timeline = laps.map((lap, idx) => {
    const durationSec = lap.elapsedDuration || lap.movingDuration || lap.duration || 0;
    const paceSecKm = lap.averageSpeed > 0 ? Math.round(1000 / lap.averageSpeed) : null;
    return { type: hasPlannedStructure ? (types[idx] || 'effort') : 'effort', durationSec, paceSecKm, hr: lap.averageHR ? Math.round(lap.averageHR) : null };
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
  // Ecart par rapport a la borne la plus proche de la plage cible, jamais par
  // rapport a son milieu : une allure DANS la plage n'est pas un ecart (0),
  // et une allure hors plage n'est en retard/avance que de ce qui depasse la
  // borne franchie (ex: plage 6'44-7'37/km, allure reelle 7'54/km -> ecart de
  // 17s/km sous la borne lente 7'37, pas ~35s/km sous le milieu de plage).
  let deviationSecKm = null;
  if (mainPaceRange && actualPaceSecKm) {
    if (actualPaceSecKm > mainPaceRange.paceMax) deviationSecKm = Math.round(actualPaceSecKm - mainPaceRange.paceMax);
    else if (actualPaceSecKm < mainPaceRange.paceMin) deviationSecKm = Math.round(actualPaceSecKm - mainPaceRange.paceMin);
    else deviationSecKm = 0;
  }
  const deviationPct = (mainPaceRange && actualPaceSecKm && deviationSecKm != null)
    ? Math.round((deviationSecKm / ((mainPaceRange.paceMin + mainPaceRange.paceMax) / 2)) * 100) : null;
  // Ecart "effectif" utilise pour le verdict/l'anomalie/le score allure :
  // l'ecart brut (deviationSecKm) sauf sur une seance trail avec cote/D+ reel
  // ou le GAP (climbAnalysis.gapDeviationSecKm, deja normalise terrain) prend
  // le relais — cf. note sur climbAnalysis plus haut. deviationSecKm reste
  // inchange par ailleurs (ligne "Allure" mutee, purement informative).
  const effectiveDeviationSecKm = (isTrail && climbAnalysis?.gapDeviationSecKm != null) ? climbAnalysis.gapDeviationSecKm : deviationSecKm;
  const usingGapVerdict = isTrail && climbAnalysis?.gapDeviationSecKm != null;
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
    // pctTimeNotOverBand : temps PAS AU-DESSUS de la borne haute (zone cible
    // + en dessous), utilise pour le SCORE (composant "hr" plus bas) —
    // distinct de pctTimeInTargetZone (affiche tel quel, litteral, dans la
    // modale). Une FC basse alors que l'allure est conforme est un signe de
    // bonne forme, jamais un defaut a sanctionner comme une FC trop haute
    // (coherent avec hrVerdict 'basse', deja traite en positif ailleurs).
    let pctTimeNotOverBand = null;
    if (approxBand && zoneRelevantLaps.length) {
      let inTime = 0, notOverTime = 0, totalTime = 0;
      zoneRelevantLaps.forEach(l => {
        const dur = l.elapsedDuration || l.movingDuration || l.duration || 0;
        totalTime += dur;
        if (l.averageHR && l.averageHR >= approxBand.low && l.averageHR <= approxBand.high) inTime += dur;
        if (l.averageHR && l.averageHR <= approxBand.high) notOverTime += dur;
      });
      pctTimeInTargetZone = totalTime > 0 ? Math.round((inTime / totalTime) * 100) : null;
      pctTimeNotOverBand = totalTime > 0 ? Math.round((notOverTime / totalTime) * 100) : null;
    }
    hr = {
      avgHR: Math.round(activity.avgHR), maxHR: activity.maxHR ? Math.round(activity.maxHR) : null,
      approxTargetBand: approxBand, pctTimeInTargetZone, pctTimeNotOverBand,
      trendAcrossReps: (useRepsPath && mainGroup) ? zoneRelevantLaps.map(l => l.averageHR ? Math.round(l.averageHR) : null) : [],
      hrRecoveryBetweenReps: recoveryLaps.map(l => l.averageHR ? Math.round(l.averageHR) : null),
    };
  }

  // ── Derive cardiaque (1ere moitie vs 2e moitie de l'activite entiere) ──
  const cardiacDrift = computeCardiacDrift(laps);

  // ── Coherence allure / FC ──
  const paceVerdict = effectiveDeviationSecKm == null ? null : (Math.abs(effectiveDeviationSecKm) <= 10 ? 'conforme' : effectiveDeviationSecKm < 0 ? 'rapide' : 'lente');
  const hrVerdict = (hr && approxBand) ? (hr.avgHR > approxBand.high ? 'elevee' : hr.avgHR < approxBand.low ? 'basse' : 'conforme') : null;
  const coherenceNarrative = computeCoherenceNarrative(paceVerdict, hrVerdict, usingGapVerdict);

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
      climb: climbAnalysis,
    };
  }

  // ── Anomalies (severite dependante du type de seance, §26) ──
  const anomalies = [];
  const volSeverity = severityFor(primaryDeltaPct != null ? Math.abs(primaryDeltaPct) : null, VOLUME_SEVERITY_THRESHOLDS);
  if (volSeverity) anomalies.push({ code: primaryDeltaPct > 0 ? 'VOLUME_SUP' : 'VOLUME_INF', severity: volSeverity,
    message: primaryDeltaPct > 0 ? `Séance ${Math.abs(primaryDeltaPct)}% plus longue que prévu.` : `Séance ${Math.abs(primaryDeltaPct)}% plus courte que prévu.` });

  const rawPaceSeverity = severityFor(effectiveDeviationSecKm != null ? Math.abs(effectiveDeviationSecKm) : null, PACE_SEVERITY_THRESHOLDS[sessionTypeKey]);
  const paceLenient = isFasterButHrControlled(sessionTypeKey, effectiveDeviationSecKm, hrVerdict);
  // Cas "plus vite mais FC maitrisee" : deux crans d'attenuation, pas un
  // seul — l'objectif est de ne PAS faire apparaitre ce cas dans "a
  // ameliorer" (reserve a ATTENTION/IMPORTANT), puisqu'il n'y a justement
  // rien a ameliorer physiologiquement, seulement une info a signaler
  // (deja valorisee separement dans les points positifs).
  const paceSeverity = paceLenient ? downgradeSeverity(downgradeSeverity(rawPaceSeverity)) : rawPaceSeverity;
  // usingGapVerdict (defini plus haut) : le message reference explicitement
  // le GAP (pas "l'allure") pour ne pas contredire la ligne "Allure" mutee
  // juste au-dessus dans la modale, basee elle sur l'allure brute vs cible ajustee.
  if (paceSeverity) anomalies.push({ code: effectiveDeviationSecKm < 0 ? 'PACE_TROP_RAPIDE' : 'PACE_TROP_LENTE', severity: paceSeverity,
    message: paceLenient
      ? `${usingGapVerdict ? 'Effort (GAP)' : 'Allure'} ${Math.abs(effectiveDeviationSecKm)}s/km plus rapide que la cible, mais fréquence cardiaque maîtrisée — pas d'inquiétude particulière.`
      : usingGapVerdict
        ? `Effort réel (GAP, ajusté à la pente) ${effectiveDeviationSecKm < 0 ? Math.abs(effectiveDeviationSecKm) + 's/km plus rapide' : effectiveDeviationSecKm + 's/km plus lent'} que la cible.`
        : `Allure moyenne ${effectiveDeviationSecKm < 0 ? Math.abs(effectiveDeviationSecKm) + 's/km plus rapide' : effectiveDeviationSecKm + 's/km plus lente'} que la cible.` });

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
  if (paceVerdict === 'conforme') positives.push(usingGapVerdict ? 'Effort réel (GAP, ajusté à la pente) conforme à la zone visée.' : 'Allure moyenne conforme à la zone visée.');
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
  const rawPaceScore = scoreFromBand(effectiveDeviationSecKm, 10, 40);
  const components = {
    duration: scoreFromDeltaPct(durDeltaPct, 10, 50),
    distance: scoreFromDeltaPct(distDeltaPct, 10, 50),
    pace: (paceLenient && rawPaceScore != null) ? Math.max(rawPaceScore, 75) : rawPaceScore,
    hr: hr && hr.pctTimeNotOverBand != null ? hr.pctTimeNotOverBand : null,
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
    volume, structure, plannedMainReps: structure.plannedMainReps, paceVerdict, deviationSecKm: effectiveDeviationSecKm, regularity, pacingStrategy,
    hrVerdict, cardiacDrift, positives, improvements, paceLenient, usingGapVerdict,
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
    // Detail du calcul du score, pour la modale "Comprendre votre score" —
    // composants bruts + ponderations effectivement utilisees (celles a null
    // sont exclues du calcul, cf §~752).
    scoreBreakdown: { components, weights: profile.weights },
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

// Pente nette consideree "en cote" a partir de 3% (climbAnalysis, trail).
const CLIMB_GRADE_PCT = 3;

// Regroupe la trace GPS fine d'une activite (elevation: [{distKm, alt, hr}])
// en tronçons de ~binSizeM metres et en deduit pente moyenne en cote, pente
// la plus marquee, % de distance en cote et FC moyenne cote/plat. Beaucoup
// plus fidele qu'un decoupage par lap Garmin (1km, voire plus) pour une cote
// courte et repetee : sur un lap entier, une montee de quelques centaines de
// metres peut etre noyee par le reste (plat/descente) du meme lap et donner
// une pente nette quasi nulle alors que la pente reelle grimpe a 10-15%.
function computeGradeSegments(elevation, binSizeM = 50) {
  if (!Array.isArray(elevation) || elevation.length < 2) return null;
  const bins = [];
  let start = elevation[0], bucket = [elevation[0]];
  for (let i = 1; i < elevation.length; i++) {
    const pt = elevation[i];
    bucket.push(pt);
    const distM = (pt.distKm - start.distKm) * 1000;
    if (distM >= binSizeM || i === elevation.length - 1) {
      if (distM > 5) { // ignore les tronçons quasi nuls (bruit GPS/altimetrique)
        const hrVals = bucket.map(p => p.hr).filter(h => h != null);
        bins.push({
          distM,
          startDistKm: start.distKm,
          endDistKm: pt.distKm,
          ascentM: Math.max(0, pt.alt - start.alt),
          gradePct: ((pt.alt - start.alt) / distM) * 100,
          hrAvg: hrVals.length ? hrVals.reduce((a, b) => a + b, 0) / hrVals.length : null,
        });
      }
      start = pt; bucket = [pt];
    }
  }
  if (!bins.length) return null;

  const climbBins = bins.filter(b => b.gradePct >= CLIMB_GRADE_PCT);
  const flatBins = bins.filter(b => b.gradePct < CLIMB_GRADE_PCT);
  const wAvg = (arr, valKey) => {
    const tot = arr.reduce((s, x) => s + x.distM, 0);
    return tot > 0 ? arr.reduce((s, x) => s + (x[valKey] || 0) * x.distM, 0) / tot : null;
  };
  const totalDist = bins.reduce((s, x) => s + x.distM, 0);
  const climbDist = climbBins.reduce((s, x) => s + x.distM, 0);
  const maxBin = bins.reduce((best, b) => (!best || b.gradePct > best.gradePct) ? b : best, null);
  const hrClimbBins = climbBins.filter(b => b.hrAvg != null);
  const hrFlatBins = flatBins.filter(b => b.hrAvg != null);

  // Regroupe les tronçons en côte CONSECUTIFS en montées individuelles
  // (Focus montées, un panneau navigable par montée détectée façon "Montée
  // X of Y" de Garmin Connect) - un tronçon plat/descente entre deux groupes
  // de bins en côte marque la fin d'une montée et le début de la suivante.
  // MIN_CLIMB_DIST_M écarte les montées trop courtes pour être pertinentes
  // (bruit GPS/altimétrique isolé sur un terrain vallonné).
  const MIN_CLIMB_DIST_M = 80;
  const climbGroups = [];
  let cur = null;
  bins.forEach(b => {
    if (b.gradePct >= CLIMB_GRADE_PCT) {
      if (!cur) cur = [];
      cur.push(b);
    } else if (cur) { climbGroups.push(cur); cur = null; }
  });
  if (cur) climbGroups.push(cur);
  const climbs = climbGroups.map(group => {
    const totalDistM = group.reduce((s, b) => s + b.distM, 0);
    if (totalDistM < MIN_CLIMB_DIST_M) return null;
    const totalAscentM = group.reduce((s, b) => s + b.ascentM, 0);
    const maxB = group.reduce((best, b) => (!best || b.gradePct > best.gradePct) ? b : best, null);
    return {
      startDistKm: group[0].startDistKm,
      endDistKm: group[group.length - 1].endDistKm,
      distM: Math.round(totalDistM),
      ascentM: Math.round(totalAscentM),
      avgGradePct: Math.round((totalAscentM / totalDistM) * 1000) / 10,
      maxGradePct: Math.round(maxB.gradePct * 10) / 10,
    };
  }).filter(Boolean);

  return {
    avgGradePctClimb: climbBins.length ? Math.round(wAvg(climbBins, 'gradePct') * 10) / 10 : null,
    maxGradePct: maxBin ? Math.round(maxBin.gradePct * 10) / 10 : null,
    pctDistanceClimbing: totalDist > 0 ? Math.round((climbDist / totalDist) * 100) : null,
    hrClimb: hrClimbBins.length ? Math.round(wAvg(hrClimbBins, 'hrAvg')) : null,
    hrFlat: hrFlatBins.length ? Math.round(wAvg(hrFlatBins, 'hrAvg')) : null,
    climbs,
  };
}

// Detection course/marche/immobile (retour utilisateur 29/08 : les allures
// affichees comptaient le temps a l'arret, faussant les allures de course et
// de marche sur une sortie mixte). Garmin realise cette detection en interne
// via l'accelerometre (motif/cadence de mouvement) - inaccessible depuis
// notre API OAuth (connectapi.garmin.com), donc approximation ici a partir de
// la vitesse GPS brute (directSpeed). La cadence Garmin (directRunCadence)
// a ete testee en premier mais ecartee : sur une sortie trail reelle de
// l'utilisateur (avg grade climb +12.9%), les valeurs renvoyees plafonnaient
// a 113 (moyenne 56) - trop bas et trop peu variable pour une cadence de
// course exploitable (unite/fiabilite du champ cote Garmin peu claires),
// classification 0% course avec un seuil de cadence. Seuil de vitesse
// calibre a la place sur cette meme sortie (Garmin affichait 59:15 de
// course / 29:04 de marche sur ce total, soit 63% du temps en mouvement) :
// 1.5 m/s reproduit ce split a 1% pres. Coincide aussi avec la limite
// habituelle marche rapide/jogging lent citee par les methodes "run-walk"
// (~5.5 km/h) - pas juste un artefact de calibration sur un seul cas. Cette
// limite depend du terrain (plus basse qu'un seuil "plat" classique, car sur
// une pente tres raide un jogging reel est deja lent) : approximation, pas
// une reproduction exacte de la detection Garmin. L'immobile n'est PAS un
// seuil de vitesse mais lu directement des compteurs internes Garmin
// sumMovingDuration/sumElapsedDuration (le plus fiable possible, Garmin
// calcule deja cette distinction cote serveur) - cf /api/activity/:id/gps.
const RUN_SPEED_THRESHOLD_MPS = 1.5;

function computeMovementSplit(elevation) {
  if (!Array.isArray(elevation) || elevation.length < 2) return null;
  let runSec = 0, walkSec = 0, stillSec = 0, runDistKm = 0, walkDistKm = 0;
  let hasStillData = false;
  for (let i = 1; i < elevation.length; i++) {
    const prev = elevation[i - 1], cur = elevation[i];
    const dDist = Math.max(0, cur.distKm - prev.distKm);
    let dMoving, dElapsed;
    if (cur.movingSec != null && prev.movingSec != null && cur.elapsedSec != null && prev.elapsedSec != null) {
      hasStillData = true;
      dElapsed = Math.max(0, cur.elapsedSec - prev.elapsedSec);
      dMoving = Math.max(0, Math.min(dElapsed, cur.movingSec - prev.movingSec));
    } else {
      dElapsed = Math.max(0, (cur.sec || 0) - (prev.sec || 0));
      dMoving = dElapsed; // pas d'info arret dispo pour cette activite -> tout compte en mouvement
    }
    stillSec += Math.max(0, dElapsed - dMoving);
    if (dMoving <= 0) continue;
    const speed = cur.speedMps ?? prev.speedMps;
    const isRunning = speed != null ? speed >= RUN_SPEED_THRESHOLD_MPS : true;
    if (isRunning) { runSec += dMoving; runDistKm += dDist; } else { walkSec += dMoving; walkDistKm += dDist; }
  }
  const totalDistKm = runDistKm + walkDistKm;
  const totalMovingSec = runSec + walkSec;
  if (totalDistKm <= 0 || totalMovingSec <= 0) return null;
  const totalElapsedSec = totalMovingSec + stillSec;
  return {
    runSec: Math.round(runSec), walkSec: Math.round(walkSec), stillSec: Math.round(stillSec), hasStillData,
    avgPaceElapsedSecKm: Math.round(totalElapsedSec / totalDistKm),
    avgPaceMovingSecKm: Math.round(totalMovingSec / totalDistKm),
    runPaceSecKm: (runSec > 0 && runDistKm > 0) ? Math.round(runSec / runDistKm) : null,
    walkPaceSecKm: (walkSec > 0 && walkDistKm > 0) ? Math.round(walkSec / walkDistKm) : null,
    bestPaceSecKm: computeBestPace(elevation),
  };
}

// "Meilleure allure" façon Garmin : la vitesse la plus rapide soutenue sur
// une courte fenêtre glissante (pas l'instantané brut, trop bruité GPS).
function computeBestPace(elevation, windowSec = 20) {
  let best = null;
  for (let i = 0; i < elevation.length; i++) {
    const t0 = elevation[i].elapsedSec ?? elevation[i].sec;
    if (t0 == null) continue;
    let j = i;
    while (j + 1 < elevation.length && ((elevation[j + 1].elapsedSec ?? elevation[j + 1].sec) - t0) < windowSec) j++;
    const t1 = elevation[j].elapsedSec ?? elevation[j].sec;
    const dt = t1 - t0;
    if (dt < windowSec * 0.5) continue; // fenetre trop courte (fin de trace)
    const dDist = elevation[j].distKm - elevation[i].distKm;
    if (dDist <= 0) continue;
    const paceSecKm = dt / dDist;
    if (best == null || paceSecKm < best) best = paceSecKm;
  }
  return best != null ? Math.round(best) : null;
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

function computeCoherenceNarrative(paceVerdict, hrVerdict, usingGap) {
  if (!paceVerdict || !hrVerdict) return null;
  // Sur trail avec GAP dispo, paceVerdict reflete l'effort normalise pente
  // (climbAnalysis.gapVerdict), pas l'allure brute — le libelle doit le dire
  // explicitement pour ne pas laisser penser qu'il s'agit de la ligne
  // "Allure" (mutee) affichee juste au-dessus dans la modale.
  const term = usingGap ? 'votre effort réel (GAP, ajusté à la pente)' : 'votre allure';
  const termCap = usingGap ? 'Votre effort réel (GAP)' : 'Votre allure';
  if (paceVerdict === 'conforme' && hrVerdict === 'conforme') return `Effort parfaitement maîtrisé : ${term} et fréquence cardiaque sont cohérents avec l'objectif de la séance.`;
  if (paceVerdict === 'conforme' && hrVerdict === 'elevee') return `${termCap} est conforme, mais votre fréquence cardiaque est supérieure à celle attendue — l'effort semble avoir été plus coûteux que ce que laisse penser ${term}.`;
  if (paceVerdict === 'rapide' && hrVerdict === 'elevee') return `${usingGap ? 'Effort réel (GAP) trop rapide' : 'Allure trop rapide'} et fréquence cardiaque élevée : la séance a probablement été réalisée à une intensité excessive.`;
  if (paceVerdict === 'lente' && hrVerdict === 'elevee') return `${termCap} plus lent(e) que prévu mais fréquence cardiaque élevée — fatigue possible, chaleur, dénivelé ou conditions difficiles.`;
  if (paceVerdict === 'rapide' && hrVerdict === 'conforme') return `${termCap} est plus rapide que prévu, mais votre fréquence cardiaque reste dans la zone attendue — bon signe de forme, sans coût physiologique excessif.`;
  if (paceVerdict === 'rapide' && hrVerdict === 'basse') return `Vous avez couru plus vite que prévu (${term}) avec une fréquence cardiaque basse — très bonne gestion physiologique de l'effort.`;
  if (paceVerdict === 'lente' && hrVerdict === 'conforme') return `${termCap} plus lent(e) que prévu mais fréquence cardiaque cohérente — rien d'inquiétant, probablement une allure prudente.`;
  if (paceVerdict === 'lente' && hrVerdict === 'basse') return `${termCap} et fréquence cardiaque toutes deux en dessous de l'attendu — marge de progression disponible pour la prochaine séance.`;
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
  const paceTerm = ctx.usingGapVerdict ? 'L\'effort réel (GAP, ajusté à la pente)' : 'L\'allure moyenne';
  if (ctx.paceVerdict === 'conforme') parts.push(`${paceTerm} correspond à la cible.`);
  else if (ctx.paceVerdict === 'rapide' && ctx.paceLenient) parts.push(`Vous avez couru ${Math.abs(ctx.deviationSecKm)}s/km plus vite que la cible, mais sans coût cardiaque excessif — bon signe de forme.`);
  else if (ctx.paceVerdict === 'rapide') parts.push(ctx.usingGapVerdict ? `Votre effort réel (GAP) est resté plus rapide que prévu (${Math.abs(ctx.deviationSecKm)}s/km sous la cible).` : `Vous êtes parti plus vite que prévu (${Math.abs(ctx.deviationSecKm)}s/km sous la cible).`);
  else if (ctx.paceVerdict === 'lente') parts.push(ctx.usingGapVerdict ? `Votre effort réel (GAP) est resté plus lent que prévu (+${ctx.deviationSecKm}s/km).` : `Votre allure est restée plus lente que la cible (+${ctx.deviationSecKm}s/km).`);

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

// Marge de part et d'autre de la semaine calendaire du plan : une seance
// decalee (ex: sortie du dimanche faite le lundi suivant pour des raisons
// d'organisation, retour utilisateur 30/08) tombe alors dans la semaine
// SUIVANTE au sens calendaire pur - sans cette marge, l'activite reelle
// n'apparaissait jamais dans la liste de liaison de la seance concernee.
// 3 jours couvre un decalage de quelques jours dans un sens ou l'autre sans
// pour autant noyer la liste avec des activites sans rapport - le choix
// reste manuel (l'utilisateur voit la date exacte de chaque ligne), une
// marge large n'est donc pas dangereuse, juste bruyante au-dela.
const SESSION_LINK_WINDOW_PAD_DAYS = 3;

function _candidateActivitiesForWeek(week) {
  const weekStart = startOfDay(week.weekDate);
  const weekEnd = weekStart + 7 * 86400000;
  const padMs = SESSION_LINK_WINDOW_PAD_DAYS * 86400000;
  const paddedStart = weekStart - padMs;
  const paddedEnd = weekEnd + padMs;
  return (_allActivities || []).filter(a => {
    const t = (a.activityType || '').toLowerCase();
    if (!(t.includes('run') || t.includes('trail'))) return false;
    const d = startOfDay(new Date(a.date).getTime());
    if (!(d >= paddedStart && d < paddedEnd)) return false;
    if (_analysisIndex.byActivity[String(a.id)]) return false; // deja liee a une autre seance
    return true;
  }).map(a => ({ ...a, _outOfWeek: startOfDay(new Date(a.date).getTime()) < weekStart ? 'avant' : (startOfDay(new Date(a.date).getTime()) >= weekEnd ? 'apres' : null) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// a._outOfWeek ('avant'/'apres'/null, cf _candidateActivitiesForWeek) : signale
// une activite hors de la semaine calendaire stricte de la seance (repechee
// par la marge de quelques jours) - sans ce repere, rien ne distingue une
// sortie decalee d'une sortie de la bonne semaine dans cette liste.
function _renderActivityPickerRow(a, onPick) {
  const row = document.createElement('div');
  row.className = 'session-link-picker-row';
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 8px;border-bottom:1px solid var(--border-light);';
  const outOfWeekBadge = a._outOfWeek
    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:var(--bg-soft, rgba(0,0,0,.06));color:var(--text-secondary);font-size:10.5px;font-weight:600;">${a._outOfWeek === 'avant' ? 'semaine précédente' : 'semaine suivante'}</span>`
    : '';
  row.innerHTML = `
    <div>
      <div style="font-family:var(--font-body);font-weight:600;font-size:13px;color:var(--text-primary)">${a.name || 'Activité'}${outOfWeekBadge}</div>
      <div style="font-family:var(--font-body);font-size:11.5px;color:var(--text-secondary)">${formatDateShort(a.date, true)} · ${a.distanceKm ? a.distanceKm.toFixed(2)+' km' : '—'} · ${fmtDuration(a.durationSec)} · ${fmtPace(a.avgPaceSecPerKm)}</div>
    </div>
    <button type="button" style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:1px solid var(--brand-green);background:var(--brand-green);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Lier &amp; analyser</button>`;
  row.querySelector('button').addEventListener('click', () => onPick(a));
  return row;
}

async function populateSessionLinkPickerList(week, weekId, trainingIndex) {
  const listEl = document.getElementById('session-link-picker-list');
  if (!listEl) return;
  // La marge de _candidateActivitiesForWeek (SESSION_LINK_WINDOW_PAD_DAYS) peut
  // deborder sur l'annee precedente/suivante (semaine a cheval sur le 1er
  // janvier) - charger aussi ces annees-la, sinon les activites decalees
  // dans cette marge resteraient invisibles malgre le filtre elargi.
  const padMs = SESSION_LINK_WINDOW_PAD_DAYS * 86400000;
  const weekStart = startOfDay(week.weekDate);
  const years = new Set([
    new Date(weekStart).getFullYear(),
    new Date(weekStart - padMs).getFullYear(),
    new Date(weekStart + 7 * 86400000 + padMs).getFullYear(),
  ]);
  await Promise.all([...years].map(_ensureYearActivitiesLoaded));

  const candidates = _candidateActivitiesForWeek(week);
  if (!document.getElementById('session-link-picker-list')) return; // modale fermee entre-temps
  if (candidates.length === 0) {
    listEl.innerHTML = `Aucune activité de course disponible autour de cette semaine-là (± ${SESSION_LINK_WINDOW_PAD_DAYS} jours).`;
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

// Semaines dont la fenetre padee (SESSION_LINK_WINDOW_PAD_DAYS, meme marge
// que _candidateActivitiesForWeek) couvre la date de l'activite - sens
// inverse de _candidateActivitiesForWeek : on part ici d'une activite pour
// retrouver les seances candidates, y compris celle de la semaine PRECEDENTE
// quand l'activite a ete faite en retard (ex: sortie du dimanche decalee au
// lundi suivant, retour utilisateur 30/08 - sans cette marge, seule la
// semaine calendaire du lundi etait proposee, jamais celle du dimanche visee).
function _weeksNearDate(dateStr) {
  const t = new Date(dateStr).getTime();
  const padMs = SESSION_LINK_WINDOW_PAD_DAYS * 86400000;
  return (campusState.weeks || []).filter(w => {
    const s = startOfDay(w.weekDate) - padMs;
    const e = startOfDay(w.weekDate) + 7 * 86400000 + padMs;
    return t >= s && t < e;
  });
}

// ═══════════════════════════════════════════════════════
// MODALE PICKER — depuis Activites (activite connue, choix de la seance)
// ═══════════════════════════════════════════════════════
function openActivityLinkPicker(activity) {
  const weeks = _weeksNearDate(activity.date);
  if (!weeks.length) { if (typeof showToast === 'function') showToast('Aucune semaine de plan ne correspond à la date de cette activité.', 'info'); return; }
  const dayAct = startOfDay(new Date(activity.date).getTime());
  // rel = position de la semaine de LA SEANCE par rapport au jour reel de
  // l'activite - null si l'activite tombe dans sa propre semaine calendaire,
  // 'precedente'/'suivante' sinon (cf badge sur chaque ligne ci-dessous).
  const eligible = [];
  weeks.forEach(week => {
    const weekStart = startOfDay(week.weekDate);
    const weekEnd = weekStart + 7 * 86400000;
    const rel = dayAct >= weekStart && dayAct < weekEnd ? null : (dayAct >= weekEnd ? 'precedente' : 'suivante');
    (week.sessions || []).forEach(s => {
      if (!isSessionAnalysable(s) || _analysisIndex.bySession[_analysisSessionKey(week._id, s.trainingIndex ?? 0)]) return;
      eligible.push({ session: s, week, rel });
    });
  });

  _closeSessionAnalysisModals();
  const modal = document.createElement('div');
  modal.id = 'session-link-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:18px 20px 16px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      <div style="font-family:var(--font);font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:4px">Lier à une séance du plan</div>
      <div style="font-family:var(--font-body);font-size:12px;color:var(--text-secondary);margin-bottom:14px">${activity.name || 'Activité'} — ${formatDateShort(activity.date, true)}</div>
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
    listEl.innerHTML = `<div style="font-family:var(--font-body);font-size:12.5px;color:var(--text-muted);padding:16px 0;text-align:center">Aucune séance disponible autour de cette date (± ${SESSION_LINK_WINDOW_PAD_DAYS} jours, déjà liées ou non analysables).</div>`;
    return;
  }
  eligible.forEach(({ session: s, week, rel }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 8px;border-bottom:1px solid var(--border-light);';
    const relBadge = rel
      ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:var(--bg-soft, rgba(0,0,0,.06));color:var(--text-secondary);font-size:10.5px;font-weight:600;">semaine ${rel}</span>`
      : '';
    row.innerHTML = `
      <div>
        <div style="font-family:var(--font-body);font-weight:600;font-size:13px;color:var(--text-primary)">${s.displayName || s.name}${relBadge}</div>
        <div style="font-family:var(--font-body);font-size:11.5px;color:var(--text-secondary)">${getCategoryStyle(s.trainingCategory).label} · semaine du ${fmtWeekRange(week.weekDate)}</div>
      </div>
      <button type="button" style="flex-shrink:0;padding:6px 12px;border-radius:8px;border:1px solid var(--brand-green);background:var(--brand-green);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Lier &amp; analyser</button>`;
    row.querySelector('button').addEventListener('click', () => linkSessionToActivity(week._id, s.trainingIndex ?? 0, activity.id));
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
// Hauteur du segment = intensite (allure reelle), meme principe visuel que
// le graphique "Instructions" de Campus (blocs hauts = allures rapides,
// blocs bas = recuperation) — mais applique ici aux laps REELS plutot qu'aux
// blocs planifies : sur une seance sans structure prevue, la couleur reste
// uniforme (cf hasPlannedStructure plus haut) mais la hauteur montre quand
// meme les vraies variations d'allure (fatigue, cotes...).
const TIMELINE_MIN_HEIGHT_PCT = 15, TIMELINE_MAX_HEIGHT_PCT = 100;
// Interpolation sur la VITESSE (1/allure), pas sur l'allure brute : en
// sec/km, l'ecart entre un footing d'echauffement (5'46) et un sprint
// (3'51) est petit devant l'ecart entre une recup active et un arret quasi
// total (souvent >20'/km) — une interpolation lineaire en sec/km ecrase donc
// tout le monde pres du haut de l'echelle des qu'un seul lap tres lent
// (feu rouge, pause) apparait. En vitesse, cette meme lenteur extreme reste
// proche de 0 et n'ecrase pas le reste de la plage : echauffement et recup
// ressortent alors nettement plus bas que l'effort, comme sur le graphique
// "Instructions" de Campus.
function timelineHeightPct(seg, minSpeed, maxSpeed) {
  if (!seg.paceSecKm || minSpeed == null || maxSpeed == null || minSpeed === maxSpeed) return 55;
  const speed = 1 / seg.paceSecKm;
  const t = Math.max(0, Math.min(1, (speed - minSpeed) / (maxSpeed - minSpeed)));
  return Math.round(TIMELINE_MIN_HEIGHT_PCT + t * (TIMELINE_MAX_HEIGHT_PCT - TIMELINE_MIN_HEIGHT_PCT));
}
function buildTimelineHtml(timeline) {
  if (!timeline || !timeline.length) return '';
  const total = timeline.reduce((s, seg) => s + seg.durationSec, 0);
  if (!total) return '';
  const speeds = timeline.map(s => s.paceSecKm ? 1 / s.paceSecKm : null).filter(Boolean);
  const minSpeed = speeds.length ? Math.min(...speeds) : null, maxSpeed = speeds.length ? Math.max(...speeds) : null;
  const bar = timeline.map(seg => {
    const pct = (seg.durationSec / total) * 100;
    const h = timelineHeightPct(seg, minSpeed, maxSpeed);
    const title = `${TIMELINE_LABELS[seg.type] || seg.type} — ${describeDuration(seg.durationSec)}`
      + (seg.paceSecKm ? ` · ${fmtPace(seg.paceSecKm)}/km` : '')
      + (seg.hr ? ` · ${seg.hr} bpm` : '');
    return `<div class="analysis-timeline-seg" style="flex:${pct} 0 auto;height:${h}%;background:${TIMELINE_COLORS[seg.type] || TIMELINE_COLORS.effort}" title="${_escapeAttr(title)}"></div>`;
  }).join('');
  const distinctTypes = new Set(timeline.map(s => s.type));
  const legend = distinctTypes.size <= 1 ? '' : Object.keys(TIMELINE_LABELS)
    .filter(k => distinctTypes.has(k))
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

  // Ligne "Effort (GAP)" : le vrai verdict conforme/pas conforme sur une
  // seance cote/D+ (cf. climbAnalysis dans buildSessionAnalysis) — le GAP
  // Garmin (deja normalise pente) compare a la cible PLATE (pas la cible
  // "Allure" ci-dessus, qui elle est deja majoree forfaitairement pour le
  // denivele : les comparer au GAP compterait le denivele deux fois).
  const climb = record.trail?.climb || null;
  const gapRowHtml = (isTrail && climb?.gapAvgSecKm != null && climb.flatPaceRange) ? `
    <div class="analysis-summary-row">
      <span class="analysis-summary-label">Effort (GAP)</span>
      <span class="analysis-summary-values"><span class="analysis-summary-planned">${fmtPace(climb.flatPaceRange.paceMin)} – ${fmtPace(climb.flatPaceRange.paceMax)}/km</span> → <span class="analysis-summary-actual">${fmtPace(climb.gapAvgSecKm)}/km</span></span>
      <span class="analysis-summary-icon">${_rowIcon(climb.gapVerdict == null || climb.gapVerdict === 'conforme')}</span>
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
  // Profil de la course : uniquement pour les seances trail avec un D+ annonce
  // au plan — inutile (et bruite) pour une seance route ou sans D+ prevu.
  const elevationProfileHtml = (isTrail && record.trail?.plannedDPlusM) ? `
    <div class="analysis-section-title">Profil de la course</div>
    <div class="analysis-elevation-chart-wrapper">
      <canvas id="analysis-elevation-chart"></canvas>
    </div>` : '';

  // Détail pente/effort en côte : uniquement si des tronçons en côte ont pu
  // être identifiés dans les laps Garmin (climb non null → cf. climbAnalysis).
  const climbDetailHtml = (isTrail && climb && (climb.avgGradePctClimb != null || climb.pctDistanceClimbing != null)) ? `
    <div class="analysis-section-title">Pente & effort en côte</div>
    <div class="analysis-climb-grid">
      ${climb.avgGradePctClimb != null ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Pente moyenne en côte</span><span class="analysis-climb-stat-value">+${climb.avgGradePctClimb}%</span></div>` : ''}
      ${climb.maxGradePct != null ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Pente la plus marquée</span><span class="analysis-climb-stat-value">${climb.maxGradePct >= 0 ? '+' : ''}${climb.maxGradePct}%</span></div>` : ''}
      ${climb.pctDistanceClimbing != null ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Distance en côte</span><span class="analysis-climb-stat-value">${climb.pctDistanceClimbing}%</span></div>` : ''}
      ${(climb.hrClimb != null && climb.hrFlat != null) ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">FC côte / plat</span><span class="analysis-climb-stat-value">${climb.hrClimb} / ${climb.hrFlat} bpm</span></div>` : ''}
    </div>
    <div class="analysis-climb-note">Pente calculée sur la trace GPS fine, par tronçons d'environ 50 m — une variation plus ponctuelle peut exister à une échelle encore plus fine. Le GAP neutralise l'effet de la pente pour évaluer l'effort réel : comparez-le à la cible plate (ligne "Effort (GAP)" ci-dessus), pas à la cible "Allure" qui est déjà majorée forfaitairement pour le dénivelé.</div>` : '';

  // Détection course/marche/immobile + allures détaillées (façon Garmin
  // Connect) — retour utilisateur 29/08 : l'allure "globale" mélangeait à
  // tort temps d'arrêt et déplacement, faussant les allures course/marche
  // sur une sortie mixte. Détection approximative (cadence/vitesse GPS, cf.
  // computeMovementSplit) — Garmin utilise en interne l'accéléromètre, plus
  // fin, inaccessible depuis notre API.
  const ms = climb?.movementSplit || null;
  const movementHtml = (isTrail && ms) ? `
    <div class="analysis-section-title">Détection de course/marche</div>
    <div class="analysis-climb-grid">
      <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Temps de course</span><span class="analysis-climb-stat-value">${fmtDuration(ms.runSec)}</span></div>
      <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Temps de marche</span><span class="analysis-climb-stat-value">${fmtDuration(ms.walkSec)}</span></div>
      ${ms.hasStillData ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Temps immobile</span><span class="analysis-climb-stat-value">${fmtDuration(ms.stillSec)}</span></div>` : ''}
    </div>
    <div class="analysis-section-title">Allure/vitesse</div>
    <div class="analysis-climb-grid">
      <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Allure moyenne</span><span class="analysis-climb-stat-value">${fmtPace(ms.avgPaceElapsedSecKm)}/km</span></div>
      <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Allure moy. en déplacement</span><span class="analysis-climb-stat-value">${fmtPace(ms.avgPaceMovingSecKm)}/km</span></div>
      ${ms.bestPaceSecKm != null ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Meilleure allure</span><span class="analysis-climb-stat-value">${fmtPace(ms.bestPaceSecKm)}/km</span></div>` : ''}
      ${climb.gapAvgSecKm != null ? `<div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Allure moy. ajustée à la pente</span><span class="analysis-climb-stat-value">${fmtPace(climb.gapAvgSecKm)}/km</span></div>` : ''}
    </div>
    <div class="analysis-climb-note">Allure de course${ms.runPaceSecKm != null ? ` ${fmtPace(ms.runPaceSecKm)}/km` : ' —'} · allure de marche${ms.walkPaceSecKm != null ? ` ${fmtPace(ms.walkPaceSecKm)}/km` : ' —'} — détection approximative à partir de la vitesse GPS (Garmin utilise en interne l'accéléromètre, plus précis).</div>` : '';

  // Focus montées : un panneau navigable par montée individuellement
  // détectée (façon "Montée X of Y" de Garmin Connect) - cf. climbs dans
  // computeGradeSegments. Reste separe du bloc agrege "Pente & effort en
  // côte" ci-dessus (moyennes sur toute la seance) : ici, une carte par
  // montee avec son propre profil (survol = pente locale).
  const climbFocusHtml = (isTrail && climb?.climbs?.length) ? `
    <div class="analysis-section-title">Focus montées</div>
    <div class="analysis-climb-focus" id="analysis-climb-focus">
      <div class="climb-focus-header">
        <button type="button" id="climb-focus-prev" class="climb-focus-nav-btn" aria-label="Montée précédente">‹</button>
        <span id="climb-focus-title" class="climb-focus-title"></span>
        <button type="button" id="climb-focus-next" class="climb-focus-nav-btn" aria-label="Montée suivante">›</button>
      </div>
      <div class="analysis-climb-grid">
        <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Pente moy.</span><span class="analysis-climb-stat-value" id="climb-focus-avg">—</span></div>
        <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Pente max</span><span class="analysis-climb-stat-value" id="climb-focus-max">—</span></div>
        <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Ascension</span><span class="analysis-climb-stat-value" id="climb-focus-ascent">—</span></div>
        <div class="analysis-climb-stat"><span class="analysis-climb-stat-label">Distance</span><span class="analysis-climb-stat-value" id="climb-focus-dist">—</span></div>
      </div>
      <div class="analysis-elevation-chart-wrapper">
        <canvas id="climb-focus-chart"></canvas>
      </div>
      <div class="analysis-climb-note">Survolez le profil pour voir la pente locale à cet endroit précis.</div>
    </div>` : '';

  return `
    <div class="analysis-modal-header">
      <div class="analysis-modal-title">${s.displayName}</div>
      <div class="analysis-modal-score-row">
        <div class="analysis-modal-score">${record.verdict.emoji} <strong>${record.score}%</strong> — ${record.verdict.label}</div>
        <button type="button" class="analysis-score-help-btn" id="analysis-score-help-btn">?</button>
      </div>
    </div>
    <div class="analysis-summary-block">${summaryRowsHtml}${trailRowHtml}${gapRowHtml}</div>
    ${movementHtml}
    ${elevationProfileHtml}
    ${climbDetailHtml}
    ${climbFocusHtml}
    ${timelineHtml}
    ${repsTableHtml}
    ${positivesHtml}
    ${improvementsHtml}
    ${record.coherenceNarrative ? `<div class="analysis-coherence-note">${record.coherenceNarrative}</div>` : ''}
    <div class="analysis-commentary">${record.commentary}</div>
    ${similarHtml}
  `;
}

// 🎉 Pluie de confettis pendant 6s, confinée à la carte de la modale
// d'analyse (canvas enfant du conteneur passé, pas plein écran - demande
// utilisateur explicite) - purement décoratif (pointer-events:none),
// respecte prefers-reduced-motion. Le canvas est un enfant de la modale, donc
// retiré automatiquement avec elle si l'utilisateur ferme avant la fin (pas
// besoin d'observer de nettoyage séparé, contrairement à un overlay
// plein-écran attaché à <body>). Nouveaux morceaux générés en continu
// (pas un seul burst) pour que la pluie reste visible sur toute la durée
// plutôt que de se vider après 2-3s de chute. Fondu (pas de coupure nette)
// sur le dernier FADE_MS - retour utilisateur explicite.
function fireConfetti(container) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = container || document.body;
  if (!el.clientWidth || !el.clientHeight) return;
  const DURATION_MS = 6000;
  const FADE_MS = 900;
  const SPAWN_UNTIL_MS = DURATION_MS - 1500; // laisse les derniers morceaux finir leur chute avant le fondu
  const COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;border-radius:16px;overflow:hidden;';
  canvas.width = el.clientWidth;
  canvas.height = el.clientHeight;
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function spawnPiece() {
    return {
      x: Math.random() * canvas.width,
      y: -14,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vy: 2 + Math.random() * 2,
      vx: (Math.random() - 0.5) * 1.6,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
    };
  }
  let pieces = [];
  let lastSpawn = 0;
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    if (elapsed < SPAWN_UNTIL_MS && now - lastSpawn > 45) {
      lastSpawn = now;
      pieces.push(spawnPiece(), spawnPiece());
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces = pieces.filter(p => p.y < canvas.height + 20);
    const fadeStart = DURATION_MS - FADE_MS;
    const globalOpacity = elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / FADE_MS) : 1;
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      ctx.save();
      ctx.globalAlpha = globalOpacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < DURATION_MS && canvas.isConnected) { requestAnimationFrame(tick); return; }
    canvas.remove();
  }
  requestAnimationFrame(tick);
}

function openAnalysisModal(record) {
  _closeSessionAnalysisModals();
  const modal = document.createElement('div');
  modal.id = 'session-analysis-result-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  // Wrapper non-scrollant : porte la croix de fermeture en position absolute
  // (jamais fixed, pas necessaire ici) pour qu'elle reste visible pendant le
  // scroll du contenu — celui-ci vit dans .analysis-modal-scroll, seul
  // element avec overflow-y:auto. overscroll-behavior:contain empeche le
  // scroll de "deborder" vers la page en dessous une fois arrive en bas/haut
  // du contenu de la modale (defilement du fond visible au scroll, signale
  // par l'utilisateur).
  modal.innerHTML = `
    <div id="session-analysis-modal-card" style="position:relative;width:100%;max-width:640px;max-height:88vh;">
      <button id="session-analysis-close-x" class="analysis-modal-close-x" title="Fermer" aria-label="Fermer">&times;</button>
      <div class="analysis-modal-scroll" style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:20px 22px 18px;max-height:88vh;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 60px rgba(0,0,0,.25);">
        ${buildAnalysisModalHtml(record)}
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="session-analysis-recalc" class="btn-analysis-recalc" title="Refaire le calcul (utile si le moteur d'analyse a evolue depuis la liaison)">🔄 Recalculer</button>
          <button id="session-analysis-unlink" class="btn-analysis-unlink">Délier cette activité</button>
          <button id="session-analysis-close" class="btn-analysis-close-modal">Fermer</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // 🎉 Petite animation festive quand le score depasse 90% - demande
  // utilisateur explicite ("juste pour rigoler"), confinée à la carte de la
  // modale (pas plein écran) - cf fireConfetti ci-dessous. Le conteneur passé
  // est le wrapper NON scrollant (pas .analysis-modal-scroll) pour que les
  // confettis restent visuellement fixes pendant que l'utilisateur scrolle
  // le contenu de la modale, plutôt que de défiler avec lui.
  if (record.score >= 90) fireConfetti(modal.querySelector('#session-analysis-modal-card'));
  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#session-analysis-close').addEventListener('click', close);
  modal.querySelector('#session-analysis-close-x').addEventListener('click', close);
  modal.querySelector('#session-analysis-unlink').addEventListener('click', () => unlinkAnalysis(record.id, close));
  modal.querySelector('#session-analysis-recalc').addEventListener('click', () => recalculateAnalysis(record));
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);
  const climbList = record.trail?.climb?.climbs;
  const needsProfile = record.sessionTypeKey === 'TRAIL' && record.trail?.plannedDPlusM;
  const needsClimbFocus = record.sessionTypeKey === 'TRAIL' && climbList?.length;
  if (needsProfile || needsClimbFocus) {
    loadAnalysisActivityElevation(record.activityId).then(elevation => {
      if (!elevation || !modal.isConnected) return;
      if (needsProfile) renderAnalysisElevationChart(elevation);
      if (needsClimbFocus) initClimbFocusPanel(elevation, climbList);
    });
  }

  const helpBtn = modal.querySelector('#analysis-score-help-btn');
  if (helpBtn) {
    let tip = null;
    helpBtn.addEventListener('mouseenter', () => {
      tip = document.createElement('div');
      tip.className = 'cal-chip-tooltip analysis-score-help-tooltip';
      tip.textContent = 'Comprendre votre score ?';
      helpBtn.appendChild(tip);
    });
    helpBtn.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
    helpBtn.addEventListener('click', () => openScoreBreakdownModal(record));
  }
}

// ─── Modale "Comprendre votre score" ───────────────────────────────────
// Detail componente par composante du calcul du score (§ scoreBreakdown,
// buildSessionAnalysis) — ouverte via le bouton (?) a cote du score dans la
// modale d'analyse. Les composantes a null (non applicables a ce type de
// seance, ex: structure pour un footing continu) sont exclues du calcul —
// affichees grisees plutot que masquees, pour que la formule reste lisible.
const SCORE_COMPONENT_LABELS = {
  duration:   'Durée',
  distance:   'Distance',
  pace:       'Allure',
  hr:         'Fréquence cardiaque (% du temps sans dépassement de la zone cible)',
  drift:      'Dérive cardiaque',
  regularity: 'Régularité entre répétitions',
  structure:  'Répétitions réalisées',
  dplus:      'Dénivelé (D+)',
};

// Phrase "coach" par composante du score (retour utilisateur 29/08 : les %
// bruts + ponderations sont trop "mathematiques", il veut la meme chose
// qu'un coach qui pointe concretement ce qui n'a pas colle - cible vs
// realise, en une phrase). Reutilise les valeurs deja calculees ailleurs
// dans le record (sessionSnapshot/activitySnapshot pour duree/distance,
// paceAnalysis, hr, cardiacDrift, regularity, structure, trail) plutot que
// de refaire un calcul parallele - aucune nouvelle donnee necessaire.
function componentNarrative(key, record) {
  const s = record.sessionSnapshot, a = record.activitySnapshot;
  switch (key) {
    case 'duration': {
      const planned = s.stats?.expectedDuration, actual = a.durationSec;
      if (!planned || !actual) return null;
      const diffMin = Math.round((actual - planned) / 60);
      if (Math.abs(diffMin) < 3) return `Durée quasi identique à ce qui était prévu (${fmtDuration(planned)} visé, ${fmtDuration(actual)} réalisé).`;
      return diffMin > 0
        ? `${Math.abs(diffMin)} min de plus que prévu (${fmtDuration(planned)} visé → ${fmtDuration(actual)} réalisé).`
        : `Séance écourtée de ${Math.abs(diffMin)} min par rapport à la cible (${fmtDuration(planned)} visé → ${fmtDuration(actual)} réalisé).`;
    }
    case 'distance': {
      const planned = s.stats?.expectedDistance, actual = a.distanceKm;
      if (!planned || !actual) return null;
      const diffKm = Math.round((actual - planned) * 10) / 10;
      if (Math.abs(diffKm) < 0.3) return `Distance quasi identique à la cible (${planned.toFixed(1)} km visés, ${actual.toFixed(1)} km réalisés).`;
      return diffKm > 0
        ? `${Math.abs(diffKm).toFixed(1)} km de plus que prévu (${planned.toFixed(1)} km visés → ${actual.toFixed(1)} km réalisés).`
        : `${Math.abs(diffKm).toFixed(1)} km de moins que prévu (${planned.toFixed(1)} km visés → ${actual.toFixed(1)} km réalisés).`;
    }
    case 'pace': {
      const p = record.paceAnalysis?.[0];
      if (!p || p.deviationSecKm == null) return null;
      const usingGap = record.sessionTypeKey === 'TRAIL' && record.trail?.climb?.gapVerdict != null;
      const actualLabel = usingGap ? `${fmtPace(record.trail.climb.gapAvgSecKm)}/km (effort réel, GAP)` : `${fmtPace(p.actualPaceSecKm)}/km`;
      if (Math.abs(p.deviationSecKm) <= 10) return `Bien dans la cible (${fmtPace(p.targetPaceMin)}–${fmtPace(p.targetPaceMax)}/km visé, ${actualLabel} réalisé).`;
      return p.deviationSecKm < 0
        ? `${Math.abs(p.deviationSecKm)}s/km plus rapide que la cible (${fmtPace(p.targetPaceMin)}–${fmtPace(p.targetPaceMax)}/km visé, ${actualLabel} réalisé).`
        : `${p.deviationSecKm}s/km plus lent que la cible (${fmtPace(p.targetPaceMin)}–${fmtPace(p.targetPaceMax)}/km visé, ${actualLabel} réalisé).`;
    }
    case 'hr': {
      const hr = record.hr;
      if (!hr) return null;
      const band = hr.approxTargetBand;
      const bandTxt = band ? ` (zone visée ~${band.low}-${band.high} bpm)` : '';
      // Une FC sous la zone visee n'est jamais penalisee (voir components.hr,
      // pctTimeNotOverBand) : phrase dediee pour ne pas laisser croire que le
      // score en tient rigueur, ce qui contredirait le pourcentage affiche.
      if (band && hr.avgHR < band.low) {
        return `FC moyenne de ${hr.avgHR} bpm, en dessous de la zone visée${bandTxt} — effort bien maîtrisé, ne pénalise pas le score.`;
      }
      return hr.pctTimeInTargetZone != null
        ? `${hr.pctTimeInTargetZone}% du temps dans la zone de FC visée${bandTxt} — FC moyenne ${hr.avgHR} bpm.`
        : `FC moyenne de ${hr.avgHR} bpm${bandTxt}.`;
    }
    case 'drift': {
      const cd = record.cardiacDrift;
      if (!cd || cd.driftPct == null) return null;
      const detail = `(${cd.driftPct > 0 ? '+' : ''}${cd.driftPct}% entre les deux moitiés — ${cd.firstHalfHR} puis ${cd.secondHalfHR} bpm)`;
      return cd.narrative ? `${cd.narrative} ${detail}` : `Dérive cardiaque ${detail}.`;
    }
    case 'regularity': {
      const r = record.regularity;
      if (!r || r.maxEcartSecKm == null) return null;
      return `Écart maximal de ${r.maxEcartSecKm}s/km entre tes répétitions${r.label ? ' — ' + r.label : ''}.`;
    }
    case 'structure': {
      const st = record.structure;
      if (!st || st.plannedMainReps == null) return null;
      return (st.actualMainReps >= st.plannedMainReps)
        ? `Toutes les répétitions prévues ont été réalisées (${st.actualMainReps}/${st.plannedMainReps}).`
        : `${st.plannedMainReps - (st.actualMainReps || 0)} répétition(s) manquante(s) sur ${st.plannedMainReps} prévues.`;
    }
    case 'dplus': {
      const t = record.trail;
      if (!t || t.plannedDPlusM == null || t.actualDPlusM == null) return null;
      const diff = Math.round(t.actualDPlusM - t.plannedDPlusM);
      if (Math.abs(t.deltaPct ?? 0) <= 10) return `Dénivelé quasi conforme (${Math.round(t.plannedDPlusM)} m visés, ${Math.round(t.actualDPlusM)} m réalisés).`;
      return diff > 0
        ? `${diff} m de D+ en plus par rapport à la cible (${Math.round(t.plannedDPlusM)} m visés → ${Math.round(t.actualDPlusM)} m réalisés).`
        : `${Math.abs(diff)} m de D+ en moins par rapport à la cible (${Math.round(t.plannedDPlusM)} m visés → ${Math.round(t.actualDPlusM)} m réalisés).`;
    }
    default: return null;
  }
}

function buildScoreBreakdownHtml(record) {
  const bd = record.scoreBreakdown;
  if (!bd) {
    return `<div class="analysis-modal-header"><div class="analysis-modal-title">Comprendre votre score</div></div>
      <div class="analysis-commentary">Détail indisponible pour cette analyse plus ancienne — cliquez sur « 🔄 Recalculer » dans la fiche d'analyse pour l'obtenir.</div>`;
  }
  const { components, weights } = bd;
  const rows = Object.entries(weights).map(([key, w]) => {
    const label = SCORE_COMPONENT_LABELS[key] || key;
    const v = components[key];
    const pct = Math.round(w * 100);
    if (v == null) {
      return `<div class="score-breakdown-row score-breakdown-row--excluded">
        <div class="score-breakdown-row-header">
          <div class="score-breakdown-label">${label}</div>
          <div class="score-breakdown-value">Non applicable à cette séance</div>
        </div>
      </div>`;
    }
    const narrative = componentNarrative(key, record);
    return `<div class="score-breakdown-row">
      <div class="score-breakdown-row-header">
        <div class="score-breakdown-label">${label} <span class="score-breakdown-weight">(pondération ${pct}%)</span></div>
        <div class="score-breakdown-value"><strong>${Math.round(v)}%</strong></div>
      </div>
      ${narrative ? `<div class="score-breakdown-narrative">${narrative}</div>` : ''}
    </div>`;
  }).join('');

  let scoreSum = 0, scoreW = 0;
  Object.entries(weights).forEach(([key, w]) => {
    const v = components[key];
    if (v == null) return;
    scoreSum += v * w; scoreW += w;
  });
  const usedPct = Math.round(scoreW * 100);

  return `
    <div class="analysis-modal-header">
      <div class="analysis-modal-title">Comprendre votre score</div>
      <div class="analysis-modal-score">Séance type ${sessionTypeLabel(record.sessionTypeKey)} — ${record.verdict.emoji} <strong>${record.score}%</strong></div>
    </div>
    <div class="analysis-commentary">Chaque composante de la séance obtient un score de 0 à 100%, selon son écart à ce qui était prévu. Le score final est leur moyenne pondérée — seules les composantes applicables à ce type de séance comptent (pondérations totales utilisées ici : ${usedPct}%).</div>
    <div class="score-breakdown-list">${rows}</div>
    <div class="analysis-climb-note">Une composante à 100% est parfaitement conforme à la cible ; le score baisse progressivement au-delà d'une tolérance propre à chaque composante (ex : ±10s/km pour l'allure), jusqu'à 0% au-delà d'un écart jugé très important.</div>`;
}

function openScoreBreakdownModal(record) {
  const existing = document.getElementById('score-breakdown-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'score-breakdown-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="position:relative;width:100%;max-width:520px;max-height:88vh;">
      <button id="score-breakdown-close-x" class="analysis-modal-close-x" title="Fermer" aria-label="Fermer">&times;</button>
      <div class="analysis-modal-scroll" style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:20px 22px 18px;max-height:88vh;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 24px 60px rgba(0,0,0,.25);">
        ${buildScoreBreakdownHtml(record)}
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="score-breakdown-close" class="btn-analysis-close-modal">Fermer</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#score-breakdown-close').addEventListener('click', close);
  modal.querySelector('#score-breakdown-close-x').addEventListener('click', close);
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);
}

// Profil altimetrique de la course, dans la modale d'analyse (seances trail
// avec D+ annonce uniquement — cf. gabarit dans buildAnalysisModalHtml).
// Meme source/lissage que renderElevationProfile (app.js, carte d'activite),
// dupliquee ici car cette modale n'a pas de canevas "route" partage.
let _analysisElevationChart = null;
// Recupere la trace GPS/elevation d'une activite - factorise car reutilisee a
// la fois par le profil altimetrique global (renderAnalysisElevationChart) et
// le panneau "Focus montees" (initClimbFocusPanel), pour un seul appel reseau
// meme quand les deux sont affiches dans la meme modale.
async function loadAnalysisActivityElevation(activityId) {
  try {
    const res = await fetch(`/api/activity/${activityId}/gps`);
    const { elevation } = await res.json();
    return (Array.isArray(elevation) && elevation.length >= 2) ? elevation : null;
  } catch (e) { console.error('loadAnalysisActivityElevation:', e); return null; }
}
function renderAnalysisElevationChart(elevation) {
  const canvas = document.getElementById('analysis-elevation-chart');
  if (!canvas) return;
  if (_analysisElevationChart) { _analysisElevationChart.destroy(); _analysisElevationChart = null; }
  try {
    if (!canvas.isConnected) return;
    const labels = elevation.map(p => p.distKm.toFixed(2));
    const rawAlt = elevation.map(p => p.alt);
    const WINDOW = 5;
    const half = Math.floor(WINDOW / 2);
    const data = rawAlt.map((_, i) => {
      const start = Math.max(0, i - half), end = Math.min(rawAlt.length, i + half + 1);
      const slice = rawAlt.slice(start, end);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
    const base = chartOptions();
    _analysisElevationChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.18)', fill: true, pointRadius: 0, borderWidth: 2, cubicInterpolationMode: 'monotone' }] },
      options: {
        ...base,
        plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, displayColors: false,
          callbacks: { title: (items) => `${items[0].label} km`, label: (item) => `${Math.round(item.raw)} m` } } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 6 } } },
      }
    });
  } catch (e) { console.error('renderAnalysisElevationChart:', e); }
}

// ─── Focus montées : panneau navigable, une carte par montée détectée ─────
// (façon "Montée X of Y" de Garmin Connect) - liste des montées dans
// climb.climbs (computeGradeSegments), profil/survol construits ici à partir
// de la trace GPS complète déjà chargée pour le profil altimétrique global.
let _analysisClimbChart = null;
let _climbFocusState = null; // { elevation, climbs, index }

function initClimbFocusPanel(elevation, climbs) {
  const container = document.getElementById('analysis-climb-focus');
  if (!container || !climbs || !climbs.length) return;
  _climbFocusState = { elevation, climbs, index: 0 };
  renderClimbFocusCard();
  const prevBtn = document.getElementById('climb-focus-prev');
  const nextBtn = document.getElementById('climb-focus-next');
  if (prevBtn) prevBtn.addEventListener('click', () => stepClimbFocus(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => stepClimbFocus(1));
}

function stepClimbFocus(delta) {
  if (!_climbFocusState) return;
  const { climbs, index } = _climbFocusState;
  const next = Math.max(0, Math.min(climbs.length - 1, index + delta));
  if (next === index) return;
  _climbFocusState.index = next;
  renderClimbFocusCard();
}

function renderClimbFocusCard() {
  if (!_climbFocusState) return;
  const { elevation, climbs, index } = _climbFocusState;
  const c = climbs[index];
  const titleEl = document.getElementById('climb-focus-title');
  const prevBtn = document.getElementById('climb-focus-prev');
  const nextBtn = document.getElementById('climb-focus-next');
  if (titleEl) titleEl.textContent = `Montée ${index + 1} / ${climbs.length}`;
  if (prevBtn) prevBtn.disabled = index === 0;
  if (nextBtn) nextBtn.disabled = index === climbs.length - 1;
  const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setStat('climb-focus-avg', `+${c.avgGradePct}%`);
  setStat('climb-focus-max', `${c.maxGradePct >= 0 ? '+' : ''}${c.maxGradePct}%`);
  setStat('climb-focus-ascent', `${c.ascentM} m`);
  setStat('climb-focus-dist', c.distM >= 1000 ? `${(c.distM / 1000).toFixed(2)} km` : `${c.distM} m`);
  renderClimbFocusChart(elevation, c);
}

// Pente locale par point (fenetre glissante ~30m, plus fine que les tronçons
// de 50m de computeGradeSegments) affichee au survol - meme principe que la
// vue "Montée détails" de Garmin Connect.
const CLIMB_FOCUS_GRADE_WINDOW_M = 30;
function renderClimbFocusChart(elevation, climb) {
  const canvas = document.getElementById('climb-focus-chart');
  if (!canvas) return;
  if (_analysisClimbChart) { _analysisClimbChart.destroy(); _analysisClimbChart = null; }
  try {
    if (!canvas.isConnected) return;
    // Marge de contexte avant/apres la montee (pour voir son amorce et sa
    // fin), plafonnee pour ne pas noyer une montee courte dans du plat.
    const marginKm = Math.min(0.15, (climb.endDistKm - climb.startDistKm) * 0.25);
    const pts = elevation.filter(p => p.distKm >= climb.startDistKm - marginKm && p.distKm <= climb.endDistKm + marginKm);
    if (pts.length < 2) return;
    const labels = pts.map(p => p.distKm.toFixed(2));
    const alt = pts.map(p => p.alt);
    const grades = pts.map((p, i) => {
      let lo = i, hi = i;
      while (lo > 0 && (p.distKm - pts[lo - 1].distKm) * 1000 < CLIMB_FOCUS_GRADE_WINDOW_M / 2) lo--;
      while (hi < pts.length - 1 && (pts[hi + 1].distKm - p.distKm) * 1000 < CLIMB_FOCUS_GRADE_WINDOW_M / 2) hi++;
      const dM = (pts[hi].distKm - pts[lo].distKm) * 1000;
      return dM > 3 ? ((pts[hi].alt - pts[lo].alt) / dM) * 100 : 0;
    });
    const base = chartOptions();
    _analysisClimbChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ data: alt, borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,0.18)', fill: true, pointRadius: 0, borderWidth: 2, cubicInterpolationMode: 'monotone' }] },
      options: {
        ...base,
        plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, displayColors: false,
          callbacks: {
            title: (items) => `${items[0].label} km`,
            label: (item) => `${Math.round(item.raw)} m · pente ${grades[item.dataIndex] >= 0 ? '+' : ''}${grades[item.dataIndex].toFixed(1)}%`,
          } } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, maxTicksLimit: 6 } } },
      }
    });
  } catch (e) { console.error('renderClimbFocusChart:', e); }
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
  // _weeksNearDate (pas findWeekForDate) : une activite decalee hors de sa
  // semaine calendaire stricte (cf openActivityLinkPicker) doit quand meme
  // voir apparaitre ce bouton, sinon la marge de rattrapage est invisible.
  if (!_weeksNearDate(activity.date).length) return '';
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
