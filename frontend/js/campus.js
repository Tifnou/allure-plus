// ....................................................
// CAMPUS COACH ? Module frontend v2
// Entraînements (plan complet avec séances) + Objectifs
// ....................................................

// "?"? Catégories de séances ? couleurs "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
const TRAINING_CATEGORIES = {
  'gpp':                                  { label: 'Renforcement',        color: '#ede7f6', border: '#9575cd', text: '#4a148c' },
  // Trail
  'trail_basic_endurance':                { label: 'EF',                  color: '#e8f5e9', border: '#66bb6a', text: '#1b5e20' },
  'trail_basic_endurance_with_straight_lines': { label: 'EF + Lignes droites', color: '#e8f5e9', border: '#66bb6a', text: '#1b5e20' },
  'trail_long_run':                       { label: 'Sortie Longue',        color: '#c8e6c9', border: '#43a047', text: '#1b5e20' },
  'trail_intensity':                      { label: 'Intensité',            color: '#fff3e0', border: '#ffa726', text: '#e65100' },
  'trail_threshold':                      { label: 'Seuil',               color: '#fff3e0', border: '#ffa726', text: '#e65100' },
  'trail_threshold_uphill':               { label: 'Seuil Côte',          color: '#fff3e0', border: '#ff7043', text: '#bf360c' },
  'trail_vma':                            { label: 'VMA',                 color: '#fce4ec', border: '#ef5350', text: '#b71c1c' },
  'trail_vma_uphill':                     { label: 'VMA Côte',            color: '#fce4ec', border: '#e53935', text: '#b71c1c' },
  'trail_race_simulation':                { label: 'Allure Course',       color: '#e3f2fd', border: '#1e88e5', text: '#0d47a1' },
  'trail_special':                        { label: 'Spécial',             color: '#e3f2fd', border: '#64b5f6', text: '#0d47a1' },
  'trail_competition':                    { label: 'Course',              color: '#e8eaf6', border: '#3f51b5', text: '#1a237e' },
  // Route
  'road_basic_endurance':                 { label: 'EF',                  color: '#e8f5e9', border: '#66bb6a', text: '#1b5e20' },
  'road_basic_endurance_with_straight_lines': { label: 'EF + Lignes droites', color: '#e8f5e9', border: '#66bb6a', text: '#1b5e20' },
  'road_long_run':                        { label: 'Sortie Longue',        color: '#c8e6c9', border: '#43a047', text: '#1b5e20' },
  'road_intensity':                       { label: 'Intensité',            color: '#fff3e0', border: '#ffa726', text: '#e65100' },
  'road_threshold':                       { label: 'Seuil',               color: '#fff3e0', border: '#ffa726', text: '#e65100' },
  'road_threshold_intervals':             { label: 'Seuil Fractionné',    color: '#fff3e0', border: '#ff7043', text: '#bf360c' },
  'road_vma':                             { label: 'VMA',                 color: '#fce4ec', border: '#ef5350', text: '#b71c1c' },
  'road_vma_intervals':                   { label: 'VMA Fractionné',      color: '#fce4ec', border: '#e53935', text: '#b71c1c' },
  'road_race_simulation':                 { label: 'Allure Course',       color: '#e3f2fd', border: '#1e88e5', text: '#0d47a1' },
  'road_race_pace':                       { label: 'Allure Course',       color: '#e3f2fd', border: '#1e88e5', text: '#0d47a1' },
  'road_strides':                         { label: 'Lignes droites',      color: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' },
  'road_hill_repeats':                    { label: 'Répétitions côte',    color: '#fff3e0', border: '#ff7043', text: '#bf360c' },
  // Communs
  'competition':                          { label: 'Compétition',         color: '#e8eaf6', border: '#3f51b5', text: '#1a237e' },
  'trail_race':                           { label: 'Compétition',         color: '#e8eaf6', border: '#3f51b5', text: '#1a237e' },
  'road_race':                            { label: 'Compétition',         color: '#e8eaf6', border: '#3f51b5', text: '#1a237e' },
};

function getCategoryStyle(cat) {
  return TRAINING_CATEGORIES[cat] || { label: cat || 'Séance', color: '#f5f5f5', border: '#bdbdbd', text: '#616161' };
}

// "?"? Formatage "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function fmtDate(ts) {
  if (!ts) return '?';
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateLong(ts) {
  if (!ts) return '?';
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDuration(secs) {
  if (!secs) return '?';
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2,'0')}`;
  if (m > 0) return s > 0 ? `${m} min ${s}"` : `${m} min`;
  return `${s}"`; // Moins d'une minute : afficher les secondes
}
function fmtPace(secsPerKm) {
  if (!secsPerKm) return '?';
  const total = Math.round(secsPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${s.toString().padStart(2,'0')}"`;
}
function fmtWeekRange(ts) {
  const start = new Date(ts);
  const end   = new Date(ts + 6 * 86400000);
  return `${start.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} → ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/** Minuit local de la date donnée (ignore l'heure) - les weekDate fournis
 *  par Campus ne sont pas toujours à minuit pile (ex: stockés à midi UTC),
 *  ce qui décalait la bascule "semaine en cours" à midi au lieu de minuit.
 *  Comparer les dates normalisées au jour près évite ce décalage. */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "now" tombe-t-il dans la semaine calendaire de weekDate (7 jours, au
 *  jour près) ? Remplace les comparaisons directes now/weekDate en
 *  millisecondes, sensibles à l'heure exacte stockée par Campus. */
function isNowInWeek(now, weekDate) {
  const dayNow = startOfDay(now), dayWeek = startOfDay(weekDate);
  return dayNow >= dayWeek && dayNow < dayWeek + 7 * 86400000;
}

// Traduction des zones d'allure (anglais → français)
// ─── Table de référence Allure+ (Campus Coach definitions officielles) ───────
// Campus indique le TYPE d'effort (S60, S30, EF...) → Allure+ calcule la valeur exacte
// depuis la VMA Garmin (VO2max). On n'utilise JAMAIS les allures historiques de Campus.
// S60 = allure tenable 60min = limite basse seuil anaérobie = 79-83% VMA
// S30 = allure tenable 30min = limite haute seuil anaérobie = 86-88% VMA
// Sweet Spot = 95% de la vitesse S60 (définition officielle Campus Coach)
// fcZone : correspondance FC generalement observee (reperage qualitatif,
// jamais une egalite stricte — %VMA et %FC reserve ne se recouvrent jamais
// parfaitement point par point). Affichee en plage, jamais en valeur unique.
const ALLURE_PLUS_ZONES = {
  // RECOVER : pas d'allure cible (allure libre selon forme du jour)
  RECOVER:    { pctLow: 0.55, pctHigh: 0.62, label: 'Récupération',             color: '#94a3b8', noTarget: true },
  EF:         { pctLow: 0.62, pctHigh: 0.70, label: 'EF — Endurance fond.',    color: '#4ade80', trailCorr: 0.07, fcZone: 'Z1 haute à Z2' },
  TEMPO:      { pctLow: 0.71, pctHigh: 0.75, label: 'Tempo',                    color: '#a3e635', trailCorr: 0.07, fcZone: 'Z2 haute à Z3 basse' },
  AS42:       { pctLow: 0.76, pctHigh: 0.79, label: 'AS42 — Allure Marathon',   color: '#818cf8', trailCorr: 0.07, fcZone: 'Z3' },
  SWEET_SPOT: { pctLow: 0.80, pctHigh: 0.83, label: 'Sweet Spot',               color: '#facc15', isSweetSpot: true, trailCorr: 0.07, fcZone: 'Z3 moyenne à haute' },
  AS21:       { pctLow: 0.82, pctHigh: 0.85, label: 'AS21 — Allure Semi',      color: '#fb923c', trailCorr: 0.07, fcZone: 'Z3 haute à Z4 basse' },
  S60:        { pctLow: 0.84, pctHigh: 0.87, label: 'S60 — Seuil 60min',       color: '#f97316', trailCorr: 0.07, fcZone: 'Z4 basse à moyenne' },
  AS10:       { pctLow: 0.88, pctHigh: 0.91, label: 'AS10 — Allure 10km',      color: '#c084fc', trailCorr: 0.08, fcZone: 'Z4 moyenne à haute' },
  S30:        { pctLow: 0.92, pctHigh: 0.94, label: 'S30 — Seuil 30min',       color: '#f87171', trailCorr: 0.07, fcZone: 'Z4 haute à Z5 basse' },
  VMA:        { pctLow: 0.95, pctHigh: 1.05, label: 'VMA',                      color: '#e879f9', trailCorr: 0.10, fcZone: 'Z5' },
};

// Calcule min/max allure (sec/km) pour une zone et une VMA données
function calcAllureRef(zoneKey, vma) {
  const ref = ALLURE_PLUS_ZONES[zoneKey];
  if (!ref || !vma) return null;
  let pL = ref.pctLow, pH = ref.pctHigh;
  if (ref.isSweetSpot) { // Sweet Spot = 95% vitesse S60
    pL = ALLURE_PLUS_ZONES.S60.pctLow  * 0.95;
    pH = ALLURE_PLUS_ZONES.S60.pctHigh * 0.95;
  }
  return {
    paceMin: Math.round(3600 / (vma * pH)), // allure rapide sec/km
    paceMax: Math.round(3600 / (vma * pL)), // allure lente  sec/km
    label:   ref.label,
    color:   ref.color,
  };
}

// Détecte si une séance doit utiliser les allures Trail
// Detecte si une seance doit utiliser les allures Trail
// Règle : Trail si D+, uphill, texte "cote/EN COTE/montée", ou compétition trail
function isTrailSession(session) {
  const cat  = (session.trainingCategory || '').toLowerCase();
  const name = (session.displayName || session.name || '').toLowerCase();
  const desc = (session.description  || '').toLowerCase();
  const combined    = name + ' ' + desc;
  const hasUphill   = cat.includes('uphill');
  const hasElev     = (session.stats?.expectedElevationGain || 0) > 0;
  // Detection textuelle : "cote", "côte", "montee", "montée", "uphill"
  // On cherche le mot "cote" (avec ou sans accent, majuscule ou non)
  const hasCoteText = combined.includes('cote') || combined.includes('côte') ||
                      combined.includes('montée') || combined.includes('montee') ||
                      combined.includes('uphill');
  // "competition" seul (TRAINING_CATEGORIES) est une categorie AMBIGUE
  // partagee route/trail (course de preparation sur route au sein d'un plan
  // trail, par ex.) — seul le prefixe explicite 'trail_' (trail_competition)
  // garantit que CETTE seance precise se court sur terrain trail ; se fier a
  // l'objectif global du plan (goalType) faisait passer en allures trail
  // (plus lentes) des courses de prepa sur route sans D+ ni cote.
  const isCompTrail = cat.includes('trail_competition');
  return hasUphill || hasElev || hasCoteText || isCompTrail;
}

// Calcule les allures Trail = allures route × (1 + trailCorr de la zone)
function calcAllureRefTrail(zoneKey, vma) {
  const base = calcAllureRef(zoneKey, vma);
  if (!base) return null;
  const corr = (ALLURE_PLUS_ZONES[zoneKey]?.trailCorr || 0);
  if (corr === 0) return base;
  return {
    ...base,
    paceMin: Math.round(base.paceMin * (1 + corr)),
    paceMax: Math.round(base.paceMax * (1 + corr)),
    isTrail: true,
    trailCorr: corr,
  };
}

// ═══════════════════════════════════════════════════════
// Résolution de zone depuis pace.slug (fichier .aplus)
// SOURCE DE VÉRITÉ : le champ pace.slug fourni par Campus dans
// exercisesBlocks est fiable à 100% (contrairement au code générique
// Z1-Z5 + devinette sur le nom de séance, qui produisait des erreurs
// comme "Big Five" classée entièrement en S60 au lieu de S30/Sweet Spot).
// ⚠️ Ce bloc doit rester identique à celui de zones.js (serveur).
// ═══════════════════════════════════════════════════════
const SLUG_TO_ZONE = {
  'ef': 'EF', 'endurance-fondamentale': 'EF',
  'slow': 'RECOVER', 'endurance-confort': 'RECOVER',
  'tempo': 'TEMPO', 'aerobie': 'TEMPO', 'endurance-active': 'TEMPO',
  'sweet-spot': 'SWEET_SPOT',
  'seuil60': 'S60',
  'seuil30': 'S30',
  '10km': 'AS10',
  'half-marathon': 'AS21',
  'marathon': 'AS42',
  'vo2max': 'VMA', 'vma': 'VMA', 'fast': 'VMA', 'sprint': 'VMA',
};

// "race" = allure de course cible. Son sens dépend de la distance de l'objectif.
// En trail (ou objectif inconnu), pas de zone AS pertinente → repli sur EF
// (les valeurs D+ ayant servi à générer le plan ne sont pas celles du coureur réel).
const RACE_GOAL_ZONE = { '10km': 'AS10', 'half-marathon': 'AS21', 'marathon': 'AS42' };

// Résout la zone Allure+ d'un exercice depuis pace.slug (fiable),
// avec repli sur le code générique zoneKind si le slug est absent/inconnu.
//
// Exception connue : les segments de retour au calme (exercices "CD_N")
// portent un slug "endurance-fondamentale" (decrit l'allure cible, confort)
// mais un zoneKind "RECOVER" (leur role structurel dans la seance). Le
// zoneKind doit l'emporter ici, sinon un retour au calme s'affiche a tort
// comme un segment EF (verifie sur plusieurs seances reelles).
function resolveZoneFromExercise(pace, zoneKind, goalType) {
  const slug = (pace?.slug || '').toLowerCase();
  const zk   = (zoneKind || pace?.zoneKind || '').toUpperCase();

  if (['RECOVER','RECOVERY','REST','REPOS'].includes(zk)) return 'RECOVER';
  if (slug === 'race') {
    return (goalType && RACE_GOAL_ZONE[goalType]) ? RACE_GOAL_ZONE[goalType] : 'EF';
  }
  if (slug && SLUG_TO_ZONE[slug]) return SLUG_TO_ZONE[slug];

  // Repli : code générique Campus (utilisé seulement si le slug manque)
  if (['WARMUP','COOLDOWN'].includes(zk)) return 'EF';
  if (zk === 'Z1' || zk === 'Z2') return 'EF';
  if (zk === 'Z3') return 'TEMPO';
  if (zk === 'Z4') return 'S60';
  if (zk === 'Z5') return 'VMA';
  return null;
}

// Aplatit exercisesBlocks (en respectant "repeat") dans le même ordre que
// session.paceZones, pour retrouver le pace.slug de chaque zone
// (paceZones ne contient que kind/duration/pace.value, pas le slug).
function flattenExercisePaces(session) {
  const out = [];
  (session.exercisesBlocks || []).forEach(block => {
    const repeat = block.repeat || 1;
    for (let r = 0; r < repeat; r++) {
      (block.exercises || []).forEach(ex => out.push(ex.pace || null));
    }
  });
  return out;
}

// Annote chaque entrée de session.paceZones avec sa zone Allure+ résolue (resolvedZone)
function annotatePaceZones(session, goalType) {
  const paces = flattenExercisePaces(session);
  const zones = session.paceZones || [];
  return zones.map((z, i) => ({ ...z, resolvedZone: resolveZoneFromExercise(paces[i], z.kind, goalType) }));
}

// Mappe le couple (nom de séance, kind Campus) vers une clé ALLURE_PLUS_ZONES
// Règle absolue : Campus dit le TYPE, Allure+ calcule la VALEUR
function resolveAllurePlusZone(sessionName, zoneKind) {
  const n = (sessionName || '').toLowerCase();
  const k = (zoneKind   || '').toUpperCase();

  // Récupération : prioritaire
  if (['RECOVER','RECOVERY','REST','REPOS'].includes(k)) return 'RECOVER';
  if (['WARMUP','COOLDOWN'].includes(k))                  return 'EF';
  if (k === 'Z1')                                         return 'EF';

  // Codes de zone directs (Campus peut les envoyer explicitement)
  if (['AS42','AS_42'].includes(k))              return 'AS42';
  if (['AS21','AS_21','SEMI','HM'].includes(k))  return 'AS21';
  if (['AS10','AS_10'].includes(k))              return 'AS10';
  if (['S30','S_30'].includes(k))                return 'S30';
  if (['S60','S_60'].includes(k))                return 'S60';
  if (['SWEET_SPOT','SWEETSPOT'].includes(k))    return 'SWEET_SPOT';

  // Détection depuis le nom de séance (priorité haute)
  if (/sweet[\s_-]?spot/i.test(n))                                    return 'SWEET_SPOT';
  if (/\bvma\b|vo2[\s_-]?max/i.test(n) && k !== 'Z2')               return 'VMA';
  if (/(s30|seuil[\s_-]?30|seuil 30)/i.test(n) && !['Z1','Z2'].includes(k)) return 'S30';
  if (/(s60|seuil[\s_-]?60|seuil 60)/i.test(n) && !['Z1','Z2','RECOVER','RECOVERY'].includes(k)) return 'S60';
  if (/\btempo\b/i.test(n) && ['Z2','Z3'].includes(k))               return 'TEMPO';

  // Détection allures spécifiques course depuis le NOM DE SÉANCE
  // Uniquement pour les zones de type seuil/tempo (Z3, Z4, ou code inconnu) — PAS Z5 (VMA)
  const isThresholdKind = !['Z1','Z2','Z5','RECOVER','RECOVERY','WARMUP','COOLDOWN'].includes(k);
  if (isThresholdKind) {
    // AS42 = allure marathon (42km)
    if (/\b42[\s.]?km\b|\bas42\b|allure[\s_-]*marathon\b/i.test(n))          return 'AS42';
    // AS21 = allure semi-marathon (21km)
    if (/\b21[\s.]?km\b|\bas21\b|allure[\s_-]*21\b|allure[\s_-]*semi\b/i.test(n)) return 'AS21';
    // AS10 = allure 10km
    if (/\b10[\s.]?km\b|\bas10\b/i.test(n))                                      return 'AS10';
  }

  // Fallback kind Campus
  if (k === 'Z2') return 'EF';
  if (k === 'Z3') return 'TEMPO'; // Z3 Campus = zone tempo (Sortie Longue Active, Kenyans...)
  if (k === 'Z4') return 'S60';   // Z4 Campus = seuil générique (S60 par défaut)
  if (k === 'Z5') return 'VMA';
  return null;
}

// Formateur de label de zone (avec nom de séance pour la résolution)
function fmtZoneKind(kind, sessionName) {
  if (!kind) return '?';
  const zk = resolveAllurePlusZone(sessionName, kind);
  if (zk && ALLURE_PLUS_ZONES[zk]) return ALLURE_PLUS_ZONES[zk].label;
  const fallback = { 'Z2':'EF','Z3':'AS42 — Allure Marathon','Z4':'S60','Z5':'VMA',
    'RECOVER':'Récupération','RECOVERY':'Récupération',
    'WARMUP':'Échauffement','COOLDOWN':'Retour au calme','GPP':'PPG' };
  return fallback[kind.toUpperCase()] || kind;
}

// matchZoneFromPace : retourne une clé ALLURE_PLUS_ZONES depuis une allure + VMA
// Seuils derives directement de ALLURE_PLUS_ZONES (mi-point entre pctHigh d'une zone
// et pctLow de la suivante), dans l'ordre d'intensite croissante des cles du fichier -
// evite la desynchronisation d'anciens seuils recopies a la main (qui ne renvoyaient
// par exemple jamais SWEET_SPOT, absorbee a tort par AS42/AS21).
const ZONE_ORDER = Object.keys(ALLURE_PLUS_ZONES);
function matchZoneFromPace(paceSecKm, vma) {
  if (!paceSecKm || !vma) return null;
  const pct = (3600 / paceSecKm) / vma;
  for (let i = 0; i < ZONE_ORDER.length - 1; i++) {
    const cur = ALLURE_PLUS_ZONES[ZONE_ORDER[i]];
    const next = ALLURE_PLUS_ZONES[ZONE_ORDER[i + 1]];
    if (pct < (cur.pctHigh + next.pctLow) / 2) return ZONE_ORDER[i];
  }
  return ZONE_ORDER[ZONE_ORDER.length - 1]; // VMA
}

// Convertit le markdown **gras** en HTML <strong>
function mdBold(text) {
  if (!text) return '';
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}


// "?"? ?tat global "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
let campusState = {
  connected: false,
  goal: null,
  weeks: [],
  selectedWeekIdx: -1,
  openSessionIdx: -1,
  fitness: null,
  campusConnected: false,    // connecte avec compte Campus
  campusHasPlan: false,      // Campus a un plan actif confirmé
  usingImportedPlan: false,  // plan charge depuis fichier importe
};

// "?"? Suivi local des seances (utilisateurs sans Campus) "?"?
const LOCAL_DONE_KEY = 'suivi_local_done';
function _getLocalDoneMap() {
  try { return JSON.parse(localStorage.getItem(LOCAL_DONE_KEY) || '{}'); } catch(e) { return {}; }
}
function getLocalSessionStatus(weekId, trainingIndex) {
  return _getLocalDoneMap()[weekId + '_' + trainingIndex] || null;
}
function markSessionDone(weekId, trainingIndex) {
  const m = _getLocalDoneMap(); m[weekId + '_' + trainingIndex] = 'done';
  localStorage.setItem(LOCAL_DONE_KEY, JSON.stringify(m));
  renderSessionList(campusState.selectedWeekIdx);
  // Proposer de lier une activite Garmin reelle juste apres validation, si la
  // seance s'y prete (pas PPG/competition) et n'est pas deja liee.
  if (typeof openSessionLinkPicker === 'function' && typeof _analysisIndex !== 'undefined') {
    const week = (campusState.weeks || []).find(w => w._id === weekId);
    const session = week?.sessions?.find(s => (s.trainingIndex ?? 0) === Number(trainingIndex));
    const already = _analysisIndex.bySession[_analysisSessionKey(weekId, trainingIndex)];
    if (session && !already && typeof isSessionAnalysable === 'function' && isSessionAnalysable(session)) {
      openSessionLinkPicker(weekId, trainingIndex);
    }
  }
}
function markSessionSkip(weekId, trainingIndex) {
  const m = _getLocalDoneMap(); m[weekId + '_' + trainingIndex] = 'skip';
  localStorage.setItem(LOCAL_DONE_KEY, JSON.stringify(m));
  renderSessionList(campusState.selectedWeekIdx);
}
function clearSessionStatus(weekId, trainingIndex) {
  const m = _getLocalDoneMap(); delete m[weekId + '_' + trainingIndex];
  localStorage.setItem(LOCAL_DONE_KEY, JSON.stringify(m));
  renderSessionList(campusState.selectedWeekIdx);
}

// Les semaines des plans du catalogue portent un _id fige dans le fichier
// .aplus (identique a chaque chargement) : on l'utilise pour detecter si CE
// plan precis a deja des seances marquees Fait/Manque d'une utilisation
// anterieure (ex: la meme course rechargee des annees plus tard).
function planHasResidualProgress(weeks) {
  try {
    const weekIds = new Set((weeks || []).map(w => w._id).filter(Boolean));
    if (weekIds.size === 0) return false;
    const map = _getLocalDoneMap();
    return Object.keys(map).some(k => weekIds.has(k.split('_')[0]));
  } catch (e) { return false; }
}
// Purge uniquement les marques appartenant aux semaines de CE plan (jamais
// les marques d'autres plans, meme charges en parallele).
function purgeLocalDoneForWeeks(weeks) {
  try {
    const weekIds = new Set((weeks || []).map(w => w._id).filter(Boolean));
    const map = _getLocalDoneMap();
    let changed = false;
    Object.keys(map).forEach(k => {
      if (weekIds.has(k.split('_')[0])) { delete map[k]; changed = true; }
    });
    if (changed) localStorage.setItem(LOCAL_DONE_KEY, JSON.stringify(map));
  } catch (e) { /* silencieux */ }
}

// ......................................................
// PAGE ENTRAZNEMENTS
// ......................................................

// ──────────────────────────────────────────────────────────────
// Nettoyage ciblé des métadonnées obsolètes dans localStorage
// Version : 3.0  — efface le plan si l'utilisateur a changé
// ──────────────────────────────────────────────────────────────
const APP_LS_VERSION = '3.0';
const APP_LS_VERSION_KEY = 'allureplus_data_version';

function cleanStaleLocalStorage() {
  const storedVersion = localStorage.getItem(APP_LS_VERSION_KEY);
  if (storedVersion === APP_LS_VERSION) return; // déjà à jour, rien à faire

  console.log('[Migration] Nettoyage localStorage v' + (storedVersion || '?') + ' → v' + APP_LS_VERSION);

  // v3.0 : supprimer le plan hérité d'une session précédente
  // (sera rechargé proprement si l'utilisateur a Campus)
  localStorage.removeItem('suivi_imported_plan');
  localStorage.removeItem('allureplus_plan_owner'); // clé propriétaire
  console.log('[Migration v3.0] Plan et owner supprimés (nouveau schéma par utilisateur)');

  // Marquer la version actuelle
  localStorage.setItem(APP_LS_VERSION_KEY, APP_LS_VERSION);
  console.log('[Migration] localStorage migration terminée → v' + APP_LS_VERSION);
}

// Efface le plan si l'utilisateur connecté a changé depuis la dernière session
function cleanPlanIfUserChanged(currentUserEmail) {
  if (!currentUserEmail) return;
  const storedOwner = localStorage.getItem('allureplus_plan_owner');
  if (storedOwner && storedOwner !== currentUserEmail) {
    console.log('[Sécurité] Utilisateur changé (' + storedOwner + ' → ' + currentUserEmail + ') — plan effacé');
    localStorage.removeItem('suivi_imported_plan');
    localStorage.removeItem('allureplus_plan_owner');
  }
  // Enregistrer le propriétaire actuel
  localStorage.setItem('allureplus_plan_owner', currentUserEmail);
}

async function initCampus() {
  // ── Anti-flash : si un plan est déjà en localStorage, masquer immédiatement
  // le formulaire de connexion avant l'appel async pour éviter le scintillement
  if (localStorage.getItem('suivi_imported_plan') || localStorage.getItem('prefer_imported_plan') === 'true') {
    const _cc = document.getElementById('campus-connect-card');
    const _cl = document.getElementById('campus-loading');
    if (_cc) _cc.style.display = 'none';
    if (_cl) _cl.style.display = 'flex';
  }

  // Nettoyage ciblé des données obsolètes (ne touche pas au plan)
  cleanStaleLocalStorage();

  const el = id => document.getElementById(id);
  try {
    const status = await fetchJSON('/api/campus/status');

    // Effacer le plan si l'utilisateur a changé depuis la dernière session
    cleanPlanIfUserChanged(status.campusEmail || status.garminEmail || null);

    // Pré-remplir l'email du formulaire avec l'adresse depuis .env
    const emailInput = el('campus-email');
    if (emailInput && status.campusEmail && !emailInput.value) {
      emailInput.value = status.campusEmail;
    }

    // Si Campus désactivé (pas de compte) → chercher plan importé côté serveur uniquement
    // RÈGLE : PAS de fallback localStorage → évite le "plan fantôme" sur autre PC
    if (status.campusEnabled === false) {
      localStorage.setItem('campus_hidden', 'true');
      const connectCard = el('campus-connect-card');
      const loading     = el('campus-loading');
      if (connectCard) connectCard.style.display = 'none';
      if (loading)     loading.style.display = 'none';
      const importZone = el('campus-import-only');
      if (importZone) importZone.style.display = '';
      let planLoaded = false;
      // 1. Essayer le plan côté serveur (toujours prioritaire)
      try {
        const test = await fetchJSON('/api/campus/training');
        if (test && test.weeks) {
          campusState.campusConnected = false;
          campusState.usingImportedPlan = true;
          const fitness = await fetchJSON('/api/fitness').catch(() => null);
          if (fitness?.zones) campusState.fitness = fitness;
          showTrainingLoading();
          renderTrainingPlan(test.goal, test.weeks);
          planLoaded = true;
        }
      } catch(e) {
        // Le serveur n'a pas le plan (redémarrage) → on NE supprime PAS localStorage
        // On va le récupérer depuis localStorage ci-dessous et le re-envoyer au serveur
      }

      // 2. Fallback localStorage : restaurer le plan ET le re-synchroniser avec le serveur
      if (!planLoaded) {
        try {
          const localRaw = localStorage.getItem('suivi_imported_plan');
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData?.goal && Array.isArray(localData?.weeks)) {
              campusState.campusConnected = false;
              campusState.usingImportedPlan = true;
              const fitness = await fetchJSON('/api/fitness').catch(() => null);
              if (fitness?.zones) campusState.fitness = fitness;
              showTrainingLoading();
              renderTrainingPlan(localData.goal, localData.weeks);
              // Re-synchroniser avec le serveur silencieusement (serveur vient de redémarrer)
              fetch('/api/campus/import-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: localRaw,
              }).catch(() => {});
              planLoaded = true;
              console.log('[Plan] Restauré depuis localStorage après redémarrage serveur');
            }
          }
        } catch(e2) {
          // Ne pas supprimer le plan si c'est juste une erreur de rendu
          // Supprimer UNIQUEMENT si le JSON est invalide
          if (e2 instanceof SyntaxError) {
            localStorage.removeItem('suivi_imported_plan');
            console.warn('[Plan] localStorage plan supprimé (JSON invalide)');
          } else {
            console.error('[Plan] Erreur rendu plan localStorage (plan conservé):', e2);
          }
        }
      }

      if (!planLoaded) { showTrainingEmpty(); }
      return;

    }

    if (status.connected) {
      // Si l'utilisateur a explicitement choisi d'utiliser un plan importé,
      // on le charge même si Campus est connecté avec un plan actif
      const preferImported = localStorage.getItem('prefer_imported_plan') === 'true';
      const localRaw = localStorage.getItem('suivi_imported_plan');
      if (preferImported && localRaw) {
        try {
          const localData = JSON.parse(localRaw);
          if (localData?.goal && Array.isArray(localData?.weeks)) {
            campusState.campusConnected = true;   // Campus connecté mais on utilise plan importé
            campusState.usingImportedPlan = true;
            campusState.campusHasPlan = false;   // sera confirmé par vérification arrière-plan
            localStorage.setItem('campus_was_connected', 'true');
            const fitness = await fetchJSON('/api/fitness').catch(() => null);
            if (fitness?.zones) campusState.fitness = fitness;
            showTrainingLoading();
            // Re-synchroniser le plan avec le serveur (peut avoir redémarré)
            fetch('/api/campus/import-plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: localRaw,
            }).catch(() => {});
            renderTrainingPlan(localData.goal, localData.weeks);

            // Vérification arrière-plan : Campus a-t-il un plan actif ?
            fetchJSON('/api/campus/training').then(d => {
              campusState.campusHasPlan = !!(d && Array.isArray(d.weeks) && d.weeks.length > 0);
              const btn = document.getElementById('btn-back-to-campus');
              if (btn) btn.style.display = campusState.campusHasPlan ? '' : 'none';
            }).catch(() => { campusState.campusHasPlan = false; });

            return;
          }
        } catch(e) {
          console.error('[Plan] Erreur rendu plan importé (prefer_imported_plan conservé):', e);
          // Ne pas supprimer prefer_imported_plan sur erreur de rendu
          // Laisser loadTrainingPlan retenter via le fallback localStorage
        }
      }
      // Pas de préférence → plan Campus par défaut
      campusState.campusConnected = true;
      campusState.usingImportedPlan = false;
      localStorage.setItem('campus_was_connected', 'true');
      showTrainingLoading();
      await loadTrainingPlan();

    } else {
      // Vérifier si plan importé disponible côté serveur
      let planLoaded = false;
      try {
        const test = await fetchJSON('/api/campus/training');
        if (test && test.weeks) {
          campusState.campusConnected = false;
          campusState.usingImportedPlan = true;
          const fitness = await fetchJSON('/api/fitness').catch(() => null);
          if (fitness?.zones) campusState.fitness = fitness;
          showTrainingLoading();
          renderTrainingPlan(test.goal, test.weeks);
          planLoaded = true;
        }
      } catch(e) {
        // 404 noPlan → effacer localStorage stale
        if (e && (e.noPlan || (e.status && e.status === 404))) {
          localStorage.removeItem('suivi_imported_plan');
        }
      }

      // Fallback localStorage (plan en cours de sync, utilisateur connecté)
      if (!planLoaded) {
        try {
          const localRaw = localStorage.getItem('suivi_imported_plan');
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData?.goal && Array.isArray(localData?.weeks)) {
              campusState.campusConnected = false;
              campusState.usingImportedPlan = true;
              const fitness = await fetchJSON('/api/fitness').catch(() => null);
              if (fitness?.zones) campusState.fitness = fitness;
              showTrainingLoading();
              renderTrainingPlan(localData.goal, localData.weeks);
              fetch('/api/campus/import-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: localRaw,
              }).catch(() => {});
              planLoaded = true;
            }
          }
        } catch(e2) { /* localStorage invalide */ }
      }

      if (!planLoaded) {
        el('campus-connect-card').style.display = '';
        el('campus-loading').style.display = 'none';
      }
    }
  } catch(e) {
    el('campus-connect-card').style.display = '';
    el('campus-loading').style.display = 'none';
  }
}

function showTrainingLoading() {
  const el = id => document.getElementById(id);
  el('campus-connect-card').style.display = 'none';
  el('campus-loading').style.display = 'flex';
  el('campus-plan-wrap').style.display = 'none';
}

// Affiche l'etat vierge : aucun plan importe
// Montre la carte de connexion mais en mode "import uniquement"
// (masque le formulaire Campus Coach, garde uniquement le bouton d'import)
function showTrainingEmpty() {
  const el = id => document.getElementById(id);
  // Afficher la carte principale
  if (el('campus-connect-card')) el('campus-connect-card').style.display = '';
  // Masquer le spinner et le plan
  if (el('campus-loading'))      el('campus-loading').style.display = 'none';
  if (el('campus-plan-wrap'))    el('campus-plan-wrap').style.display = 'none';
  // Masquer le bloc de connexion Campus Coach et le séparateur
  if (el('campus-login-block'))  el('campus-login-block').style.display = 'none';
  if (el('campus-login-sep'))    el('campus-login-sep').style.display = 'none';
  // S'assurer que le bloc import est visible
  if (el('campus-import-only'))  el('campus-import-only').style.display = '';
  // Sous-titre header : pas de mention "Campus Coach" si pas de compte
  const sub = el('campus-plan-subtitle');
  if (sub) sub.textContent = 'En attente d\'un Plan d\'entraînement';
  // Adapter le message de la carte
  const msg = el('campus-connect-msg');
  if (msg) msg.textContent = 'Importez un plan partagé par votre coach (.aplus).';
  // Masquer le bouton déconnexion Campus
  const disconnectBtn = el('campus-disconnect-btn');
  if (disconnectBtn) disconnectBtn.style.display = 'none';
}

// ── Préchargement silencieux du plan (sans toucher au DOM) ──────────
// Permet à la page Objectifs de fonctionner même sans visiter Entrainements
async function preloadPlanState() {
  if (campusState.goal) return; // déjà chargé
  try {
    // 1. Priorité : localStorage (rapide, offline)
    const localRaw = localStorage.getItem('suivi_imported_plan');
    if (localRaw) {
      const localData = JSON.parse(localRaw);
      if (localData?.goal && Array.isArray(localData.weeks)) {
        campusState.goal              = localData.goal;
        campusState.weeks             = localData.weeks;
        campusState.usingImportedPlan = true;
        return;
      }
    }
    // 2. Fallback serveur
    const data = await fetchJSON('/api/campus/training');
    if (data?.goal) {
      campusState.goal  = data.goal;
      campusState.weeks = data.weeks || [];
    }
  } catch(e) { /* silencieux */ }
}

async function loadTrainingPlan() {
  const el = id => document.getElementById(id);
  // Si plan importé préféré (même avec Campus connecté) → charger depuis localStorage
  if (localStorage.getItem('prefer_imported_plan') === 'true') {
    const localRaw = localStorage.getItem('suivi_imported_plan');
    if (localRaw) {
      try {
        const localData = JSON.parse(localRaw);
        if (localData?.goal && Array.isArray(localData.weeks)) {
          campusState.usingImportedPlan = true;
          const fitness = await fetchJSON('/api/fitness').catch(() => null);
          if (fitness?.zones) campusState.fitness = fitness;
          // Re-sync serveur silencieux
          fetch('/api/campus/import-plan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: localRaw,
          }).catch(() => {});
          renderTrainingPlan(localData.goal, localData.weeks);
          return;
        }
      } catch(e) { localStorage.removeItem('prefer_imported_plan'); }
    }
  }
  try {
    const [data, fitness] = await Promise.all([
      fetchJSON('/api/campus/training'),
      fetchJSON('/api/fitness').catch(() => null),
    ]);
    if (fitness?.zones) campusState.fitness = fitness;
    campusState.campusHasPlan = !!(data.weeks && data.weeks.length > 0);
    renderTrainingPlan(data.goal, data.weeks || []);
  } catch(err) {
    el('campus-loading').style.display = 'none';

    // Plan importé en local (localStorage) - fonctionne sans serveur Campus
    const localPlanRaw = localStorage.getItem('suivi_imported_plan');
    if (localPlanRaw) {
      try {
        const localData = JSON.parse(localPlanRaw);
        if (localData?.goal && Array.isArray(localData.weeks)) {
          campusState.usingImportedPlan = true;
          // Cacher la carte de connexion AVANT de rendre le plan
          el('campus-connect-card').style.display = 'none';
          renderTrainingPlan(localData.goal, localData.weeks);
          return;
        }
      } catch(e) {
        console.error('[Campus] Erreur rendu plan localStorage:', e);
        // Plan localStorage corrompu — continuer pour afficher le formulaire
      }
    }

    // Récupérer le statut HTTP de l'erreur de façon robuste
    let errData = null;
    try { errData = JSON.parse(err.message); } catch(e) {}
    // fetchJSON ne set pas toujours err.status → on essaie aussi via le message
    const httpStatus = err.status
      || (err.message && /^HTTP (\d+)/.test(err.message) ? parseInt(err.message.match(/HTTP (\d+)/)[1]) : null)
      || (errData ? 0 : null);
    const authError = errData?.authError || httpStatus === 401 || /401/.test(err.message);
    const notFound  = errData?.authError === false || httpStatus === 404
                      || /404|Aucun plan actif/i.test(err.message);

    if (authError) {
      el('campus-connect-card').style.display = '';
    } else if (notFound) {
      // Connecté mais pas de plan actif → masquer le login, garder uniquement l'import
      if (campusState.campusConnected) {
        showTrainingEmpty();
        const msgEl = el('campus-connect-msg');
        if (msgEl) msgEl.textContent = '✅ Connecté à Campus Coach — aucun plan d\'entraînement actif. Créez un plan sur Campus Coach ou importez un plan partagé (.aplus).';
      } else {
        el('campus-connect-card').style.display = '';
        const msgEl = el('campus-connect-msg');
        if (msgEl) msgEl.textContent = 'Aucun plan actif trouvé sur Campus Coach. Créez un plan ou importez un plan partagé.';
      }
    } else {
      el('campus-connect-card').style.display = '';
      const msgEl = el('campus-connect-msg');
      if (msgEl) msgEl.textContent = 'Erreur de chargement. Vérifiez votre connexion et rechargez la page.';
    }
    console.error('Campus training error:', err);

  }
}

// Calcul de la catégorie trail selon NOS seuils (0-21 / 21-42 / 42-80 / 80+)
// On ignore le trailTitle de Campus Coach qui a ses propres seuils différents
function getTrailCatLabel(km) {
  if (!km || km <= 0) return null;
  if (km <= 21) return 'Court (≤21 km)';
  if (km <= 42) return 'Moyen (21–42 km)';
  if (km <= 80) return 'Long (42–80 km)';
  return 'Ultra (>80 km)';
}

/** Exporte le plan actuellement affiché (campusState.goal/weeks - fonctionne
 *  aussi bien pour un plan Campus Coach en direct que pour un plan importé,
 *  puisqu'on envoie exactement ce qui est déjà chargé à l'écran plutôt que
 *  de laisser le serveur re-deviner la source). */
async function exportPlanXlsx() {
  const goal = campusState.goal;
  const weeks = campusState.weeks;
  if (!goal || !Array.isArray(weeks) || weeks.length === 0) {
    if (typeof showToast === 'function') showToast('Aucun plan chargé à exporter', 'error');
    return;
  }
  const btn = document.getElementById('btn-export-plan-xlsx');
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération...'; }
  try {
    // Meme calcul que le bloc Estimations (Fin de plan) / la carte "Jour de
    // course" - envoyé au serveur car xlsx_export.js (côté serveur) n'a pas
    // accès à la distance/D+ validés ni à la VO2max de l'utilisateur, donc
    // ne peut pas recalculer lui-même la durée calibrée du jour de course.
    const planId = goal._id || 'plan';
    const savedDist  = parseFloat(localStorage.getItem('suivi_objectif_dist_'  + planId)) || 0;
    const savedDplus = parseInt(localStorage.getItem('suivi_objectif_dplus_' + planId)) || 0;
    const isTrailGoal = (goal.goalType || '').toLowerCase().includes('trail');
    const vma = getVmaFromState();
    let raceDayDurationSec = null;
    if (savedDist > 0 && vma) {
      const weeksTotal = goal.durationInWeeks || weeks.length;
      const vmaEnd = vma * (1 + getRemainingVmaGainPct(weeksTotal, weeks));
      raceDayDurationSec = estimateRaceTime(vmaEnd, savedDist, savedDplus, isTrailGoal);
    }

    const res = await fetch(`${API}/api/campus/export-plan-xlsx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, weeks, raceDayDurationSec }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const safeName = (goal.name || goal.goalTitle || 'plan').replace(/[^a-zA-Z0-9-_]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan-${safeName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    if (typeof showToast === 'function') showToast('Export impossible : ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

function renderTrainingPlan(goal, weeks) {
  const el = id => document.getElementById(id);
  campusState.goal  = goal;
  campusState.weeks = weeks;

  const now = Date.now();

  // Trouver la semaine courante
  let currentIdx = weeks.findIndex(w => isNowInWeek(now, w.weekDate));
  if (currentIdx === -1) currentIdx = weeks.length > 0 ? 0 : -1;
  campusState.selectedWeekIdx = currentIdx;

  // "?"? Carte d'en-tête du plan "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
  const goalName = goal?.name || goal?.goalTitle || 'Plan d\'entraînement';
  const goalType = goal?.goalType || '';
  const typeMap  = { 'trail-v2': 'Trail', 'marathon': 'Marathon', 'semi': 'Semi', '10k': '10 km' };
  const typeLabel = typeMap[goalType] || goalType || '';
  const totalWeeks = goal?.durationInWeeks || weeks.length;
  const elapsed = weeks.filter(w => startOfDay(w.weekDate) < startOfDay(now)).length;
  const pct = totalWeeks > 0 ? Math.round((elapsed / totalWeeks) * 100) : 0;
  const compDate = goal?.competitionDate;
  const daysLeft = compDate ? Math.max(0, Math.ceil((new Date(compDate).getTime() - now) / 86400000)) : null;

  const specificData = goal?.specificData || {};
  const planCategory = goal?.planCategory || null;

  // Si le plan vient du catalogue (planCategory présent), afficher les catégories du plan
  // Sinon (plan Campus réel), afficher les données de course réelles
  let raceDesc;
  if (planCategory) {
    // Plan importé depuis le catalogue : afficher distLabel + dplusLabel
    const dplusStr = planCategory.dplusLabel
      ? planCategory.dplusLabel.replace('_', '–') + ' m D+'
      : null;
    raceDesc = [
      planCategory.distLabel || null,
      dplusStr,
    ].filter(Boolean).join(' · ');
  } else {
    // Plan Campus réel : afficher les données de course spécifiques
    // Note : on calcule la catégorie trail nous-mêmes depuis la distance
    // (Campus Coach utilise des seuils différents : ultra = >50km chez eux, >80km chez nous)
    const isTrailGoal = (goalType || '').toLowerCase().includes('trail');
    const trailCat = isTrailGoal ? getTrailCatLabel(specificData.distance) : null;
    raceDesc = [
      specificData.distance    ? `${specificData.distance} km`        : null,
      specificData.elevationGain ? `${specificData.elevationGain} m D+` : null,
      trailCat,
    ].filter(Boolean).join(' · ');
  }

  const planHeader = `
    <div class="training-plan-header card">
      <div class="plan-header-top">
        <div>
          <div class="plan-title">${goalName}</div>
          ${raceDesc ? `<div class="plan-subtitle-desc">${raceDesc}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">
          ${typeLabel ? `<span class="plan-type-badge">${typeLabel}</span>` : ''}
          ${daysLeft !== null ? `<span class="plan-countdown-badge">${daysLeft} jours</span>` : ''}
        </div>
      </div>
      <div class="plan-progress-info">
        <span class="plan-progress-label">Semaine ${Math.max(1,elapsed)} / ${totalWeeks}</span>
        ${compDate ? `<span class="plan-comp-date">${fmtDate(compDate)}</span>` : ''}
      </div>
      <div class="plan-progress-track">
        <div class="plan-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>`;

  // "?"? Sélecteur de semaine (tabs) "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
  const weekTabs = `
    <div class="week-tabs-wrap">
      <div class="week-tabs" id="week-tabs">
        ${weeks.map((w, i) => {
          const isCurrent = i === currentIdx;
          // Basé sur currentIdx (déjà calculé au jour près) plutôt qu'un
          // recalcul de date séparé : évite tout écart de frontière entre
          // les deux (ex: la semaine qui vient de se terminer hier restait
          // affichée "à venir" faute d'être strictement avant aujourd'hui).
          const isPast    = currentIdx >= 0 && i < currentIdx;
          const rawTheme  = w.context?.cycleTheme || '';
          const theme     = rawTheme ? (THEME_LABELS[rawTheme] || rawTheme.replace(/-/g, ' ')) : '';
          return `
            <button class="week-tab${i === campusState.selectedWeekIdx ? ' week-tab--active' : ''}${isCurrent ? ' week-tab--current' : ''}${isPast && i !== campusState.selectedWeekIdx ? ' week-tab--past' : ''}"
              onclick="selectWeek(${i})" id="week-tab-${i}">
              <span class="week-tab-num">${isPast ? '\u2713 ' : ''}S${i+1}</span>
              ${theme ? `<span class="week-tab-theme">${theme}</span>` : ''}
            </button>`;
        }).join('')}
      </div>
    </div>`;

  // "?"? Liste des séances "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
  const sessionList = `<div id="training-session-list"></div>`;

  // "?"? Boutons import/export "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
  const planActions = `
    <div class="plan-actions-bar">
      <button class="btn-plan-action btn-plan-export" onclick="exportPlan()" title="Telecharger le plan complet">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        Exporter le plan
      </button>
      <label class="btn-plan-action btn-plan-import" title="Importer un plan .aplus" style="cursor:pointer;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 7 12 3 8 7"/><line x1="12" y1="21" x2="12" y2="3"/></svg>
        Importer un plan
        <input type="file" accept=".aplus,.json" style="display:none" onchange="importPlan(event)">
      </label>
      ${campusState.campusConnected && campusState.usingImportedPlan && campusState.campusHasPlan ? `
      <button class="btn-plan-action" id="btn-back-to-campus" onclick="switchToCampusPlan()" title="Revenir au plan Campus Coach" style="opacity:.75;">
        ↩ Plan Campus
      </button>` : ''}
      ${campusState.campusConnected ? `
      <button class="btn-plan-action btn-campus-disconnect" onclick="disconnectCampus()" title="Tester en mode plan partage (deconnecte Campus)">
        Déconnecter Campus
      </button>` : ''}
      <button class="btn-plan-action btn-cancel-plan" onclick="cancelPlan()" title="Supprimer le plan en cours et revenir à l'écran de connexion" style="margin-left:auto;opacity:.85;background:rgba(229,57,53,.15);color:#e53935;border:1px solid rgba(229,57,53,.3);">
        ✕ Annuler le plan
      </button>
    </div>`;

  el('campus-plan-wrap').innerHTML = planHeader + weekTabs + planActions + sessionList;
  el('campus-loading').style.display = 'none';
  el('campus-plan-wrap').style.display = '';
  el('campus-plan-subtitle').textContent = `Plan ${typeLabel} — ${totalWeeks} semaines`;

  // Afficher les séances de la semaine sélectionnée
  renderSessionList(campusState.selectedWeekIdx);

  // Mettre à jour la page Objectifs
  updateGoalsPage(goal, weeks);
}

// "?"? Sélection d'une semaine "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function selectWeek(idx) {
  campusState.selectedWeekIdx = idx;
  campusState.openSessionIdx  = -1;

  // Mettre à jour les tabs
  document.querySelectorAll('.week-tab').forEach((t, i) => {
    t.classList.toggle('week-tab--active', i === idx);
  });

  // Scroller jusqu'au tab actif
  const activeTab = document.getElementById(`week-tab-${idx}`);
  if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  renderSessionList(idx);
}

// "?"? Rendu de la liste de séances "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function renderSessionList(weekIdx) {
  const container = document.getElementById('training-session-list');
  if (!container) return;

  const week = campusState.weeks[weekIdx];
  if (!week) {
    container.innerHTML = '<div class="training-empty">Aucune semaine sélectionnée.</div>';
    return;
  }

  const sessions = week.sessions || [];
  const ctx = week.context || {};
  const rawTheme = ctx.cycleTheme || '';
  const theme = rawTheme ? (THEME_LABELS[rawTheme] || rawTheme.replace(/-/g, ' ')) : '';
  const now = Date.now();
  const isCurrent = isNowInWeek(now, week.weekDate);

  const weekHeader = `
    <div class="session-week-header">
      <div class="session-week-info">
        <span class="session-week-title">Semaine ${weekIdx + 1}${isCurrent ? ' <span class="session-week-current-badge">En cours</span>' : ''}</span>
        ${theme ? `<span class="session-week-theme-label">${theme}</span>` : ''}
      </div>
      <div class="session-week-range">${fmtWeekRange(week.weekDate)}</div>
      ${ctx.cycleDescription ? `<div class="session-week-desc">${ctx.cycleDescription}</div>` : ''}
    </div>`;

  if (sessions.length === 0) {
    container.innerHTML = weekHeader + '<div class="training-empty">Pas de séances pour cette semaine.</div>';
    return;
  }

  const cards = sessions.map((s, i) => renderSessionCard(s, i, weekIdx, week._id, isCurrent)).join('');
  container.innerHTML = weekHeader + `<div class="session-cards-list">${cards}</div>`;
}

// "?"? Rendu d'une carte de séance "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function renderSessionCard(session, idx, weekIdx, weekId, isCurrentWeek) {
  const style    = getCategoryStyle(session.trainingCategory);
  const isKey    = session.importance === true;
  const duration = session.stats?.expectedDuration;
  const diff     = session.difficulty || 0;
  // Pour les plans importes, verifier aussi le statut local (marque manuellement)
  let status = session.status || 'todo';
  if (campusState.usingImportedPlan && weekId) {
    const localStatus = getLocalSessionStatus(weekId, session.trainingIndex);
    if (localStatus) status = localStatus;
  }
  const sport    = session.sport === 'ppg' ? 'PPG' : session.sport === 'trailV2' ? 'Trail' : '';

  const statusMap = {
    'done': { label: '\u2713 Fait',    cls: 'status--done'   },
    'skip': { label: '\u2715 Pass\u00e9e',  cls: 'status--skip'   },
    'todo': { label: '\u25cb \u00c0 faire', cls: 'status--todo'   },
  };
  const statusInfo = statusMap[status] || statusMap['todo'];

  const diffDots = Array.from({ length: 5 }, (_, i) =>
    `<span class="session-difficulty-dot${i < diff ? ' session-difficulty-dot--filled' : ''}"></span>`
  ).join('');

  const isOpen = idx === campusState.openSessionIdx && weekIdx === campusState.selectedWeekIdx;

  // Estimation "Fin de plan" : meme methode que le bloc Estimations de
  // performance (Objectifs) - distance/D+ valides par l'utilisateur et VMA
  // projetee en fin de plan, PAS la duree brute de Campus (goal.specificData
  // est souvent vide sur un plan trail-v2, ce qui faisait retomber sur
  // l'estimation generique de Campus au lieu du calcul calibre Allure+).
  const isComp = (session.trainingCategory || '').includes('competition');
  let displayDuration = duration;
  let isTrailEstimate = false;
  if (isComp) {
    const compGoal  = campusState.goal;
    const compWeeks = campusState.weeks;
    const planId    = compGoal?._id || 'plan';
    const savedDist  = parseFloat(localStorage.getItem('suivi_objectif_dist_'  + planId)) || 0;
    const savedDplus = parseInt(localStorage.getItem('suivi_objectif_dplus_' + planId)) || 0;
    const isTrailGoal = (compGoal?.goalType || '').toLowerCase().includes('trail');
    const vma = getVmaFromState();
    if (savedDist > 0 && vma && compWeeks) {
      const weeksTotal = compGoal?.durationInWeeks || compWeeks.length;
      const vmaEnd = vma * (1 + getRemainingVmaGainPct(weeksTotal, compWeeks));
      displayDuration = estimateRaceTime(vmaEnd, savedDist, savedDplus, isTrailGoal);
      isTrailEstimate = isTrailGoal;
    }
  }
  const durationHtml = displayDuration
    ? `<span class="session-meta-item" title="${isTrailEstimate ? 'Estimation trail (dénivelé inclus · formule ITRA)' : 'Durée prévue'}">&#9203; ${fmtDuration(displayDuration)}${isTrailEstimate ? ' *' : ''}</span>`
    : '';

  // D+ trail : afficher si disponible (Sortie Longue, sessions trail avec dénivelé)
  const elevMin = session.stats && session.stats.expectedElevationGain;
  const elevMax = session.stats && session.stats.maxExpectedElevationGain;
  const elevHtml = (elevMin || elevMax)
    ? `<span class="session-meta-item session-elev" title="Dénivelé positif attendu">&#9650; ${
        elevMin && elevMax && elevMin !== elevMax ? elevMin + '\u2013' + elevMax : (elevMin || elevMax)
      } m D+</span>`
    : '';

  return `
    <div class="session-card${isKey ? ' session-card--key' : ''}${isOpen ? ' session-card--open' : ''}"
         style="border-left-color:${style.border}"
         onclick="toggleSession(${idx}, ${weekIdx}, '${weekId || ''}')">
      <div class="session-card-header">
        <div class="session-card-left">
          <span class="session-num">${idx + 1}</span>
          <div class="session-card-info">
            <div class="session-card-name">
              ${session.displayName || session.name || 'Séance'}
              ${isKey ? '<span class="session-key-badge">\u2605 Cl\u00e9</span>' : ''}
            </div>
            <div class="session-card-meta">
              <span class="session-category-badge" style="background:${style.color};border-color:${style.border};color:${style.text}">
                ${style.label}
              </span>
              ${sport ? `<span class="session-sport-tag">${sport}</span>` : ''}
              ${durationHtml}
              ${elevHtml || ''}
            </div>
          </div>
        </div>
        <div class="session-card-right">
          <div class="session-difficulty">${diffDots}</div>
          ${(() => {
            if (!weekId || typeof _analysisIndex === 'undefined') return '';
            const rec = _analysisIndex.bySession[(weekId + '_' + (session.trainingIndex ?? 0))];
            return rec ? `<span class="session-analysis-score-badge" title="Séance analysée">📊 ${rec.score}%</span>` : '';
          })()}
          <span class="session-status-badge ${statusInfo.cls}">${statusInfo.label}</span>
          <span class="session-expand-chevron">${isOpen ? '-' : '-'}</span>
        </div>
      </div>
      ${isOpen ? renderSessionDetail(session, weekId, isCurrentWeek) : ''}
    </div>`;
}

// "?"? Couleurs des lignes de zones "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
const ZONE_ROW_COLORS = {
  Z1: '#f3f3f3', Z2: '#f1f8e9', Z3: '#fff8e1', Z4: '#fff3e0', Z5: '#fce4ec',
  RECOVER: '#f5f5f5', RECOVERY: '#f5f5f5', WARMUP: '#e8f5e9', COOLDOWN: '#e8f5e9',
  GPP: '#ede7f6', DEFAULT: '#fafafa',
};
const ZONE_ROW_COLORS_DARK = {
  Z1: 'rgba(50,55,70,0.85)',  Z2: 'rgba(15,55,25,0.85)',  Z3: 'rgba(60,52,10,0.85)',
  Z4: 'rgba(75,42,10,0.85)', Z5: 'rgba(80,18,30,0.85)',
  RECOVER: 'rgba(28,32,50,0.85)', RECOVERY: 'rgba(28,32,50,0.85)',
  WARMUP: 'rgba(12,50,22,0.85)',  COOLDOWN: 'rgba(12,50,22,0.85)',
  GPP: 'rgba(45,18,75,0.85)', DEFAULT: 'rgba(18,21,31,0.80)',
};
function getZoneColor(zKey) {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const map = isDark ? ZONE_ROW_COLORS_DARK : ZONE_ROW_COLORS;
  return map[(zKey||'').toUpperCase()] || map.DEFAULT;
}

// "?"? Catégories exportables vers Garmin "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
// Règle : toutes les séances SAUF renforcement (gpp) et EF simple (trail_basic_endurance)
const GARMIN_EXPORTABLE_CATEGORIES = [
  // Trail
  'trail_basic_endurance_with_straight_lines',
  'trail_intensity',
  'trail_threshold',
  'trail_threshold_uphill',
  'trail_vma',
  'trail_vma_uphill',
  'trail_long_run',
  'trail_race_simulation',
  'trail_special',
  'trail_competition',
  'trail_strength',
  'trail_strides',
  'trail_hill_repeats',
  // Route
  'road_intensity',
  'road_threshold',
  'road_threshold_intervals',
  'road_vma',
  'road_vma_intervals',
  'road_long_run',
  'road_race_simulation',
  'road_race_pace',
  'road_strides',
  'road_hill_repeats',
  'road_basic_endurance_with_straight_lines',
  // Communs
  'competition',
  'trail_race',
  'road_race',
];


// "?"? Sanitisation des textes coach "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function sanitizeCoachText(text) {
  if (!text) return text;
  return text
    .replace(/\bCampus Coach\b/gi, 'Allure+')
    .replace(/\bCampus\b/gi, 'Allure+')
    .replace(/l'application Allure\+/gi, 'Allure+')
    .replace(/l'app Allure\+/gi, 'Allure+')
    .replace(/sur Allure\+/gi, "sur l'application")
    .trim();
}

const PPG_DIFFICULTY_FR = {
  easy: 'Facile', moderate: 'Modéré', hard: 'Difficile',
  very_hard: 'Très difficile', recovery: 'Récupération',
};

const PPG_TIME_UNIT_FR = { seconds: 'sec', minutes: 'min' };

// Duree/repetitions d'un exercice PPG, tel qu'affiche par Campus Coach
// (ex: "30 sec" ou "15 répétitions") - source : exercice.durations[] ou
// exercice.repeat selon que Campus modelise l'exercice en temps ou en reps.
function formatPPGExerciseMeta(ex) {
  if (Array.isArray(ex.durations) && ex.durations.length > 0) {
    const d = ex.durations[0];
    const unit = PPG_TIME_UNIT_FR[d.timeUnit] || d.timeUnit;
    return `${d.value} ${unit}`;
  }
  if (ex.repeat) return `${ex.repeat} répétitions`;
  return '';
}

// Reconstruit les blocs d'une seance de renforcement (PPG) tels que Campus
// Coach les affiche : series repetees (block.repeat), chaque exercice avec
// sa duree/reps + niveau d'effort, et la recuperation entre series a la fin
// du bloc (exercice special exerciseType==='recuperation').
function formatPPGBlocksHtml(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  const blocksHtml = blocks.map(block => {
    const all = block.exercises || block || [];
    const recovery = all.find(e => e.exerciseType === 'recuperation');
    const exercises = all.filter(e => e.exerciseType !== 'recuperation' && e.name);
    if (exercises.length === 0) return '';
    const rows = exercises.map(ex => {
      const meta = formatPPGExerciseMeta(ex);
      const effort = ex.difficulty && ex.difficulty !== 'recovery' ? (PPG_DIFFICULTY_FR[ex.difficulty] || ex.difficulty) : '';
      const metaText = [meta, effort ? `effort ${effort.toLowerCase()}` : ''].filter(Boolean).join(' · ');
      return `<li><span class="ppg-ex-name">${ex.name}</span>${metaText ? `<span class="ppg-ex-meta">${metaText}</span>` : ''}</li>`;
    }).join('');
    const repeatBadge = block.repeat > 1 ? `<span class="ppg-block-repeat">× ${block.repeat}</span>` : '';
    const recoveryHtml = recovery ? `<div class="ppg-block-recovery">Récupération : ${formatPPGExerciseMeta(recovery)}</div>` : '';
    return `
      <div class="ppg-block">
        ${repeatBadge}
        <ul>${rows}</ul>
        ${recoveryHtml}
      </div>`;
  }).join('');
  return `
    <div class="session-exercises-list">
      <div class="session-detail-section-title">Exercices</div>
      ${blocksHtml}
    </div>`;
}

// "?"? Panneau de détail d'une séance "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function renderSessionDetail(session, weekId, isCurrentWeek) {
  const isPPG = session.sport === 'ppg' || session.trainingCategory === 'gpp';

  // "?"? Affichage simplifié pour les séances PPG/Renforcement "?"?
  if (isPPG) {
    const exercisesHtml = formatPPGBlocksHtml(session.exercisesBlocks || []);
    return `
      <div class="session-detail-panel" onclick="event.stopPropagation()">
        ${session.description ? `
          <div class="session-detail-section">
            <div class="session-detail-section-title">Description</div>
            <div class="session-detail-desc">${mdBold(sanitizeCoachText(session.description))}</div>
          </div>` : ''}
        ${session.coachAdvice ? `
          <div class="session-coach-advice">
            <div class="session-coach-advice-label">&#x1F4A1; Conseil du coach</div>
            <div class="session-coach-advice-text">${mdBold(sanitizeCoachText(session.coachAdvice))}</div>
          </div>` : ''}
        ${exercisesHtml}
        <div class="session-detail-actions">
          ${(() => {
            if (!campusState.usingImportedPlan || !weekId) return '';
            const ti = session.trainingIndex ?? 0;
            const ls = getLocalSessionStatus(weekId, ti);
            if (ls === 'done') return '<button class="btn-mark-done btn-mark-done--active" onclick="event.stopPropagation();clearSessionStatus(\'' + weekId + '\''  + ',' + ti + ')">\u21a9 Annuler (fait)</button>';
            if (ls === 'skip') return '<button class="btn-mark-skip btn-mark-skip--active" onclick="event.stopPropagation();clearSessionStatus(\'' + weekId + '\'' + ',' + ti + ')">\u21a9 Annuler (pass\u00e9e)</button>';
            return '<button class="btn-mark-done" onclick="event.stopPropagation();markSessionDone(\'' + weekId + '\'' + ',' + ti + ')">\u2713 Marquer comme fait</button>'
                 + '<button class="btn-mark-skip" onclick="event.stopPropagation();markSessionSkip(\'' + weekId + '\'' + ',' + ti + ')">\u2715 Passer</button>';
          })()}
          <button class="btn-close-session" onclick="event.stopPropagation(); closeSession()">Fermer</button>
        </div>
      </div>`;
  }

  // -- Affichage normal (seances de course) --
  const paceZones  = session.paceZones || [];
  // VMA locale avec correction sexe = source de vérité Allure+
  // campusState.fitness?.vma est la VMA Campus (pas de correction femme → incohérence)
  const _vo2loc  = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
  const _profLoc = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
  const _sexLoc  = _profLoc.sex || 'M';
  const _factLoc = _sexLoc === 'F' ? 0.315 : 0.313;
  const vma      = (_vo2loc && _vo2loc > 3.5)
    ? Math.round((_vo2loc - 3.5) * _factLoc * 10) / 10
    : (campusState.fitness?.vma || null); // fallback Campus si pas de VO2max Garmin
  const isCompSess = (session.trainingCategory || '').includes('competition');
  let zonesHTML    = '';

  if (isCompSess) {
    const goalData     = campusState.goal?.specificData || {};
    const distKm       = goalData.distance     || 0;
    const elevGain     = goalData.elevationGain || 0;
    const vo2local     = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
    const profLocal    = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
    const sexLocal     = profLocal.sex || 'M';
    const factorL      = sexLocal === 'F' ? 0.315 : 0.313;
    const vmaLocal     = vo2local ? Math.round((vo2local - 3.5) * factorL * 10) / 10 : null;
    let raceInfoRows   = '<div style="font-size:12px;color:#888">Compl&eacute;tez votre profil pour voir l&rsquo;estimation</div>';
    if (distKm > 0 && vmaLocal) {
      const flatTimeH   = distKm / (vmaLocal * 0.70);        // plat + descente
      const climbTimeH  = (elevGain || 0) / 700;               // montée à 700 m D+/h
      const trailTimeSec = Math.round((flatTimeH + climbTimeH) * 3600);
      const paceSlowSec  = Math.round(3600 / (vmaLocal * 0.65));
      const paceFastSec  = Math.round(3600 / (vmaLocal * 0.70));
      raceInfoRows = [
        '<div class="pace-zone-row" style="background:' + getZoneColor('Z2') + ';border-radius:4px;margin-bottom:4px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">',
        '<span style="font-weight:600;font-size:12px;">&#127956; Epreuve trail</span>',
        '<span style="font-size:12px;color:#555;">' + distKm + ' km' + (elevGain ? ' &middot; ' + elevGain + ' m D+' : '') + '</span></div>',
        '<div class="pace-zone-row" style="background:' + getZoneColor('WARMUP') + ';border-radius:4px;margin-bottom:4px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">',
        '<span style="font-size:12px;">&#9201; Temps estim&eacute; (Naismith trail)</span>',
        '<span style="font-size:12px;font-weight:600;color:var(--accent);">' + fmtDuration(trailTimeSec) + '</span></div>',
        '<div class="pace-zone-row" style="background:' + getZoneColor('Z3') + ';border-radius:4px;margin-bottom:4px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">',
        '<span style="font-size:12px;">&#127919; Allure cible plat (70% VMA)</span>',
        '<span class="pace-zone-pace personal-pace">' + fmtPace(paceFastSec) + ' - ' + fmtPace(paceSlowSec) + '/km</span></div>',
        '<div class="pace-zone-row" style="background:#f5f5f5;border-radius:4px;padding:6px 10px;font-size:11px;color:#777;">',
        'Plat+descente&nbsp;: ' + Math.round(flatTimeH*60) + 'min &middot; Mont&eacute;e&nbsp;: ' + Math.round(climbTimeH*60) + 'min (700m D+/h) &middot; VMA&nbsp;: ' + vmaLocal + ' km/h</div>',
      ].join('');
    }
    zonesHTML = '<div class="session-detail-section"><div class="session-detail-section-title">Informations course'
      + (vmaLocal ? '<span class="zones-source-note">calcul&eacute;es &middot; VMA ' + vmaLocal + ' km/h</span>' : '')
      + '</div><div class="pace-zones-list">' + raceInfoRows + '</div></div>';

  } else if (paceZones.length > 0) {
    // Zone résolue depuis pace.slug (fiable) → VMA utilisateur → allure Route ou Trail
    const isSessTrail   = isTrailSession(session);
    const goalTypeLocal = campusState.goal?.goalType || '';
    const zonesResolved = annotatePaceZones(session, goalTypeLocal);
    const modeBadge    = isSessTrail
      ? '<span class="session-mode-badge session-mode-badge--trail">&#127956;&nbsp;Côte / Trail</span>'
      : '<span class="session-mode-badge session-mode-badge--route">&#127939;&nbsp;Route</span>';
    // Détecter si la séance est 100% endurance (EF/RECOVER uniquement)
    const hasIntervals = zonesResolved.some(z => {
      const az = z.resolvedZone;
      return az && az !== 'EF' && az !== 'RECOVER' && az !== 'WARMUP' && az !== 'COOLDOWN';
    });
    const zoneRows = zonesResolved.map((z, idx) => {
      const zKey    = (z.kind || '').toUpperCase();
      const apZone  = z.resolvedZone;
      const zoneDef = apZone ? ALLURE_PLUS_ZONES[apZone] : null;
      const rowBg   = getZoneColor(zKey);
      // Le tout premier segment, s'il resout en RECOVER, est la mise en
      // route de la seance (pas une "recuperation" - rien avant lui) : on
      // l'affiche "Échauffement", meme cohérence que l'export xlsx.
      const zoneLbl = (apZone === 'RECOVER' && idx === 0)
        ? 'Échauffement'
        : (zoneDef ? zoneDef.label : fmtZoneKind(z.kind, session.displayName || session.name || ''));
      // RECOVER → allure libre, pas de valeur cible
      if (zoneDef?.noTarget) {
        return '<div class="pace-zone-row" data-zone="' + zKey + '" style="background:' + rowBg + ';border-radius:4px;margin-bottom:2px;padding:4px 8px;">'
          + '<span class="pace-zone-kind">' + zoneLbl + '</span>'
          + '<span class="pace-zone-duration">' + fmtDuration(z.duration) + '</span>'
          + '<span class="pace-zone-pace" style="color:#94a3b8;font-style:italic;font-size:12px">Allure libre</span>'
          + '</div>';
      }
      // EF en warmup (session avec intervalles) → Route ; EF sortie longue → Trail
      const isEfWarmup = hasIntervals && (apZone === 'EF' || apZone === 'WARMUP' || apZone === 'COOLDOWN');
      const useTrail   = isSessTrail && !isEfWarmup;
      // Calcul allures depuis VMA utilisateur (correctement calibré + correction trail +7/+8/+10%)
      // Les pace.value du fichier .aplus sont des valeurs template non calibrées à l'utilisateur
      const apRef = apZone && vma
        ? (useTrail ? calcAllureRefTrail(apZone, vma) : calcAllureRef(apZone, vma))
        : null;
      const paceColor = apRef?.isTrail ? 'var(--text-trail, #6b7a8f)' : 'var(--text-pace, var(--text-primary))';
      const paceCell = apRef
        ? '<span class="pace-zone-pace personal-pace" style="color:' + paceColor + '">'
          + fmtPace(apRef.paceMin) + ' – ' + fmtPace(apRef.paceMax) + '/km'
          + (apRef.isTrail ? ' <small class="trail-corr-note">+' + Math.round(apRef.trailCorr * 100) + '%</small>' : '')
          + '</span>'
        : '';
      return '<div class="pace-zone-row" data-zone="' + zKey + '" style="background:' + rowBg + ';border-radius:4px;margin-bottom:2px;padding:4px 8px;">'
        + '<span class="pace-zone-kind">' + zoneLbl + '</span>'
        + '<span class="pace-zone-duration">' + fmtDuration(z.duration) + '</span>'
        + paceCell + '</div>';
    }).join('');
    const trailNote = isSessTrail ? ' &nbsp;<span style="font-size:11px;color:#888">allures trail ajustées</span>' : '';
    zonesHTML = '<div class="session-detail-section"><div class="session-detail-section-title">'
      + modeBadge + "&nbsp;Zones d'allure" + trailNote
      + (vma ? '<span class="zones-source-note">CALCULÉES · VMA ' + vma + ' km/h</span>' : '')
      + '</div><div class="pace-zones-list">' + zoneRows + '</div></div>';
  }
  // Bouton export Garmin selon la catégorie (sans restriction de semaine)
  const cat = session.trainingCategory || '';
  let exportBtn = '';
  if (weekId && GARMIN_EXPORTABLE_CATEGORIES.includes(cat)) {
    exportBtn = `
      <button class="btn-export-garmin btn-export-garmin--detail"
        onclick="event.stopPropagation(); exportWeekToGarmin('${weekId}', ${session.trainingIndex ?? 0})">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        Envoyer vers Garmin
      </button>`;
  }

  return `
    <div class="session-detail-panel" onclick="event.stopPropagation()">
      ${session.description ? `
        <div class="session-detail-section">
          <div class="session-detail-section-title">Description</div>
          <div class="session-detail-desc">${mdBold(sanitizeCoachText(session.description))}</div>
        </div>` : ''}
      ${session.coachAdvice ? `
        <div class="session-coach-advice">
          <div class="session-coach-advice-label">&#x1F4A1; Conseil du coach</div>
          <div class="session-coach-advice-text">${mdBold(sanitizeCoachText(session.coachAdvice))}</div>
        </div>` : ''}
      ${zonesHTML}
      <div class="session-detail-actions">
        ${exportBtn}
        ${typeof renderSessionAnalysisButton === 'function' ? renderSessionAnalysisButton(session, weekId) : ''}
        ${(() => {
          if (!campusState.usingImportedPlan || !weekId) return '';
          const ti = session.trainingIndex ?? 0;
          const ls = getLocalSessionStatus(weekId, ti);
          const isDone = ls === 'done';
          const isSkip = ls === 'skip';
          let html = '';
          if (isDone) {
            html = '<button class="btn-mark-done btn-mark-done--active" onclick="event.stopPropagation();clearSessionStatus(\'' + weekId + '\',' + ti + ')">\u21a9 Annuler (fait)</button>';
          } else if (isSkip) {
            html = '<button class="btn-mark-skip btn-mark-skip--active" onclick="event.stopPropagation();clearSessionStatus(\'' + weekId + '\',' + ti + ')">\u21a9 Annuler (pass\u00e9e)</button>';
          } else {
            html = '<button class="btn-mark-done" onclick="event.stopPropagation();markSessionDone(\'' + weekId + '\',' + ti + ')">\u2713 Marquer comme fait</button>'
                 + '<button class="btn-mark-skip" onclick="event.stopPropagation();markSessionSkip(\'' + weekId + '\',' + ti + ')">\u2715 Passer</button>';
          }
          return html;
        })()}
        <button class="btn-close-session" onclick="event.stopPropagation(); closeSession()">Fermer</button>
      </div>
    </div>`;
}




// "?"? Export du plan "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?

// Toggle d'une séance
function toggleSession(idx, weekIdx, weekId) {
  if (campusState.openSessionIdx === idx && campusState.selectedWeekIdx === weekIdx) {
    campusState.openSessionIdx = -1;
  } else {
    campusState.openSessionIdx = idx;
  }
  renderSessionList(weekIdx);
}

function closeSession() {
  campusState.openSessionIdx = -1;
  renderSessionList(campusState.selectedWeekIdx);
}

// Export vers Garmin — TOUJOURS via Allure+ (VMA sex-corrected + correction trail)
// Que Campus soit connecté ou non, on utilise nos propres paces calculées.
async function exportWeekToGarmin(weekId, sessionNum) {
  try {
    const weekIdx = campusState.weeks?.findIndex(w => w._id === weekId);
    const weekNum = weekIdx >= 0 ? weekIdx + 1 : 1;
    const week    = weekIdx >= 0 ? campusState.weeks[weekIdx] : null;
    const session = week?.sessions?.find(s => s.trainingIndex === sessionNum);
    if (!session) throw new Error('Séance introuvable dans le plan');

    const sessionDisplay = sessionNum + 1;

    // ── VMA Allure+ : sex-corrected, identique à ce qui est affiché ──────────
    const _vo2  = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
    const _prof = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
    const _sex  = _prof.sex || 'M';
    const _fact = _sex === 'F' ? 0.315 : 0.313;
    const vmaExport = (_vo2 && _vo2 > 3.5)
      ? Math.round((_vo2 - 3.5) * _fact * 10) / 10
      : null;

    // ── Détection trail / côte ────────────────────────────────────────────────
    const isTrailExport = isTrailSession(session);

    // ── La séance a-t-elle des intervalles ? (EF warmup vs sortie longue) ────
    const hasIntervalsExport = (session.paceZones || []).some(z => {
      const kind = (z.kind || '').toUpperCase();
      return !['EF','WARMUP','COOLDOWN','RECOVER','RECOVERY','Z1','Z2'].includes(kind);
    });

    // ── Corrections trail par zone (identiques à ALLURE_PLUS_ZONES) ──────────
    const trailCorrs = { EF:0.07, TEMPO:0.07, AS42:0.07, SWEET_SPOT:0.07, AS21:0.07, S60:0.07, S30:0.07, AS10:0.08, VMA:0.10 };

    // ── Envoi UNIQUE : /api/garmin/workout-from-session ───────────────────────
    // Allure+ construit le workout de A à Z avec nos paces.
    // Campus n'est plus un intermédiaire pour les allures Garmin.
    const res = await fetchJSON('/api/garmin/workout-from-session', {
      method: 'POST',
      body: JSON.stringify({
        session,
        weekNum,
        sessionDisplay,
        allureplusVma:  vmaExport,
        isTrail:        isTrailExport,
        trailCorrs,
        hasIntervals:   hasIntervalsExport,
        goalType:       campusState.goal?.goalType || '',
      }),
    });

    if (res.success) {
      const name = res.workout?.workoutName || session.displayName || '';
      showToast('✓ « ' + name + ' » envoyée vers Garmin !', 'success');
    }
  } catch(err) {
    showToast('Erreur export Garmin : ' + err.message, 'error');
  }
}



async function exportPlan() {
  try {
    showToast('Preparation de l\'export...', 'info');
    const res = await fetch('/api/campus/export-plan');
    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error || 'Export echoue');
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'plan.aplus';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Plan exporte !', 'success');
  } catch(err) {
    showToast('Erreur export : ' + err.message, 'error');
  }
}

// "?"? Deconnexion Campus (pour tester l'import) "?"?"?"?"?"?"?"?"?
function switchToCampusPlan() {
  localStorage.removeItem('prefer_imported_plan');
  campusState.usingImportedPlan = false;
  showTrainingLoading();
  loadTrainingPlan();
}

// ✕ Annuler le plan en cours (importé ou Campus)
async function cancelPlan() {
  const ok = await new Promise(resolve => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--card-bg,#fff);border:1px solid var(--border,#e0e0e0);border-radius:14px;padding:28px 28px 22px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.25);">
        <div style="font-size:17px;font-weight:700;color:var(--text-primary,#111);margin-bottom:10px;">Annuler le plan en cours&nbsp;?</div>
        <div style="font-size:14px;color:var(--text-secondary,#666);margin-bottom:22px;line-height:1.5;">Le plan sera retiré de cet appareil.<br>Vous pourrez en recharger un depuis <strong>Plans Disponibles</strong> ou importer un fichier <code>.aplus</code>.</div>
        <div style="display:flex;gap:10px;">
          <button id="cp-keep"    style="flex:1;padding:11px;border:1.5px solid var(--border,#ddd);border-radius:9px;background:transparent;color:var(--text-primary,#111);font-size:14px;cursor:pointer;">Garder le plan</button>
          <button id="cp-confirm" style="flex:2;padding:11px;border:none;border-radius:9px;background:#e53935;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">✕ Annuler le plan</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#cp-confirm').onclick = () => { modal.remove(); resolve(true); };
    modal.querySelector('#cp-keep').onclick    = () => { modal.remove(); resolve(false); };
    attachBackdropClose(modal, () => { modal.remove(); resolve(false); });
  });
  if (!ok) return;

  // Nettoyer localStorage
  localStorage.removeItem('suivi_imported_plan');
  localStorage.removeItem('prefer_imported_plan');
  localStorage.removeItem('campus_was_connected');

  // Nettoyer état local
  campusState.goal              = null;
  campusState.weeks             = [];
  campusState.usingImportedPlan = false;
  campusState.campusConnected   = false;

  // Nettoyer côté serveur silencieusement
  fetch('/api/campus/import-plan', { method: 'DELETE' }).catch(() => {});

  // Afficher l'écran vide
  showTrainingEmpty();
  showToast('Plan retiré.', 'info');
}

async function disconnectCampus() {
  localStorage.removeItem('campus_was_connected');
  const confirmed = await showConfirmModal({ title: 'D\u00e9connecter Campus Coach ?', message: 'Vous pourrez importer un plan partag\u00e9 ou vous reconnecter \u00e0 tout moment.', confirmLabel: 'D\u00e9connecter', cancelLabel: 'Annuler', danger: true });
  if (!confirmed) return;
  try {
    await fetch('/api/campus/logout', { method: 'POST' });
    localStorage.removeItem('suivi_imported_plan');
    showToast('D\u00e9connect\u00e9 de Campus. Rechargement...', 'info');
    setTimeout(() => { showTrainingLoading(); loadTrainingPlan(); }, 800);
  } catch(e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}
// "?"? Import d'un plan "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
async function importPlan(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (event.target) event.target.value = '';
  try {
    showToast('Lecture du plan...', 'info');
    const text = await file.text();

    if (text.trimStart().startsWith('<')) {
      showToast('Fichier invalide - re-exportez depuis un compte Campus connecte.', 'error');
      return;
    }

    let data;
    try { data = JSON.parse(text); }
    catch(e) { showToast('JSON invalide : ' + e.message, 'error'); return; }

    if (!data.goal || !Array.isArray(data.weeks)) {
      showToast('Structure invalide (goal ou weeks manquants).', 'error');
      return;
    }

    // Modal : demander le nom de la course et la date
    const prefillName = data.goal.name || data.goal.goalTitle || '';
    // competitionDate peut être : string ISO "2026-10-17", timestamp ms, ou null
    const rawDate = data.goal.competitionDate;
    let prefillDate = '';
    if (rawDate) {
      const d = new Date(rawDate);  // fonctionne avec string ET timestamp numérique
      if (!isNaN(d)) prefillDate = d.toISOString().slice(0, 10);  // → YYYY-MM-DD
    }

    const nbWeeks = data.weeks.length;

    // Trouver quelle semaine contient la date de competition (pour les semaines post-course)
    const W7 = 7 * 24 * 3600 * 1000;
    const sortedForRace = [...data.weeks].sort((a, b) => (a.weekDate||0) - (b.weekDate||0));
    const origRaceTs = rawDate ? new Date(rawDate).getTime() : null;
    let raceWeekIdx = nbWeeks - 1; // fallback : derniere semaine
    if (origRaceTs) {
      const found = sortedForRace.findIndex(w => origRaceTs >= (w.weekDate||0) && origRaceTs < ((w.weekDate||0) + W7));
      if (found >= 0) raceWeekIdx = found;
    }
    const postCompWeeks = nbWeeks - 1 - raceWeekIdx;

    const result = await showRaceModal({ prefillName, prefillDate, nbWeeks, raceWeekIdx, postCompWeeks });
    if (!result) return;  // Annule

    // ── Appliquer les valeurs saisies par l'utilisateur ───────────────────────
    data.goal.name            = result.name || data.goal.name || 'Ma course';
    data.goal.goalTitle       = data.goal.name;
    data.goal.competitionDate = result.date;

    // ── Recalculer TOUTES les dates du plan depuis la nouvelle date de course ──
    // Le plan original a des weekDate hardcodés par Campus (timestamps ms).
    // On les recalcule intégralement pour que les séances correspondent
    // à la date saisie par l'utilisateur.
    // Aligner la semaine de course (raceWeekIdx) sur la date saisie par l'utilisateur
    // Les semaines post-competition restent apres la date de course
    const raceMs = new Date(result.date + 'T12:00:00').getTime();
    const rawPlanStartMs = raceMs - raceWeekIdx * W7;
    // Caler le debut du plan sur le lundi de la semaine (lundi=1, dimanche=0)
    const snapToMonday = (ms) => {
      const dow = new Date(ms).getDay(); // 0=dim, 1=lun, ..., 6=sam
      const delta = dow === 0 ? -6 : 1 - dow; // nombre de jours pour revenir au lundi
      return ms + delta * 24 * 3600 * 1000;
    };
    const newPlanStartMs = snapToMonday(rawPlanStartMs);

    // Trier les semaines par weekDate ou weekNumber d'origine pour garantir l'ordre
    data.weeks = [...data.weeks]
      .sort((a, b) => (a.weekDate || a.weekNumber || 0) - (b.weekDate || b.weekNumber || 0))
      .map((week, idx) => ({
        ...week,
        weekDate: newPlanStartMs + idx * W7,
      }));

    data.goal.startDate     = new Date(newPlanStartMs).toISOString().slice(0, 10);
    data.goal.raceWeekIndex = raceWeekIdx;   // pour reference future
    data.goal.postCompWeeks = postCompWeeks; // semaines post-competition

    // ── Mémoriser le choix "plan importé" même quand Campus est connecté ───────
    localStorage.setItem('prefer_imported_plan', 'true');
    localStorage.setItem('suivi_imported_plan', JSON.stringify(data));

    // ── Nettoyage TOTAL des données de l'ancien plan ───────────────────────
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('suivi_objectif_')) localStorage.removeItem(k);
    });
    const _pg = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
    delete _pg.targetTime;
    delete _pg.raceName;
    localStorage.setItem('suivi_personal_goals', JSON.stringify(_pg));
    // ────────────────────────────────────────────────────────

    fetch('/api/campus/import-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }).catch(() => {});

    showToast('Plan importé (' + nbWeeks + ' semaines) - chargement...', 'success');
    setTimeout(() => {
      campusState.usingImportedPlan = true;
      // Ne pas forcer campusConnected=false
      showTrainingLoading();
      loadTrainingPlan();
    }, 800);

  } catch(err) {
    showToast('Erreur import : ' + err.message, 'error');
  }
}

// Date de course la plus proche pour laquelle le plan peut demarrer sur le
// lundi de la semaine en cours, sans sauter de semaine complete. En dessous
// de cette date, la course est trop proche pour suivre le plan en entier.
function calcMinSafeRaceDate(weeksBeforeRace) {
  const now = new Date();
  const dow = now.getDay(); // 0=dim, 1=lun, ..., 6=sam
  const delta = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta, 12, 0, 0);
  return new Date(thisMonday.getTime() + (weeksBeforeRace || 0) * 7 * 24 * 3600 * 1000);
}

// Modal de saisie du nom et de la date de course a l'import
function showRaceModal({ prefillName, prefillDate, nbWeeks, raceWeekIdx = null, postCompWeeks = 0 }) {
  return new Promise(resolve => {
    const existing = document.getElementById('import-race-modal');
    if (existing) existing.remove();

    const weeksBeforeRace = raceWeekIdx !== null ? raceWeekIdx : nbWeeks - 1;

    function calcStart(dateObj) {
      if (!dateObj || isNaN(dateObj)) return '';
      const rawMs = dateObj.getTime() - weeksBeforeRace * 7 * 24 * 3600 * 1000;
      const dow = new Date(rawMs).getDay();
      const delta = dow === 0 ? -6 : 1 - dow;
      const startD = new Date(rawMs + delta * 24 * 3600 * 1000);
      return startD.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // Date la plus proche pour laquelle aucune semaine complete n'est sautee
    const minSafeDate = calcMinSafeRaceDate(weeksBeforeRace);
    const minSafeMidnight = new Date(minSafeDate); minSafeMidnight.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Date initiale : celle deja fournie (import .aplus) sinon la date minimale conseillee
    let selected = prefillDate ? new Date(prefillDate + 'T12:00:00') : new Date(minSafeDate);
    if (isNaN(selected)) selected = new Date(minSafeDate);
    let viewYear  = selected.getFullYear();
    let viewMonth = selected.getMonth();

    const MONTH_NAMES = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

    function fmtISO(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

    function buildCalendarHTML() {
      const first = new Date(viewYear, viewMonth, 1);
      const leading = (first.getDay() + 6) % 7; // semaine commence lundi
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      let cells = '';
      for (let i = 0; i < leading; i++) cells += '<div class="mcal-cell mcal-empty"></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(viewYear, viewMonth, day);
        const isPast = d < today;
        const isWarn = !isPast && d < minSafeMidnight;
        const isSel  = sameDay(d, selected);
        const cls = ['mcal-cell'];
        if (isPast) cls.push('mcal-disabled');
        else if (isWarn) cls.push('mcal-warn');
        if (isSel) cls.push('mcal-selected');
        cells += '<button type="button" class="' + cls.join(' ') + '" data-date="' + fmtISO(d) + '"' + (isPast ? ' disabled' : '') + '>' + day + '</button>';
      }
      return cells;
    }

    function renderMonthLabel() {
      modal.querySelector('#mcal-month-label').textContent = MONTH_NAMES[viewMonth] + ' ' + viewYear;
    }

    function rerenderGrid() {
      modal.querySelector('#mcal-grid').innerHTML = buildCalendarHTML();
      renderMonthLabel();
    }

    function updateHint() {
      const hint = modal.querySelector('#modal-start-hint');
      const warnBox = modal.querySelector('#modal-warn-banner');
      const postInfo = postCompWeeks > 0 ? ' · ' + postCompWeeks + ' sem. post-course' : '';
      hint.textContent = '📅 Début du plan : ' + calcStart(selected) + postInfo;
      const selMid = new Date(selected); selMid.setHours(0, 0, 0, 0);
      if (selMid < minSafeMidnight) {
        const missingDays  = Math.round((minSafeMidnight - selMid) / (24 * 3600 * 1000));
        const missingWeeks = Math.max(1, Math.ceil(missingDays / 7));
        warnBox.style.display = '';
        warnBox.innerHTML = '⚠️ Course trop proche : environ <strong>' + missingWeeks + ' semaine' + (missingWeeks > 1 ? 's' : '') + '</strong> du plan ' + (missingWeeks > 1 ? 'seraient' : 'serait') + ' déjà passée' + (missingWeeks > 1 ? 's' : '') + '. Vous pouvez continuer, mais le plan ne pourra pas être suivi dans son intégralité.';
      } else {
        warnBox.style.display = 'none';
      }
    }

    const modal = document.createElement('div');
    modal.id = 'import-race-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';

    const safeN = (prefillName || '').replace(/"/g, '&quot;');
    modal.innerHTML = `
      <style>
        .mcal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
        .mcal-nav{background:none;border:none;font-size:16px;color:var(--text-secondary);cursor:pointer;padding:4px 10px;border-radius:6px;line-height:1;}
        .mcal-nav:hover{background:var(--bg-hover,#f0f0f0);}
        .mcal-month-label{font-size:13px;font-weight:700;color:var(--text-primary);text-transform:capitalize;}
        .mcal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);font-size:10.5px;color:var(--text-muted);text-align:center;margin-bottom:4px;font-weight:600;}
        .mcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
        .mcal-cell{aspect-ratio:1;border:none;background:var(--bg,#f7f7f7);border-radius:7px;font-size:12.5px;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s;font-family:inherit;}
        .mcal-cell:hover:not(.mcal-disabled){background:var(--accent-light,#e8efff);}
        .mcal-empty{background:none;cursor:default;}
        .mcal-disabled{color:var(--text-muted);opacity:0.35;cursor:not-allowed;}
        .mcal-warn{background:rgba(220,38,38,0.10);color:#dc2626;font-weight:600;}
        .mcal-warn:hover{background:rgba(220,38,38,0.18);}
        .mcal-selected{background:var(--accent,#4F7BE9) !important;color:#fff !important;font-weight:700;}
      </style>
      <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:32px 28px 24px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(0,0,0,.25);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
          <span style="font-size:28px;">🏁</span>
          <div>
            <div style="font-weight:700;font-size:17px;color:var(--text-primary);">Votre course</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">Plan de <strong>${nbWeeks} semaines</strong></div>
          </div>
        </div>
        <label style="display:block;margin-bottom:16px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Nom de la course</span>
          <input id="modal-race-name" type="text" placeholder="ex: Marathon de Lyon" value="${safeN}"
            style="display:block;width:100%;margin-top:6px;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text-primary);font-size:15px;outline:none;box-sizing:border-box;">
        </label>
        <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Date de la course</span>
        <div style="margin-top:6px;margin-bottom:12px;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;background:var(--bg);">
          <div class="mcal-head">
            <button type="button" class="mcal-nav" id="mcal-prev">‹</button>
            <span class="mcal-month-label" id="mcal-month-label"></span>
            <button type="button" class="mcal-nav" id="mcal-next">›</button>
          </div>
          <div class="mcal-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
          <div class="mcal-grid" id="mcal-grid"></div>
        </div>
        <div id="modal-start-hint" style="font-size:12px;color:var(--text-muted);margin-bottom:8px;min-height:18px;padding-left:2px;"></div>
        <div id="modal-warn-banner" style="display:none;font-size:11.5px;color:#92400e;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.3);border-radius:8px;padding:8px 10px;margin-bottom:16px;line-height:1.4;"></div>
        <div style="display:flex;gap:10px;">
          <button id="modal-cancel" style="flex:1;padding:11px;border:1.5px solid var(--border);border-radius:9px;background:transparent;color:var(--text-secondary);font-size:14px;font-weight:600;cursor:pointer;">Annuler</button>
          <button id="modal-confirm" style="flex:2;padding:11px;border:none;border-radius:9px;background:var(--accent,#4F7BE9);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">Charger le plan ✓</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const nameInput = modal.querySelector('#modal-race-name');

    rerenderGrid();
    updateHint();

    modal.querySelector('#mcal-prev').addEventListener('click', () => {
      viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      rerenderGrid();
    });
    modal.querySelector('#mcal-next').addEventListener('click', () => {
      viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      rerenderGrid();
    });
    modal.querySelector('#mcal-grid').addEventListener('click', e => {
      const btn = e.target.closest('.mcal-cell');
      if (!btn || btn.disabled || !btn.dataset.date) return;
      selected = new Date(btn.dataset.date + 'T12:00:00');
      rerenderGrid();
      updateHint();
    });

    setTimeout(() => nameInput.focus(), 80);

    modal.addEventListener('keydown', e => {
      if (e.key === 'Enter')  modal.querySelector('#modal-confirm').click();
      if (e.key === 'Escape') modal.querySelector('#modal-cancel').click();
    });

    modal.querySelector('#modal-cancel').addEventListener('click', () => { modal.remove(); resolve(null); });
    modal.querySelector('#modal-confirm').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const date = fmtISO(selected);
      modal.remove();
      resolve({ name, date });
    });
    attachBackdropClose(modal, () => { modal.remove(); resolve(null); });
  });
}
// "?"? Login form + import plan "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
document.addEventListener('DOMContentLoaded', () => {
  // Login Campus
  const form = document.getElementById('campus-login-form');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email    = document.getElementById('campus-email').value.trim();
      const password = document.getElementById('campus-password').value;
      const remember = document.getElementById('campus-remember').checked;
      const btn      = document.getElementById('campus-login-btn');
      const errEl    = document.getElementById('campus-login-error');

      btn.textContent = 'Connexion?';
      btn.disabled    = true;
      errEl.style.display = 'none';

      try {
        await fetchJSON('/api/campus/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (remember) {
          try { await fetchJSON('/api/campus/save-env', { method: 'POST', body: JSON.stringify({ email, password }) }); }
          catch(e) { /* silencieux */ }
        }
        showTrainingLoading();
        await loadTrainingPlan();
      } catch(err) {
        errEl.textContent = 'Connexion échouée : ' + err.message;
        errEl.style.display = 'block';
        btn.textContent = 'Se connecter';
        btn.disabled = false;
      }
    });
  }

  // Import plan partagé (bouton dans campus-connect-card)
  const importInput = document.getElementById('plan-import-input');
  if (importInput) {
    importInput.addEventListener('change', importPlan);
  }
});

// ......................................................
// PAGE OBJECTIFS
// ......................................................

// ═════════════════════════════════════════════════════════════════
// OBJECTIFS — Helpers performance & affichage
// ═════════════════════════════════════════════════════════════════

/** Une séance de renforcement (PPG) n'a pas d'impact sur la VO2max/VMA -
 *  ne doit pas compter dans l'assiduite utilisee pour projeter le gain de
 *  forme (voir getRemainingVmaGainPct). Meme critere que renderSessionDetail. */
function isStrengthSession(session) {
  return session.sport === 'ppg' || session.trainingCategory === 'gpp';
}

function _emptySessionBucket() {
  return { done: 0, missed: 0, remaining: 0 };
}
function _finalizeSessionBucket(b) {
  const assiduity = (b.done + b.missed) > 0 ? Math.round(b.done / (b.done + b.missed) * 100) : null;
  return { done: b.done, missed: b.missed, remaining: b.remaining, total: b.done + b.missed + b.remaining, assiduity };
}

/** Séances faites / manquées / restantes depuis localStorage, ventilées par
 *  catégorie (course/trail vs renforcement) car elles n'ont pas le même
 *  impact physiologique et l'utilisateur veut voir/suivre les deux
 *  séparément (voir aussi getRemainingVmaGainPct, qui n'utilise QUE
 *  l'assiduité cardio pour projeter le gain de VO2max). */
function computeSessionStats(weeks) {
  const doneMap = JSON.parse(localStorage.getItem('suivi_local_done') || '{}');
  const now = Date.now();
  const cardio = _emptySessionBucket();
  const strength = _emptySessionBucket();
  (weeks || []).forEach(week => {
    const weekPassed = startOfDay(week.weekDate + 7 * 86400000) < startOfDay(now);
    (week.sessions || []).forEach(session => {
      const bucket = isStrengthSession(session) ? strength : cardio;
      const key = (week._id || '') + '_' + session.trainingIndex;
      const status = doneMap[key] || session.status || 'todo';
      if (status === 'done') bucket.done++;
      else if (status === 'skip') bucket.missed++;
      else if (weekPassed) bucket.missed++; // passée non marquée = manquée
      else bucket.remaining++;
    });
  });
  const cardioStats = _finalizeSessionBucket(cardio);
  const strengthStats = _finalizeSessionBucket(strength);
  // Compat : total toutes catégories confondues (assiduité globale)
  const doneAll = cardio.done + strength.done, missedAll = cardio.missed + strength.missed;
  const assiduityAll = (doneAll + missedAll) > 0 ? Math.round(doneAll / (doneAll + missedAll) * 100) : null;
  return {
    cardio: cardioStats, strength: strengthStats,
    done: doneAll, missed: missedAll, remaining: cardio.remaining + strength.remaining,
    total: cardioStats.total + strengthStats.total, assiduity: assiduityAll,
  };
}

/** Estimation du temps de course en secondes depuis la VMA
 *  Trail : méthode km équivalents (1m D+ = 10m plat), standard trail français */
function estimateRaceTime(vma, distKm, dplusM, isTrail) {
  if (!vma || !distKm) return null;
  // Pour le trail, on convertit D+ en km plats équivalents avant d'appliquer le % VMA
  const equivKm = (isTrail && dplusM > 0) ? distKm + dplusM / 100 : distKm;
  let pctVma = isTrail
    ? (distKm <= 21 ? 0.70 : distKm <= 42 ? 0.65 : distKm <= 80 ? 0.58 : 0.50)
    : (distKm <= 5  ? 0.97 : distKm <= 10 ? 0.90 : distKm <= 21.1 ? 0.83 : 0.76);
  return Math.round((equivKm / (vma * pctVma)) * 3600);
}

function fmtSecsToTime(s) {
  if (!s || s <= 0) return '—';
  return Math.floor(s / 3600) + 'h' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}

function fmtPaceFromSecs(distKm, secs) {
  if (!distKm || !secs) return '';
  const total = Math.round(secs / distKm);
  return Math.floor(total / 60) + "'" + String(total % 60).padStart(2, '0') + "'' /km";
}

/** Retourne la VMA (km/h) depuis les sources disponibles.
 * Priorité : campusState.fitness.vma > _latestVO2Max global > null */
function getVmaFromState() {
  if (campusState.fitness?.vma > 0) return campusState.fitness.vma;
  if (typeof _latestVO2Max !== 'undefined' && _latestVO2Max > 3.5) {
    const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
    const factor = (profile.sex || 'M') === 'F' ? 0.315 : 0.313;
    return Math.round((_latestVO2Max - 3.5) * factor * 10) / 10;
  }
  return null;
}

/** Convertit un VO2max en VMA en se calibrant sur la VMA "actuelle" réelle
 *  (celle de getVmaFromState, qui priorise la VMA calculée par Garmin
 *  lui-même quand disponible). Sans cette calibration, convertir une
 *  ancienne valeur VO2max (historique, début de plan) avec la formule
 *  générique sexuée pouvait donner un résultat incohérent avec "aujourd'hui"
 *  quand Garmin utilise en interne un facteur légèrement différent - même
 *  VO2max affiché, temps différent. En se calibrant sur le couple
 *  (VO2max actuel, VMA actuelle réelle), la conversion reste TOUJOURS
 *  cohérente avec "Estimation actuelle", quelle que soit la source. */
function vo2ToVmaCalibrated(vo2) {
  const currentVma = getVmaFromState();
  const currentVo2 = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
  if (currentVma > 0 && currentVo2 > 3.5) {
    return (vo2 - 3.5) * (currentVma / (currentVo2 - 3.5));
  }
  const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
  const sexFactor = (profile.sex || 'M') === 'F' ? 0.315 : 0.313;
  return (vo2 - 3.5) * sexFactor;
}

/** Inverse de vo2ToVmaCalibrated - pour afficher un "VO2max projeté" cohérent
 *  avec la VMA projetée calculée (même calibration). */
function vmaToVo2Calibrated(vma) {
  const currentVma = getVmaFromState();
  const currentVo2 = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
  if (currentVma > 0 && currentVo2 > 3.5) {
    return vma / (currentVma / (currentVo2 - 3.5)) + 3.5;
  }
  const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
  const sexFactor = (profile.sex || 'M') === 'F' ? 0.315 : 0.313;
  return vma / sexFactor + 3.5;
}

/** Convertit un texte de temps cible (ex: "4h30" ou "4:30") en secondes */
function parseTargetTime(str) {
  if (!str) return null;
  const m1 = str.match(/^(\d+)[h:](\d{2})/i);
  if (m1) return parseInt(m1[1]) * 3600 + parseInt(m1[2]) * 60;
  const m2 = str.match(/^(\d+)h(\d*)$/i);
  if (m2) return parseInt(m2[1]) * 3600 + (parseInt(m2[2] || 0)) * 60;
  return null;
}

function getVO2maxGainPct(weeksTotal) {
  return weeksTotal <= 12 ? 0.03 : weeksTotal <= 20 ? 0.05 : weeksTotal <= 28 ? 0.07 : 0.09;
}

/** Gain de VMA encore attendu (%) sur les semaines RESTANTES du plan,
 *  pondere par l'assiduite reelle (seances faites vs manquees). Partage
 *  entre le bloc Estimations et la courbe pour qu'ils restent toujours
 *  coherents entre eux (meme point d'arrivee en fin de plan).
 *  Plancher a 30% : meme avec une assiduite tres faible, un entrainement
 *  irregulier produit quand meme une part de l'adaptation physiologique
 *  attendue - la ramener a quasi zero serait irrealiste. */
function getRemainingVmaGainPct(weeksTotal, weeks) {
  if (!weeksTotal) return 0;
  const now = Date.now();
  // Une semaine ne compte comme "ecoulee" qu'une fois terminee (7 jours
  // apres son debut), pas des que sa date de debut est passee - sinon la
  // semaine en cours est comptee comme deja terminee des le 2e jour.
  const elapsedWeeks = (weeks || []).filter(w => startOfDay(w.weekDate + 7 * 86400000) <= startOfDay(now)).length;
  const cardioAssiduity = computeSessionStats(weeks).cardio.assiduity;
  const assiduityRatio = cardioAssiduity !== null ? 0.3 + 0.7 * (cardioAssiduity / 100) : 1;
  const weeksRemaining = Math.max(0, weeksTotal - elapsedWeeks);
  return getVO2maxGainPct(weeksTotal) * (weeksRemaining / weeksTotal) * assiduityRatio;
}

/** Valeur VO2max "telle que Garmin l'affichait reellement" a une date donnee :
 *  la derniere mesure connue a cette date (report de la derniere valeur
 *  disponible), jamais melangee avec des mesures plus anciennes NI plus
 *  recentes. C'est fidele a la facon dont Garmin affiche lui-meme cette
 *  metrique au jour le jour (toujours la derniere estimation disponible, pas
 *  une moyenne glissante). Une moyenne ponderee sur plusieurs semaines
 *  d'historique a ete testee mais s'est reveleee trompeuse : pour une
 *  semaine tres recente (le jour meme du debut du plan par ex.), un groupe
 *  d'anciennes mesures pouvait peser plus lourd que la valeur du jour et
 *  produire une estimation plus rapide que "aujourd'hui", ce qui n'a pas de
 *  sens. history doit inclure un point "aujourd'hui" (voir plus bas) pour
 *  qu'aucune semaine ne puisse jamais deborder au-dela de la valeur reelle
 *  du jour. */
function vo2ValueAtDate(history, ts) {
  if (!history || history.length === 0) return null;
  let last = null;
  for (const h of history) {
    if (h.ts <= ts && (last === null || h.ts > last.ts)) last = h;
  }
  return last ? last.value : history[0].value;
}

/** Historique VO2max avec un point d'ancrage sur "aujourd'hui" (voir
 *  vo2ValueAtDate) - partagé entre le bloc Estimations et la courbe pour
 *  qu'ils restent toujours cohérents entre eux. */
function buildAnchoredVo2History() {
  const history = (typeof _vo2maxSeries !== 'undefined' ? _vo2maxSeries : [])
    .filter(p => p && p.date && typeof p.value === 'number')
    .map(p => ({ ts: new Date(p.date).getTime(), value: p.value }))
    .sort((a, b) => a.ts - b.ts);
  if (typeof _latestVO2Max !== 'undefined' && _latestVO2Max > 0) {
    const nowTs = Date.now();
    if (history.length === 0 || history[history.length - 1].ts < nowTs) {
      history.push({ ts: nowTs, value: _latestVO2Max });
    }
  }
  return history;
}

/** Exclut toute mesure antérieure au début du plan. Si le plan a été créé
 *  puis réellement démarré plus tard (ex: 12 jours sans séance avant la
 *  première sortie), la dernière valeur Garmin connue avant le début peut
 *  dater d'avant cette pause et n'a plus rien à voir avec l'état réel au
 *  démarrage du plan - il ne faut jamais remonter jusque-là. */
function vo2HistorySincePlanStart(weeks, vo2History) {
  if (!weeks || weeks.length === 0) return vo2History;
  const planStartTs = weeks[0].weekDate;
  return vo2History.filter(h => h.ts >= planStartTs);
}

/** VO2max estimé au "début de plan" : la valeur la plus proche disponible
 *  depuis le démarrage réel du plan (voir vo2HistorySincePlanStart), jamais
 *  une valeur d'avant. Utilise la même logique que la semaine 1 de la
 *  courbe pour que les deux restent toujours cohérents entre eux.
 *  Trois phases dans le temps :
 *  1. Avant le début du plan (semaine 1 pas encore commencée) : on affiche
 *     la valeur actuelle, qui continuera de s'ajuster tant que le plan n'a
 *     pas réellement démarré.
 *  2. Pendant la semaine 1 : la valeur continue de s'ajuster en temps réel
 *     (vo2ValueAtDate remonte naturellement jusqu'à "maintenant" puisque la
 *     fin de semaine 1 est encore dans le futur).
 *  3. Après le dimanche de la semaine 1 : la valeur se fige définitivement
 *     à ce qui était connu à cette date, même si le VO2max évolue ensuite. */
function getStartVo2(weeks, vo2History) {
  if (!weeks || weeks.length === 0) return null;
  const now = Date.now();
  if (startOfDay(weeks[0].weekDate) > startOfDay(now)) {
    // Semaine 1 pas encore commencée : pas de "début de plan" à proprement
    // parler, on reflète simplement l'état actuel
    return vo2History.length > 0 ? vo2History[vo2History.length - 1].value : null;
  }
  const sincePlan = vo2HistorySincePlanStart(weeks, vo2History);
  const weekEndTs = weeks[0].weekDate + 7 * 86400000;
  return vo2ValueAtDate(sincePlan, weekEndTs);
}

/** Distance en km depuis le goal (fallback planCategory.distLabel) */
function getDistFromGoal(goal) {
  const d = goal.specificData || {};
  if (d.distance    > 0) return d.distance;
  if (d.distanceInKm > 0) return d.distanceInKm;
  if (d.distKm      > 0) return d.distKm;
  // Parse planCategory.distLabel ex: "30_40" → 35, ou "35" → 35
  const cat = goal.planCategory || campusState.planCategory || {};
  if (cat.distLabel) {
    const parts = cat.distLabel.split('_').map(Number).filter(n => !isNaN(n) && n > 0);
    if (parts.length === 2) return Math.round((parts[0] + parts[1]) / 2);
    if (parts.length === 1) return parts[0];
  }
  return 0;
}

/** Rend les estimations de performance (Bloc 3) */
function renderEstimations(goal, weeks, dplusM, distKmOverride) {
  const el = id => document.getElementById(id);
  const isTrail = (goal.goalType || '').toLowerCase().includes('trail');
  // Utiliser UNIQUEMENT la distance saisie par l'utilisateur
  // Si distKmOverride est 0 ou absent : pas d'estimation
  const distKm = (distKmOverride != null && distKmOverride > 0) ? distKmOverride : 0;
  const weeksTotal = goal.durationInWeeks || weeks.length;

  const vma = getVmaFromState();
  if (!vma || !distKm) {
    // Vider le bloc estimation pour ne pas laisser l'ancienne valeur
    const estBlock = document.getElementById('goals-estimations-block');
    if (estBlock) {
      const nowEl = estBlock.querySelector('#goals-est-now');
      const endEl = estBlock.querySelector('#goals-est-end');
      const tgtEl = estBlock.querySelector('#goals-target-compare');
      if (nowEl) nowEl.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Renseignez la distance pour voir les estimations</span>';
      if (endEl) endEl.innerHTML = '';
      if (tgtEl) tgtEl.innerHTML = '';
      estBlock.style.opacity = '0.5';
    }
    return;
  }
  // Distance saisie → rétablir l'opacité
  const estBlock2 = document.getElementById('goals-estimations-block');
  if (estBlock2) estBlock2.style.opacity = '1';

  const vo2max = parseFloat((_latestVO2Max || (vma * 1000 / 60 * 0.2 + 3.5)).toFixed(1));
  const secsNow = estimateRaceTime(vma, distKm, dplusM, isTrail);
  const vo2Color = vo2max >= 55 ? '#22c55e' : vo2max >= 45 ? '#3b82f6' : vo2max >= 35 ? '#f59e0b' : '#ef4444';
  const vo2El = el('goals-vo2-current');
  if (vo2El) { vo2El.textContent = vo2max; vo2El.style.color = vo2Color; vo2El.style.fontWeight = '700'; }
  el('goals-time-current') && (el('goals-time-current').textContent = fmtSecsToTime(secsNow));
  el('goals-pace-current') && (el('goals-pace-current').textContent = isTrail ? '' : fmtPaceFromSecs(distKm, secsNow));

  // Bloc "Début de plan" : VO2max/temps estimé à la fin de la semaine 1
  // (voir getStartVo2), pour situer le point de départ réel du plan
  const vo2History = buildAnchoredVo2History();
  const vo2Start = getStartVo2(weeks, vo2History);
  if (vo2Start != null && weeks.length > 0) {
    const vmaStart = vo2ToVmaCalibrated(vo2Start);
    const secsStart = estimateRaceTime(vmaStart, distKm, dplusM, isTrail);
    el('goals-vo2-start') && (el('goals-vo2-start').textContent = Math.round(vo2Start * 10) / 10);
    el('goals-time-start') && (el('goals-time-start').textContent = fmtSecsToTime(secsStart));
    el('goals-start-date') && (el('goals-start-date').textContent =
      '(' + new Date(weeks[0].weekDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ')');
  } else {
    el('goals-vo2-start') && (el('goals-vo2-start').textContent = '—');
    el('goals-time-start') && (el('goals-time-start').textContent = '—');
    el('goals-start-date') && (el('goals-start-date').textContent = '');
  }

  const gainPct = getRemainingVmaGainPct(weeksTotal, weeks);
  const vmaEnd = vma * (1 + gainPct);
  const vo2maxEnd = parseFloat(vmaToVo2Calibrated(vmaEnd).toFixed(1));
  const secsEnd = estimateRaceTime(vmaEnd, distKm, dplusM, isTrail);
  const delta = secsNow && secsEnd ? secsNow - secsEnd : null;

  el('goals-vo2-projected')  && (el('goals-vo2-projected').textContent  = vo2maxEnd);
  el('goals-time-projected') && (el('goals-time-projected').textContent = fmtSecsToTime(secsEnd));
  if (delta && el('goals-time-delta')) {
    const dm = Math.floor(Math.abs(delta) / 60);
    el('goals-time-delta').textContent = delta > 0 ? `−${dm} min attendues` : `+${dm} min`;
    el('goals-time-delta').style.color = delta > 0 ? '#22c55e' : '#ef4444';
  }

  // Comparaison avec le temps cible
  const saved = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
  const targetSecs = parseTargetTime(saved.targetTime);
  const targetEl = el('goals-target-compare');
  if (targetEl && targetSecs) {
    const diffNow = secsNow ? secsNow - targetSecs : null;
    const diffEnd = secsEnd ? secsEnd - targetSecs : null;
    let html = `<div class="goals-target-display">⏱ Objectif : <strong>${saved.targetTime}</strong></div>`;
    if (diffNow !== null) {
      const abs = Math.abs(Math.round(diffNow / 60));
      html += diffNow > 0
        ? `<div class="goals-target-gap goals-target-gap--over">⚠ Estimation actuelle : +${abs} min au-dessus de votre objectif</div>`
        : `<div class="goals-target-gap goals-target-gap--ok">✓ Estimation actuelle : ${abs > 0 ? abs + ' min sous' : 'pile à'} votre objectif</div>`;
    }
    if (diffEnd !== null) {
      const abs = Math.abs(Math.round(diffEnd / 60));
      html += diffEnd > 0
        ? `<div class="goals-target-gap goals-target-gap--close">&#x1F4C8; Fin de plan : encore +${abs} min à combler</div>`
        : `<div class="goals-target-gap goals-target-gap--ok">&#x1F3C6; Fin de plan : objectif atteignable !</div>`;
    }
    targetEl.innerHTML = html;
  } else if (targetEl) {
    targetEl.innerHTML = '';
  }
}

let _goalsChartInst = null;

/** Courbe d'évolution du temps estimé (Bloc 4) */
function renderObjectifsChart(weeks, goal, dplusM, distKmOverride) {
  const canvas = document.getElementById('goals-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const isTrail = (goal.goalType || '').toLowerCase().includes('trail');
  // Utiliser UNIQUEMENT la distance saisie exlicitement par l'utilisateur
  const distKm  = (distKmOverride != null && distKmOverride > 0) ? distKmOverride : 0;
  const weeksTotal = goal.durationInWeeks || weeks.length;
  const now = Date.now();
  const vma = getVmaFromState();
  if (!vma || !distKm || weeksTotal < 2) return;

  const elapsedWeeks = weeks.filter(w => startOfDay(w.weekDate + 7 * 86400000) <= startOfDay(now)).length;

  // Même formule que le bloc Estimations (gain pondéré par l'assiduité réelle
  // et le nombre de semaines restantes) pour que les deux blocs soient
  // toujours cohérents entre eux (même valeur en fin de plan).
  const vmaEnd = vma * (1 + getRemainingVmaGainPct(weeksTotal, weeks));

  // Conversion VO2max -> VMA calibrée sur la VMA actuelle réelle (voir
  // vo2ToVmaCalibrated), pour rester cohérent avec le bloc Estimations
  const vo2ToVma = vo2ToVmaCalibrated;

  // Historique quotidien réel du VO2max (source Garmin), utilisé pour que la
  // portion "passée" de la courbe reflète les séances réellement effectuées
  // au lieu d'une simple interpolation théorique. On exclut tout ce qui est
  // antérieur au début du plan (voir vo2HistorySincePlanStart) : sinon, un
  // plan créé puis démarré plus tard (pause avant la 1ère séance) remonterait
  // à tort jusqu'à une valeur d'avant cette pause.
  const vo2History = vo2HistorySincePlanStart(weeks, buildAnchoredVo2History());

  // Temps cible (ligne horizontale verte)
  const saved = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
  const targetSecs = parseTargetTime(saved.targetTime);
  const targetMins = targetSecs ? Math.round(targetSecs / 60) : null;

  const currentMins = Math.round((estimateRaceTime(vma, distKm, dplusM, isTrail) || 0) / 60);
  const endMins = Math.round((estimateRaceTime(vmaEnd, distKm, dplusM, isTrail) || 0) / 60);

  const labels = [], past = [], future = [];
  for (let w = 1; w <= weeksTotal; w++) {
    labels.push('S' + w);
    if (w <= elapsedWeeks) {
      // Semaine passée : VMA réelle = dernière valeur VO2max connue à la fin
      // de cette semaine (ce que Garmin affichait réellement à ce moment-là),
      // jamais antérieure au début du plan (vo2History déjà filtré plus haut)
      const weekEndTs = weeks[w - 1] ? weeks[w - 1].weekDate + 7 * 86400000 : null;
      const vo2Week = weekEndTs != null ? vo2ValueAtDate(vo2History, weekEndTs) : null;
      if (vo2Week != null) {
        const vmaWeek = vo2ToVma(vo2Week);
        past.push(Math.round((estimateRaceTime(vmaWeek, distKm, dplusM, isTrail) || 0) / 60));
      } else {
        past.push(null);
      }
      future.push(null);
    } else if (w === elapsedWeeks + 1) {
      past.push(currentMins); future.push(currentMins);
    } else {
      const f = (w - (elapsedWeeks + 1)) / (weeksTotal - (elapsedWeeks + 1));
      const mins = Math.round(currentMins + (endMins - currentMins) * f);
      past.push(null); future.push(mins);
    }
  }

  if (_goalsChartInst) { _goalsChartInst.destroy(); _goalsChartInst = null; }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tc = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const gc = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  const datasets = [
    { label: 'Progression réelle', data: past,   borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)', fill: true, tension: 0.4,
      pointRadius: 3, borderWidth: 2.5 },
    { label: 'Projection', data: future, borderColor: '#f97316',
      borderDash: [5,5], fill: false, tension: 0.4, pointRadius: 2, borderWidth: 2 }
  ];
  if (targetMins) {
    datasets.push({
      label: 'Temps cible', data: Array(weeksTotal).fill(targetMins),
      borderColor: '#22c55e', borderDash: [3,3],
      fill: false, tension: 0, pointRadius: 0, borderWidth: 1.8
    });
  }

  _goalsChartInst = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tc, font: { size: 12 }, boxWidth: 20 } },
        tooltip: { callbacks: { label: ctx => {
          const m = ctx.raw; if (m == null) return '';
          return ` ${ctx.dataset.label} : ${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
        }}}
      },
      scales: {
        x: { grid: { color: gc }, ticks: { color: tc, maxTicksLimit: 10 } },
        y: { grid: { color: gc }, ticks: { color: tc,
          callback: v => Math.floor(v/60) + 'h' + String(v%60).padStart(2,'0') } }
      }
    }
  });
}

/** Alerte d'assiduité pour une catégorie de séances (course/trail ou
 *  renforcement) - séparées car elles n'ont pas le même enjeu : le
 *  cardio fait progresser la VO2max/l'allure de course, le renforcement
 *  prévient les blessures et améliore l'économie de course sans se voir
 *  sur la VO2max. */
function buildAssiduityAlert(bucket, kind) {
  if (bucket.assiduity === null || (bucket.done + bucket.missed) < 3) return null;
  if (kind === 'cardio') {
    if (bucket.assiduity >= 90) return { cls: 'green', icon: '🟢', title: 'Excellente régularité course/trail',
      msg: 'Vous êtes parfaitement dans les temps sur vos séances course/trail — ce sont elles qui font progresser votre VO2max, continuez ainsi !' };
    if (bucket.assiduity >= 70) return { cls: 'yellow', icon: '🟡', title: 'Bonne assiduité course/trail',
      msg: `${bucket.missed} séance(s) course/trail manquée(s) — ce sont elles qui font évoluer votre VO2max, essayez de rattraper les séances clés (fractionné, sortie longue).` };
    return { cls: 'red', icon: '🔴', title: 'Assiduité course/trail insuffisante',
      msg: 'Beaucoup de séances course/trail manquées — ce sont elles qui font progresser votre VO2max et votre allure de course, concentrez-vous en priorité sur les sorties longues.' };
  }
  // Renforcement : pas d'impact direct sur la VO2max, jamais d'alerte rouge alarmiste
  if (bucket.assiduity >= 90) return { cls: 'green', icon: '🟢', title: 'Excellente régularité renforcement',
    msg: 'Vous suivez bien vos séances de renforcement — ça ne se voit pas sur la VO2max, mais ça réduit le risque de blessure et améliore votre économie de course.' };
  if (bucket.assiduity >= 70) return { cls: 'yellow', icon: '🟡', title: 'Bonne assiduité renforcement',
    msg: `${bucket.missed} séance(s) de renforcement manquée(s) — moins prioritaire que les sorties course, mais utile pour la prévention des blessures.` };
  return { cls: 'yellow', icon: '🟠', title: 'Renforcement à ne pas négliger',
    msg: 'Peu de séances de renforcement faites — sans impact direct sur la VO2max, mais elles protègent contre les blessures à mesure que le volume de course augmente.' };
}

/** Alertes contextuelles (Bloc 5) */
function renderGoalsAlerts(goal, weeks, stats) {
  const container = document.getElementById('goals-alerts-section');
  if (!container) return;
  const compTs = goal.competitionDate
    ? (typeof goal.competitionDate === 'number' ? goal.competitionDate : new Date(goal.competitionDate).getTime())
    : null;
  const daysLeft = compTs ? Math.ceil((compTs - Date.now()) / 86400000) : null;
  const alerts = [];

  const cardioAlert = buildAssiduityAlert(stats.cardio, 'cardio');
  if (cardioAlert) alerts.push(cardioAlert);
  const strengthAlert = buildAssiduityAlert(stats.strength, 'strength');
  if (strengthAlert) alerts.push(strengthAlert);

  if (daysLeft !== null) {
    if (daysLeft <= 0)
      alerts.push({ cls: 'blue', icon: '🏁', title: 'Le jour J est arrivé !',
        msg: 'Bonne course ! Tout votre travail de préparation va payer.' });
    else if (daysLeft <= 21)
      alerts.push({ cls: 'blue', icon: '⚡', title: 'Phase d’affûtage',
        msg: `J-${daysLeft} — réduisez le volume, maintenez l’intensité. Reposez-vous bien !` });
    else if (daysLeft <= 21 * 3)
      alerts.push({ cls: 'yellow', icon: '⏳', title: 'Dernière ligne droite',
        msg: `Plus que ${daysLeft} jours — concentrez-vous sur la récupération et l’alimentation.` });
  }

  container.innerHTML = alerts.map(a =>
    `<div class="goals-alert goals-alert--${a.cls}">
       <span class="goals-alert-icon">${a.icon}</span>
       <div class="goals-alert-text"><strong>${a.title}</strong>${a.msg}</div>
     </div>`
  ).join('');
}

/** Orchestre tous les nouveaux blocs (appelé par updateGoalsPage) */
function renderObjectifsBlocks(goal, weeks) {
  const el = id => document.getElementById(id);
  const isTrail = (goal.goalType || '').toLowerCase().includes('trail');
  const specificData = goal.specificData || {};
  const planCategory = goal.planCategory || campusState.planCategory || null;
  const distKm = getDistFromGoal(goal);
  const weeksTotal = goal.durationInWeeks || weeks.length;

  // ── Réinitialiser les inputs si le plan a changé ──────────────────────────
  // Le dataset.init empêche la re-initialisation lors d'un changement de plan
  const planUid = goal._id || goal.name || 'plan';
  const distInputEl  = document.getElementById('goals-dist-input');
  const dplusInputEl = document.getElementById('goals-dplus-input');
  const prevPlanUid  = distInputEl?.dataset.planId || null;
  if (distInputEl  && prevPlanUid !== planUid) { delete distInputEl.dataset.init;  distInputEl.dataset.planId  = planUid; }
  if (dplusInputEl && prevPlanUid !== planUid) { delete dplusInputEl.dataset.init; dplusInputEl.dataset.planId = planUid; }
  // ──────────────────────────────────────────────────────────────────
  // ── Nettoyage si jamais validé ──────────────────────────────────
  // Si l'utilisateur n'a jamais cliqué "Valider", on efface les valeurs
  // auto-sauvegardées ET les champs pour repartir sur une ardoise vierge
  const _planId = goal._id || 'plan';
  const _validatedKey = 'suivi_objectif_validated_' + _planId;
  if (!localStorage.getItem(_validatedKey)) {
    localStorage.removeItem('suivi_objectif_dist_'  + _planId);
    localStorage.removeItem('suivi_objectif_dplus_' + _planId);
    const _pg = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
    delete _pg.targetTime;
    localStorage.setItem('suivi_personal_goals', JSON.stringify(_pg));
    const _di = document.getElementById('goals-dist-input');
    const _dpi = document.getElementById('goals-dplus-input');
    const _ti = document.getElementById('goal-target-time');
    if (_di)  _di.value  = '';
    if (_dpi) _dpi.value = '';
    if (_ti)  _ti.value  = '';
  }
  // ────────────────────────────────────────────────────────────────


  // Badge type plan
  const badge = el('goals-plan-badge');
  if (badge) {
    badge.textContent = campusState.usingImportedPlan
      ? 'Plan importé'
      : campusState.campusHasPlan ? 'Plan Campus' : 'Plan importé';
  }

  // Badge type course (TRAIL / ROUTE)
  const typeBadgeEl = el('goals-race-type-badge');
  if (typeBadgeEl) {
    typeBadgeEl.textContent = isTrail ? '🏔 Trail' : personEmoji('running') + ' Route';
    typeBadgeEl.className = 'goals-race-type-badge ' + (isTrail ? 'goals-race-type-badge--trail' : 'goals-race-type-badge--road');
  }

  // Meta course (catégorie trail uniquement — dist et temps cible sont dans les inputs)
  const metaEl = el('goals-race-meta');
  if (metaEl) {
    const items = [];
    if (isTrail && distKm) { const c = getTrailCatLabel(distKm); if (c) items.push(c); }
    metaEl.innerHTML = items.map(t => `<span class="goals-race-meta-chip">${t}</span>`).join('');
  }

  // Compteurs séances, ventilés course/trail vs renforcement
  const stats = computeSessionStats(weeks);
  const fillBucket = (suffix, bucket) => {
    el('goals-sess-done-' + suffix)      && (el('goals-sess-done-' + suffix).textContent = bucket.done);
    el('goals-sess-missed-' + suffix)    && (el('goals-sess-missed-' + suffix).textContent = bucket.missed);
    el('goals-sess-remaining-' + suffix) && (el('goals-sess-remaining-' + suffix).textContent = bucket.remaining);
    const aEl = el('goals-assiduity-' + suffix);
    if (aEl) {
      aEl.textContent = bucket.assiduity !== null ? bucket.assiduity + '%' : '—';
      aEl.style.color = bucket.assiduity === null ? ''
        : bucket.assiduity >= 90 ? '#22c55e' : bucket.assiduity >= 70 ? '#f59e0b' : '#ef4444';
    }
  };
  fillBucket('cardio', stats.cardio);
  fillBucket('ppg', stats.strength);

  // D+ input (trail uniquement)
  const dplusRow = el('goals-dplus-row');
  if (dplusRow) dplusRow.style.display = isTrail ? '' : 'none';

  // Parse dplusLabel "1000_2000" si présent
  let dplusMin = specificData.elevationGain || 0;
  let dplusMax = specificData.elevationGain || 0;
  if (planCategory?.dplusLabel) {
    const parts = planCategory.dplusLabel.split('_').map(Number).filter(n => !isNaN(n));
    if (parts.length === 2) { dplusMin = parts[0]; dplusMax = parts[1]; }
  }
  const dplusMid = (dplusMin && dplusMax) ? Math.round((dplusMin + dplusMax) / 2) : (specificData.elevationGain || 0);
  const planKey = 'suivi_objectif_dplus_' + (goal._id || 'plan');
  const savedDplus = localStorage.getItem(planKey);
  const validatedKey = 'suivi_objectif_validated_' + (goal._id || 'plan');
  const wasValidated = !!localStorage.getItem(validatedKey);
  let dplusM = savedDplus ? parseInt(savedDplus) : dplusMid;

  const dplusInput = el('goals-dplus-input');
  if (dplusInput && isTrail) {
    if (!dplusInput.dataset.init) {
      dplusInput.value = (wasValidated && savedDplus) ? dplusM : '';  // vierge si pas encore validé
      dplusInput.dataset.init = '1';
      dplusInput.oninput = () => {
        const val = parseInt(dplusInput.value) || dplusMid;
        localStorage.setItem(planKey, val);
        renderEstimations(goal, weeks, val);
        renderObjectifsChart(weeks, goal, val);
      };
    }
  }

  // ── Distance input (toujours visible) ──────────────────────────
  const distKey   = 'suivi_objectif_dist_' + (goal._id || 'plan');
  const savedDist = localStorage.getItem(distKey);
  const distInput = el('goals-dist-input');

  // Fourchette de distance depuis planCategory
  let distMin = 0, distMax = 0;
  if (planCategory?.distLabel) {
    const parts = planCategory.distLabel.split('_').map(Number).filter(n => !isNaN(n) && n > 0);
    if (parts.length === 2) { distMin = parts[0]; distMax = parts[1]; }
    else if (parts.length === 1) { distMin = distMax = parts[0]; }
  }
  const distMid = distMin && distMax ? Math.round((distMin + distMax) / 2 * 2) / 2 : (distKm || 0);

  if (distInput) {
    // Valeur toujours mise à jour (hors dataset.init)
    distInput.value = (wasValidated && savedDist) ? parseFloat(savedDist) : '';
    if (!distInput.dataset.init) {
      distInput.dataset.init = '1';
      distInput.oninput = () => {
        const val = parseFloat(distInput.value);  // ne pas fallback distMid si vide
        if (val > 0) {
          localStorage.setItem(distKey, val);
          const dplusNow = parseInt(el('goals-dplus-input')?.value) || dplusM;
          renderEstimations(goal, weeks, dplusNow, val);  // passer la valeur réelle
          renderObjectifsChart(weeks, goal, dplusNow, val);
        } else {
          // Champ vidé → effacer l'estimation
          const estEl = document.getElementById('goals-estimations-block');
          if (estEl) estEl.style.opacity = '0.35';
          renderEstimations(goal, weeks, 0, 0);  // retournera early
        }
        document.querySelector('.btn-goals-valider')?.classList.remove('btn-validated');
      };
    }
  }

  // Distance effective : UNIQUEMENT si l'utilisateur a validé avec une valeur
  // Sinon 0 → pas d'estimation (pour ne pas afficher la distance du plan par défaut)
  const distKmEff = (wasValidated && savedDist && parseFloat(savedDist) > 0)
    ? parseFloat(savedDist)
    : 0;

  renderEstimations(goal, weeks, dplusM, distKmEff);
  renderObjectifsChart(weeks, goal, dplusM, distKmEff);
  renderGoalsAlerts(goal, weeks, stats);

  // Restaurer l'état vert du bouton si déjà validé
  const _btn = document.querySelector('.btn-goals-valider');
  if (_btn && wasValidated) {
    _btn.classList.add('btn-validated');
    _btn.innerHTML = '&#x2713; Enregistré';
  } else if (_btn) {
    _btn.classList.remove('btn-validated');
    _btn.innerHTML = '&#x2713; Valider';
  }
}

// ═════════════════════════════════════════════════════════════════
async function loadGoalsPage() {
  const el = id => document.getElementById(id);
  const goalDetailWrap = el('goals-campus-detail');
  if (!goalDetailWrap) return;

  // Si le plan n'a pas encore été chargé (user arrive directement sur Objectifs)
  if (!campusState.goal) {
    await preloadPlanState().catch(() => {});
    // Charger aussi la fitness si besoin
    if (!campusState.fitness?.vma) {
      try {
        const fitnessData = await fetchJSON('/api/fitness');
        if (fitnessData?.vma) campusState.fitness = fitnessData;
      } catch(e) {}
    }
  }

  const goal  = campusState.goal;
  const weeks = campusState.weeks;

  // Afficher l'état correct (plan présent ou non)
  const noPlanEl   = el('goals-no-plan');
  const withPlanEl = el('goals-with-plan');
  if (noPlanEl)   noPlanEl.style.display   = goal ? 'none' : '';
  if (withPlanEl) withPlanEl.style.display = goal ? ''     : 'none';

  if (!goal) return;

  // ── Charger la fitness (VMA/VO₂max) en priorité pour les estimations ──
  if (!campusState.fitness?.vma) {
    try {
      const fitnessData = await fetchJSON('/api/fitness');
      if (fitnessData?.vma) campusState.fitness = fitnessData;
    } catch(e) { /* VMA depuis profil personnel en fallback */ }
  }

  updateGoalsPage(goal, weeks);

  // Tentative de chargement du résumé détaillé + allures
  try {
    const detailRes = await fetchJSON('/api/campus/goal-detail');
    if (detailRes?.summary) renderGoalSummary(detailRes.summary);
  } catch(e) { /* pas de token = pas de détail */ }

  // Re-rendu des estimations après tous les fetches (VMA peut être à présent disponible)
  if (campusState.goal && campusState.weeks) {
    const dplusInput = document.getElementById('goals-dplus-input');
    const distInput  = document.getElementById('goals-dist-input');
    const planKey  = 'suivi_objectif_dplus_' + (campusState.goal._id || 'plan');
    const distKey  = 'suivi_objectif_dist_'  + (campusState.goal._id || 'plan');
    const dplusM   = dplusInput ? (parseInt(dplusInput.value) || 0) : (parseInt(localStorage.getItem(planKey)) || 0);
    const distKmEff = distInput ? (parseFloat(distInput.value) || 0) : (parseFloat(localStorage.getItem(distKey)) || 0);
    renderEstimations(campusState.goal, campusState.weeks, dplusM, distKmEff);
    renderObjectifsChart(campusState.weeks, campusState.goal, dplusM, distKmEff);
  }
}

function updateGoalsPage(goal, weeks = []) {
  const el = id => document.getElementById(id);
  if (!goal) return;

  const now    = Date.now();
  const total  = goal.durationInWeeks || weeks.length;
  // Une semaine ne compte comme "ecoulee" qu'une fois terminee, pas des que
  // sa date de debut est passee (voir renderObjectifsChart/getRemainingVmaGainPct)
  const elapsed = weeks.filter(w => startOfDay(w.weekDate + 7 * 86400000) <= startOfDay(now)).length;
  const left   = Math.max(0, total - elapsed);

  // Position du curseur/de la barre : continue au fil des jours (pas juste
  // par semaine entiere) pour qu'un coureur au 2e jour de sa 2e semaine soit
  // place proportionnellement entre S1 et S2, pas plaque sur l'un ou l'autre.
  // Le % affiche suit la meme base pour rester coherent avec le remplissage.
  const W7 = 7 * 86400000;
  const planStartMs = weeks[0]?.weekDate ?? now;
  const totalDurationMs = total * W7;
  const elapsedMs = Math.min(Math.max(now - planStartMs, 0), totalDurationMs);
  const pctExact = totalDurationMs > 0 ? (elapsedMs / totalDurationMs) * 100 : 0;

  // Stats progression
  el('goals-weeks-done') && (el('goals-weeks-done').textContent = elapsed);
  el('goals-weeks-left') && (el('goals-weeks-left').textContent = left);
  el('goals-pct')        && (el('goals-pct').textContent        = Math.round(pctExact) + '%');
  el('goals-progress-fill') && (el('goals-progress-fill').style.width = pctExact + '%');
  const marker = el('goals-progress-marker');
  if (marker) { marker.style.left = pctExact + '%'; marker.textContent = personEmoji('running'); }

  // Graduations : une section par semaine du plan
  const ticksEl = el('goals-progress-ticks');
  if (ticksEl && total > 1) {
    ticksEl.innerHTML = Array.from({ length: total - 1 }, (_, i) =>
      `<span class="goals-progress-tick" style="left:${(i + 1) / total * 100}%"></span>`
    ).join('');
  } else if (ticksEl) {
    ticksEl.innerHTML = '';
  }

  // Numero de semaine au-dessus de chaque section : colore une fois passee
  // (semaine <= elapsed), neutre pour les semaines a venir.
  const labelsEl = el('goals-progress-weeklabels');
  if (labelsEl && total > 0) {
    labelsEl.innerHTML = Array.from({ length: total }, (_, i) => {
      const w = i + 1;
      const centerPct = (i + 0.5) / total * 100;
      const done = w <= elapsed;
      return `<span class="goals-progress-weeklabel${done ? ' goals-progress-weeklabel--done' : ''}" style="left:${centerPct}%">${w}</span>`;
    }).join('');
  } else if (labelsEl) {
    labelsEl.innerHTML = '';
  }

  // Course cible
  const compDate = goal.competitionDate;
  if (compDate) {
    const compTs    = typeof compDate === 'number' ? compDate : new Date(compDate).getTime();
    const daysLeft  = Math.ceil((compTs - now) / 86400000);
    const weeksLeft = Math.ceil(daysLeft / 7);
    el('goals-race-date')    && (el('goals-race-date').textContent  = fmtDateLong(compDate));
    el('countdown-days')     && (el('countdown-days').textContent   = Math.max(0, daysLeft));
    el('countdown-weeks')    && (el('countdown-weeks').textContent  = Math.max(0, weeksLeft));
    el('goals-race-name')    && (el('goals-race-name').textContent  = goal.name || goal.goalTitle || '?');
  }

  // Thème semaine courante
  const currentWeek = weeks.find(w => isNowInWeek(now, w.weekDate));
  if (currentWeek?.context?.cycleDescription && el('goals-cycle-theme')) {
    el('goals-cycle-theme').innerHTML = `<div class="goals-theme-desc">
      <strong>Thème semaine en cours :</strong> ${currentWeek.context.cycleDescription}
    </div>`;
  }

  // Chip catégorie course (distance/D+ déjà affichés dans les champs éditables ci-dessus,
  // pas besoin de les répéter ici — uniquement la catégorie, info non montrée ailleurs)
  const specificData = goal.specificData || {};
  const raceInfoHtml = [
    (() => { const isTrail = (goal.goalType || '').toLowerCase().includes('trail'); return isTrail ? (getTrailCatLabel(specificData.distance) ? `<span class="race-chip">${getTrailCatLabel(specificData.distance)}</span>` : '') : (specificData.trailTitle ? `<span class="race-chip">${specificData.trailTitle}</span>` : ''); })()
  ].filter(Boolean).join('');
  if (raceInfoHtml && el('goals-race-content')) {
    let existing = el('goals-race-content').querySelector('.race-chips');
    if (!existing) {
      const div = document.createElement('div');
      div.className = 'race-chips';
      div.innerHTML = raceInfoHtml;
      el('goals-race-content').appendChild(div);
    }
  }

  // Rendu des cycles
  renderCyclesFromWeeks(weeks, now);

  // Rendu des nouveaux blocs Objectifs (sessions, estimations, courbe, alertes)
  renderObjectifsBlocks(goal, weeks);

  // Précharger les objectifs personnels sauvegardés
  const saved = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
  if (saved.raceName)   el('goal-race-name-input') && (el('goal-race-name-input').value = saved.raceName);
  if (localStorage.getItem('suivi_objectif_validated_' + (goal._id || 'plan')) && saved.targetTime) el('goal-target-time') && (el('goal-target-time').value = saved.targetTime);
  if (saved.vma)        el('goal-target-vma')      && (el('goal-target-vma').value      = saved.vma);
  if (saved.time10k)    el('goal-target-10k')      && (el('goal-target-10k').value      = saved.time10k);
  // NE PAS écraser goals-race-name : le nom du plan (goal.name) fait autorité
}

// "?"? Cycles (dérivés des semaines) "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function renderCyclesFromWeeks(weeks, now) {
  const cyclesContainer = document.getElementById('goals-cycles-list');
  if (!cyclesContainer) return;

  // Grouper les semaines par cycleTheme
  const cycleMap = new Map();
  for (const w of weeks) {
    const theme = w.context?.cycleTheme || 'unknown';
    if (!cycleMap.has(theme)) {
      cycleMap.set(theme, {
        theme,
        label: THEME_LABELS[theme] || theme.replace(/-/g, ' '),
        description: w.context?.cycleDescription || '',
        weeks: [],
      });
    }
    cycleMap.get(theme).weeks.push(w);
  }

  const cycles = [...cycleMap.values()];
  if (cycles.length === 0) {
    cyclesContainer.innerHTML = '';
    return;
  }

  const html = cycles.map(c => {
    const firstWeekDate = c.weeks[0].weekDate;
    const lastWeekDate  = c.weeks[c.weeks.length - 1].weekDate + 7 * 86400000;
    let statusLabel, statusCls;
    if (startOfDay(lastWeekDate) < startOfDay(now)) {
      statusLabel = 'Passé'; statusCls = 'cycle-status--past';
    } else if (startOfDay(firstWeekDate) > startOfDay(now)) {
      statusLabel = 'À venir'; statusCls = 'cycle-status--future';
    } else {
      statusLabel = 'En cours'; statusCls = 'cycle-status--ongoing';
    }

    return `
      <div class="cycle-card">
        <div class="cycle-card-header">
          <div>
            <div class="cycle-card-title">${c.label}</div>
            <div class="cycle-card-duration">${c.weeks.length} semaine${c.weeks.length > 1 ? 's' : ''}</div>
          </div>
          <span class="cycle-status-badge ${statusCls}">${statusLabel}</span>
        </div>
        ${c.description ? `<div class="cycle-card-desc">${c.description}</div>` : ''}
      </div>`;
  }).join('');

  cyclesContainer.innerHTML = html;
}

// "?"? Résumé goal Campus "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function renderGoalSummary(summary) {
  const header = summary.header || {};
  const assiduity = summary.assiduity || {};
  const el = id => document.getElementById(id);

  // Mise à jour du compteur d'assiduité si l'élément existe
  if (el('goals-sessions-done') && assiduity.sessionsDone !== undefined) {
    el('goals-sessions-done').textContent = `${assiduity.sessionsDone} / ${assiduity.sessionsTotal} séances`;
  }
}

// Allures de course — Route + Trail selon le type de plan
// Construit le contenu (utilisé par la modale "Voir mes allures" — plus de
// carte affichée en permanence sur la page, redondante avec le Profil).
function buildPacesTableHTML() {
  const isTrail = (campusState.goal?.goalType || '').toLowerCase().includes('trail');

  // Zones affichees (du plus lent au plus rapide), construites depuis
  // ALLURE_PLUS_ZONES via calcAllureRef/calcAllureRefTrail — la meme source
  // de verite unique que le tableau Allures du Profil, pour que les deux
  // affichent toujours des valeurs identiques (plus de table dupliquee ici).
  const PACE_MODAL_ZONES = ['EF', 'TEMPO', 'AS42', 'SWEET_SPOT', 'AS21', 'S60', 'AS10', 'S30', 'VMA'];
  const SHORT_CODE = { EF: 'EF', TEMPO: 'T', AS42: 'M42', SWEET_SPOT: 'SS', AS21: 'M21', S60: 'S60', AS10: 'M10', S30: 'S30', VMA: 'VMA' };

  const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
  const sex = profile.sex || 'M';
  const vo2 = typeof _latestVO2Max !== 'undefined' ? _latestVO2Max : null;
  const factorVma = sex === 'F' ? 0.315 : 0.313;
  const vmaKmh = (vo2 && vo2 > 3.5) ? Math.round((vo2 - 3.5) * factorVma * 10) / 10 : null;

  const colHeader = isTrail
    ? `<div class="paces-col-header"><span class="paces-col-zone"></span><span class="paces-col-road">${personEmoji('running')} Route /km</span><span class="paces-col-trail">&#x1F3D4; Trail /km</span></div>`
    : `<div class="paces-col-header"><span class="paces-col-zone"></span><span class="paces-col-road">Allure /km</span></div>`;

  const rows = PACE_MODAL_ZONES.map(key => {
    const ref = ALLURE_PLUS_ZONES[key];
    const sub = Math.round(ref.pctLow * 100) + '-' + Math.round(ref.pctHigh * 100) + '% VMA' + (key === 'S60' ? '  ★' : '');
    let roadStr = '?', trailHtml = '';
    if (vmaKmh) {
      const road = calcAllureRef(key, vmaKmh);
      roadStr = fmtPace(road.paceMin) + '<small class="pace-sep">&rarr;</small>' + fmtPace(road.paceMax);
      if (isTrail) {
        const trail = calcAllureRefTrail(key, vmaKmh);
        trailHtml = '<span class="pace-trail-val">' + fmtPace(trail.paceMin) + '<small class="pace-sep">&rarr;</small>' + fmtPace(trail.paceMax) + '</span><small class="pace-trail-pct">+' + Math.round((trail.trailCorr || 0) * 100) + '%</small>';
      }
    }
    return '<div class="pace-row" style="border-left:3px solid ' + ref.color + '40"><div class="pace-row-zone"><span class="pace-zone-label" style="color:' + ref.color + '">' + (SHORT_CODE[key] || key) + '</span><div><div class="pace-row-label">' + ref.label + '</div><div class="pace-row-sub">' + sub + '</div></div></div><div class="pace-row-values' + (isTrail ? ' pace-row-values--trail' : '') + '"><span class="pace-road-val">' + roadStr + '<small class="pace-unit">/km</small></span>' + (isTrail ? trailHtml : '') + '</div></div>';
  }).join('');

  const typeLabel = isTrail
    ? '<span class="paces-type-badge paces-type-badge--trail">&#x1F3D4; Trail</span>'
    : '<span class="paces-type-badge paces-type-badge--road">' + personEmoji('running') + ' Route</span>';
  const vmaNote = vmaKmh ? '<span class="paces-vma-badge">VMA ' + vmaKmh + ' km/h</span>' : '';

  return '<div class="paces-card-title-row"><h2 class="card-title" style="margin:0">&#x23F1; Allures de course</h2><div class="paces-badges">' + typeLabel + vmaNote + '</div></div>' + colHeader + '<div class="paces-list">' + rows + '</div>';
}

// Modale "Voir mes allures" — construit le tableau à la demande
function showPacesModal() {
  const existing = document.getElementById('paces-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'paces-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--bg-white);border:1px solid var(--border);border-radius:16px;padding:18px 20px 16px;width:100%;max-width:700px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      ${buildPacesTableHTML()}
      <button id="paces-modal-close" style="margin-top:14px;width:100%;padding:9px;border:1px solid var(--border);border-radius:9px;background:transparent;color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer;">Fermer</button>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => { modal.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  modal.querySelector('#paces-modal-close').addEventListener('click', close);
  attachBackdropClose(modal, close);
  document.addEventListener('keydown', escHandler);
}

// "?"? Objectifs personnels sauvegardés "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
/** Valide et applique les saisies course (distance, D+, temps cible) */
function applyRaceInputs() {
  const el = id => document.getElementById(id);
  const dist  = parseFloat(el('goals-dist-input')?.value)  || 0;
  const dplus = parseInt(el('goals-dplus-input')?.value)   || 0;
  const targetTime = (el('goal-target-time')?.value || '').trim();
  const goal = campusState.goal;
  if (!goal) return;
  const planId = goal._id || 'plan';
  if (dist)  localStorage.setItem('suivi_objectif_dist_'  + planId, dist);
  if (dplus) localStorage.setItem('suivi_objectif_dplus_' + planId, dplus);
  localStorage.setItem('suivi_objectif_validated_' + planId, '1');  // marquer comme validé
  const goals = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
  goals.targetTime = targetTime;
  localStorage.setItem('suivi_personal_goals', JSON.stringify(goals));
  if (campusState.weeks) {
    renderEstimations(campusState.goal, campusState.weeks, dplus, dist);
    renderObjectifsChart(campusState.weeks, campusState.goal, dplus, dist);
  }
  const btn = document.querySelector('.btn-goals-valider');
  if (btn) { btn.classList.add('btn-validated'); btn.innerHTML = '&#x2713; Enregistré'; }
  // Réinitialiser le bouton quand l'utilisateur retouche le temps cible
  const timeInput = document.getElementById('goal-target-time');
  if (timeInput && !timeInput._resetListener) {
    timeInput._resetListener = true;
    timeInput.oninput = () => { if (btn) { btn.classList.remove('btn-validated'); btn.innerHTML = '&#x2713; Valider'; } };
  }
}

/** Alias pour compatibilite */
function saveGoals() { applyRaceInputs(); }

// "?"? Export Google Sheets (placeholder) "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function exportToSheets() {
  showToast('Export Google Sheets - intégration en cours...', 'info');
}

// ......................................................
// UTILITAIRES
// ......................................................

// "?"? Toast notifications "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
  const bgColors = { success: '#f0fdf4', error: '#fef2f2', info: '#eff6ff' };
  const toast = document.createElement('div');
  toast.style.cssText = `
    background:${bgColors[type] || '#fff'};
    border:1.5px solid ${colors[type] || '#e8e7e4'};
    color:#111;
    padding:11px 16px;
    border-radius:10px;
    font-size:13px;
    font-family:var(--font-body);
    box-shadow:0 4px 16px rgba(0,0,0,0.10);
    animation:slideIn .2s ease;
    max-width:360px;
  `;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// "?"? fetchJSON helper "?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?"?
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ......................................................
// HOOK NAVIGATION
// ......................................................
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-page]').forEach(navItem => {
    navItem.addEventListener('click', () => {
      const page = navItem.dataset.page;
      if (page === 'training') {
        // Toujours initialiser Campus au clic (reconnexion session, rendu du plan)
        // même si preloadPlanState() a déjà chargé les données dans campusState
        setTimeout(initCampus, 100);
      }
      if (page === 'goals') {
        setTimeout(loadGoalsPage, 100);
      }
    });
  });

  // Si l'onglet Training est déjà actif au load
  if (document.getElementById('page-training')?.classList.contains('active')) {
    initCampus();
  }

  // Précharger le plan en arrière-plan dès le démarrage
  // → page Objectifs disponible sans passer par Entrainements
  setTimeout(() => preloadPlanState().catch(() => {}), 300);
});
