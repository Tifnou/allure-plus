// ============================================================
// free_sessions.js — Séances libres (hors plan d'entraînement)
// Propose chaque semaine 2 à 5 séances d'entretien (EF, fractionné, sortie
// longue - voir FREE_SESSIONS_COMPOSITION pour la repartition par
// frequence) quand aucun plan Campus/importé n'est actif. Ce n'est
// PAS un plan structuré (pas d'objectif/date de fin), mais les 23 séances
// de fractionné (QUALITE_POOL/QUALITE_TIERS) et les 12 sorties longues
// (LONGUE_POOL/LONGUE_TIERS) suivent une vraie progression cyclique par
// bloc de 4 semaines : semaines 1→3 montent en charge (léger→modéré→dur,
// cf. TIER_KEYS), semaine 4 = allégée (isLightFreeWeek). Le bloc suivant
// recommence au tier léger mais pioche une autre séance dans chaque tier
// (blockIdx), pour ne jamais reproposer deux fois la même séance à charge
// équivalente avant plusieurs mois.
// Depuis les routines v2 : catalogue routine_catalog.js + moteur routine_engine.js
// (chargés avant ce fichier), semaines figées dans `suivi_free_routine`.
// Dépend de campus.js (campusState, ALLURE_PLUS_ZONES, renderSessionList,
// showTrainingEmpty, isTrailSession...) et app.js (el, showToast,
// showConfirmModal, formatDate...).
// ============================================================

const FREE_SESSIONS_KEY = 'suivi_free_sessions';

function getFreeSessionsPrefs() {
  try { return JSON.parse(localStorage.getItem(FREE_SESSIONS_KEY) || 'null'); } catch (e) { return null; }
}
function saveFreeSessionsPrefs(prefs) {
  localStorage.setItem(FREE_SESSIONS_KEY, JSON.stringify(prefs));
}

// ─── Semaines / rotation ────────────────────────────────────────────────
// Lundi 00:00 local de la semaine contenant `ts`.
function mondayOfWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay(); // 0=dimanche
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff).getTime();
}
function freeSessionsWeekNumber(prefs, now = Date.now()) {
  const weeks = Math.round((mondayOfWeek(now) - prefs.anchorMonday) / (7 * 86400000));
  return weeks + 1; // 1-based
}
// Une semaine "légère" toutes les 4 semaines (sortie longue + fractionné
// réduits) pour laisser l'organisme souffler entre deux blocs d'entretien.
function isLightFreeWeek(weekNum) { return weekNum % 4 === 0; }

// ─── Construction des séances (format compatible Campus/campus.js) ─────
// Un "step" = {kind, duration (sec), slug} ; slug suit SLUG_TO_ZONE
// (campus.js) pour resoudre la bonne zone ALLURE_PLUS_ZONES via le meme
// pipeline que les vraies seances Campus (annotatePaceZones) - aucune
// duplication de la logique d'allure.
function stepsToSession(steps) {
  return {
    paceZones: steps.map(s => ({ kind: s.kind, duration: s.duration, pace: s.slug ? { slug: s.slug, value: null } : null })),
    exercisesBlocks: [{ repeat: 1, exercises: steps.map(s => ({ pace: s.slug ? { slug: s.slug } : null })) }],
  };
}

function buildIntervalSteps(workSec, workSlug, workKind, restSec, reps) {
  const steps = [];
  for (let i = 0; i < reps; i++) {
    steps.push({ kind: workKind, duration: workSec, slug: workSlug });
    if (i < reps - 1) steps.push({ kind: 'RECOVER', duration: restSec, slug: 'slow' });
  }
  return steps;
}
// 2 (ou N) blocs de reps identiques separes par une recuperation longue
// inter-bloc (ex: "2 x 8 x (30" effort/30" récup), r = 3' inter-bloc").
function buildDoubleBlockSteps(workSec, workSlug, workKind, restSec, repsPerBlock, blocks, interBlockRestSec) {
  const steps = [];
  for (let b = 0; b < blocks; b++) {
    steps.push(...buildIntervalSteps(workSec, workSlug, workKind, restSec, repsPerBlock));
    if (b < blocks - 1) steps.push({ kind: 'RECOVER', duration: interBlockRestSec, slug: 'slow' });
  }
  return steps;
}
// Pyramide simple (meme slug/kind sur tous les paliers) : durationsSec et
// restsSec (un de moins que durationsSec) definissent la montee/descente.
function buildPyramidSteps(durationsSec, slug, kind, restsSec) {
  const steps = [];
  durationsSec.forEach((d, i) => {
    steps.push({ kind, duration: d, slug });
    if (i < durationsSec.length - 1) steps.push({ kind: 'RECOVER', duration: restsSec[i], slug: 'slow' });
  });
  return steps;
}
function efBlock(min) { return { kind: 'Z2', duration: min * 60, slug: 'ef' }; }
function zoneBlock(min, slug, kind) { return { kind, duration: min * 60, slug }; }
function restBlock(sec) { return { kind: 'RECOVER', duration: sec, slug: 'slow' }; }

const NOT_A_PLAN_ADVICE = "Ce n'est pas un plan structuré : ce sont des séances d'entretien pour continuer à progresser entre deux plans. Gardez de la qualité dans l'exécution plutôt que de chercher la performance à tout prix — l'objectif est de maintenir la caisse, pas de vous épuiser.";

// EF : duree tournante 40-50 min pour eviter de toujours proposer la meme.
const EF_DURATIONS_MIN = [40, 45, 50, 45];
function buildEfSession(idx, terrain, rotationOffset) {
  const durMin = EF_DURATIONS_MIN[rotationOffset % EF_DURATIONS_MIN.length];
  const { paceZones, exercisesBlocks } = stepsToSession([{ kind: 'Z2', duration: durMin * 60, slug: 'ef' }]);
  return {
    displayName: `EF ${durMin} min`,
    name: `EF ${durMin} min`,
    trainingCategory: terrain === 'trail' ? 'trail_basic_endurance' : 'road_basic_endurance',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: `Sortie en endurance fondamentale de ${durMin} minutes, à allure confortable (vous devez pouvoir parler sans être essoufflé). Séance de base pour construire du volume sans fatigue excessive.`,
    stats: { expectedDuration: durMin * 60, expectedElevationGain: terrain === 'trail' ? 150 : 0 },
  };
}

// Sorties longues : pool de 12 variantes (5 EF continues + 7 "actives" avec
// blocs a allure soutenue) — warmup/cooldown "Inclus" dans la CSV source
// (pas de segment separe, tout est dans le bloc continu). En semaine legere,
// restreint aux deux sorties EF les plus courtes (50/60 min, pas de bloc actif).
const LONGUE_POOL = [
  { key: 'SL_EASY_01', label: 'SL 50\' EF', build: () => [efBlock(50)],
    desc: 'Sortie continue de 50 minutes à allure EF. Entretien de la base aérobie et récupération active.' },
  { key: 'SL_EASY_02', label: 'SL 1h00 EF', build: () => [efBlock(60)],
    desc: 'Sortie continue d\'1 heure à allure EF. Développement de l\'endurance fondamentale de base.' },
  { key: 'SL_EASY_03', label: 'SL 1h15 EF', build: () => [efBlock(75)],
    desc: 'Sortie continue d\'1h15 à allure EF. Volume d\'endurance aérobie.' },
  { key: 'SL_EASY_04', label: 'SL 1h30 EF', build: () => [efBlock(90)],
    desc: 'Sortie continue d\'1h30 à allure EF. Maintien de la capacité d\'endurance longue.' },
  { key: 'SL_EASY_05', label: 'SL 1h10 Progressive', build: () => [efBlock(40), zoneBlock(20, 'marathon', 'Z3'), efBlock(10)],
    desc: '40 minutes EF puis 20 minutes à allure modérée puis retour à 10 minutes EF. Dynamisation de la fin de sortie longue.' },
  { key: 'SL_ACT_01', label: 'SL 1h10 Active (3x8\')', build: () => [efBlock(30), ...buildIntervalSteps(8 * 60, 'half-marathon', 'Z4', 2 * 60, 3), efBlock(12)],
    desc: '30 minutes EF, puis 3 x (8 minutes à allure modérée / 2 minutes de récupération), puis 12 minutes EF. Maintien du rythme sur fond d\'endurance.' },
  { key: 'SL_ACT_02', label: 'SL 1h15 Active (3x6\')', build: () => [efBlock(35), ...buildIntervalSteps(6 * 60, 'seuil60', 'Z4', 2 * 60, 3), efBlock(16)],
    desc: '35 minutes EF, puis 3 x (6 minutes à allure vive / 2 minutes de récupération), puis 16 minutes EF. Stimulation cardio sur sortie moyenne.' },
  { key: 'SL_ACT_03', label: 'SL 1h15 Active (30\' continu)', build: () => [efBlock(25), zoneBlock(30, 'marathon', 'Z3'), efBlock(20)],
    desc: '25 minutes EF, 30 minutes à allure modérée en continu, puis 20 minutes EF. Travail du tempo en continu.' },
  { key: 'SL_ACT_04', label: 'SL 1h30 Active (2x15\')', build: () => [efBlock(30), ...buildIntervalSteps(15 * 60, 'half-marathon', 'Z4', 3 * 60, 2), efBlock(27)],
    desc: '30 minutes EF, puis 2 x (15 minutes à allure modérée / 3 minutes de récupération), puis 27 minutes EF. Endurance active et résistance à la fatigue.' },
  { key: 'SL_ACT_05', label: 'SL 1h30 Active (Combo 15\'/10\')', build: () => [efBlock(30), zoneBlock(15, 'sweet-spot', 'Z4'), restBlock(3 * 60), zoneBlock(10, 'seuil60', 'Z4'), restBlock(2 * 60), efBlock(30)],
    desc: '30 minutes EF, 15 minutes à 80% VMA, 10 minutes à 85% VMA, puis 30 minutes EF. Variation d\'allures sur sortie longue.' },
  { key: 'SL_ACT_06', label: 'SL 1h30 Active (2x25\')', build: () => [efBlock(20), ...buildIntervalSteps(25 * 60, 'marathon', 'Z3', 5 * 60, 2), efBlock(15)],
    desc: '20 minutes EF, puis 2 x (25 minutes à allure modérée / 5 minutes de récupération), puis 15 minutes EF. Volume à allure utile sans fatigue excessive.' },
  { key: 'SL_ACT_07', label: 'SL 1h30 Active Pyramide', build: () => [efBlock(25), zoneBlock(15, 'marathon', 'Z3'), zoneBlock(10, 'sweet-spot', 'Z4'), zoneBlock(5, 'seuil60', 'Z4'), efBlock(29)],
    desc: '25 minutes EF puis montée progressive en intensité (15\'/10\'/5\') avant de refermer sur 29 minutes EF. Progression d\'intensité sur sortie longue.' },
];
const LIGHT_LONGUE_POOL = LONGUE_POOL.slice(0, 2); // SL_EASY_01/02 : 50 et 60 min EF pur

// Tiers de charge (léger → modéré → dur) pour les 3 semaines "chargées" de
// chaque bloc de 4 semaines (la 4e reste la semaine allégée ci-dessus).
// Classement obtenu par un score de charge = somme(minutes × %VMA moyen de
// la zone) sur le corps de séance de chaque variante — calculé une fois
// hors-ligne (script d'analyse), pas recalculé à l'exécution. Permet une
// vraie progression semaine 1→3 plutôt qu'un simple défilement par
// catégorie CSV (cf. discussion du 12/08/2026).
const LONGUE_TIER_KEYS = [
  ['SL_EASY_01', 'SL_EASY_02', 'SL_EASY_05', 'SL_EASY_03'],
  ['SL_ACT_01', 'SL_ACT_02', 'SL_ACT_03', 'SL_EASY_04'],
  ['SL_ACT_07', 'SL_ACT_05', 'SL_ACT_04', 'SL_ACT_06'],
];
const LONGUE_TIERS = LONGUE_TIER_KEYS.map(keys => keys.map(k => LONGUE_POOL.find(v => v.key === k)));

function buildSlSession(idx, terrain, blockPos, blockIdx, light) {
  const pool = light ? LIGHT_LONGUE_POOL : LONGUE_TIERS[blockPos];
  const variant = pool[blockIdx % pool.length];
  const steps = variant.build();
  const totalSec = steps.reduce((s, x) => s + x.duration, 0);
  const { paceZones, exercisesBlocks } = stepsToSession(steps);
  return {
    displayName: `${variant.label}${light ? ' (allégée)' : ''}`,
    name: variant.label,
    trainingCategory: terrain === 'trail' ? 'trail_long_run' : 'road_long_run',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: light ? `${variant.desc} Semaine allégée : on garde une sortie courte et sans intensité pour souffler avant de repartir sur un rythme plus soutenu.` : variant.desc,
    stats: { expectedDuration: totalSec, expectedElevationGain: terrain === 'trail' ? 300 : 0 },
  };
}

// Fractionné : pool de 23 variantes (courts VMA, moyens VMA, seuil/allure
// longue, pyramidales, fartlek) qui tournent d'une semaine sur l'autre —
// il faut 23 semaines pour retomber sur la même, contre 4 auparavant.
// Warmup/cooldown fixes 15'/10' EF (identiques sur toute la catégorie).
// En semaine légère, restreint aux 6 variantes "Fractionnés Courts"
// (35-44 min, les plus courtes du pool) plutot que de réduire les reps
// d'une variante quelconque - plus simple et deja assez léger en soi.
const QUALITE_POOL = [
  { key: 'VMA_SHORT_01', label: '30"/30" Classique', build: () => buildIntervalSteps(30, 'vma', 'Z5', 30, 10),
    desc: '10 répétitions de 30 secondes à 105% VMA / 30 secondes de récupération. Développement VMA et travail de foulée.' },
  { key: 'VMA_SHORT_02', label: '30"/30" Double Bloc', build: () => buildDoubleBlockSteps(30, 'vma', 'Z5', 30, 8, 2, 180),
    desc: '2 blocs de 8 répétitions de 30 secondes à 105% VMA / 30 secondes de récupération, 3 minutes de récupération entre les blocs. Volume VMA courte et capacité cardiovasculaire.' },
  { key: 'VMA_SHORT_03', label: '45"/30"', build: () => buildIntervalSteps(45, 'vma', 'Z5', 30, 10),
    desc: '10 répétitions de 45 secondes à 100% VMA / 30 secondes de récupération. Soutien du temps de maintien à VMA.' },
  { key: 'VMA_SHORT_04', label: "1'/1' Double Bloc", build: () => buildDoubleBlockSteps(60, 'vma', 'Z5', 60, 6, 2, 180),
    desc: '2 blocs de 6 répétitions d\'1 minute à 100% VMA / 1 minute de récupération, 3 minutes entre les blocs. Puissance aérobie et tolérance à l\'effort court.' },
  { key: 'VMA_SHORT_05', label: 'Tabata Running (20"/10")', build: () => buildDoubleBlockSteps(20, 'vma', 'Z5', 10, 8, 2, 240),
    desc: '2 blocs de 8 répétitions de 20 secondes sprint / 10 secondes marche, 4 minutes entre les blocs. Dynamicité, puissance et filière anaérobie.' },
  { key: 'VMA_SHORT_06', label: 'Dégressif Court',
    build: () => {
      const durs = [40, 30, 20];
      const steps = [];
      for (let s = 0; s < 3; s++) {
        durs.forEach((d, i) => {
          steps.push({ kind: 'Z5', duration: d, slug: 'vma' });
          if (i < durs.length - 1) steps.push({ kind: 'RECOVER', duration: d, slug: 'slow' });
        });
        if (s < 2) steps.push({ kind: 'RECOVER', duration: 180, slug: 'slow' });
      }
      return steps;
    },
    desc: '3 séries de 40"-30"-20" à 105% VMA (récupération = temps d\'effort), 3 minutes entre les séries. Variabilité d\'effort court et vitesse.' },
  { key: 'VMA_MID_01', label: "2'/1' Classique", build: () => buildIntervalSteps(120, 'vma', 'Z5', 60, 6),
    desc: '6 répétitions de 2 minutes à 95-100% VMA / 1 minute de récupération. Soutien VMA et capacité aérobie.' },
  { key: 'VMA_MID_02', label: "3'/1'30\"", build: () => buildIntervalSteps(180, 'vma', 'Z5', 90, 5),
    desc: '5 répétitions de 3 minutes à 95% VMA / 1min30 de récupération. Maintien du VO2max et travail au seuil haut.' },
  { key: 'VMA_MID_03', label: "4'/2' Soutien VMA", build: () => buildIntervalSteps(240, 'vma', 'Z5', 120, 4),
    desc: '4 répétitions de 4 minutes à 95% VMA / 2 minutes de récupération. Endurance de force VMA.' },
  { key: 'VMA_MID_04', label: "5'/2' Allure Soutenue", build: () => buildIntervalSteps(300, 'seuil30', 'Z4', 120, 3),
    desc: '3 répétitions de 5 minutes à 90-95% VMA / 2 minutes de récupération. Développement du volume à haute intensité.' },
  { key: 'VMA_MID_05', label: "3'-2'-1' (3 séries)",
    build: () => {
      const ladder = () => [
        { kind: 'Z4', duration: 180, slug: 'seuil30' },
        { kind: 'RECOVER', duration: 90, slug: 'slow' },
        { kind: 'Z5', duration: 120, slug: 'vma' },
        { kind: 'RECOVER', duration: 60, slug: 'slow' },
        { kind: 'Z5', duration: 60, slug: 'vma' },
      ];
      const steps = [];
      for (let s = 0; s < 3; s++) {
        steps.push(...ladder());
        if (s < 2) steps.push({ kind: 'RECOVER', duration: 180, slug: 'slow' });
      }
      return steps;
    },
    desc: '3 séries de 3\'-2\'-1\' (90% puis 95% puis 100% VMA), 3 minutes entre les séries. Changements de rythme et gestion d\'effort.' },
  { key: 'AS_LONG_01', label: "Seuil Court (4x5')", build: () => buildIntervalSteps(300, 'seuil60', 'Z4', 90, 4),
    desc: '4 répétitions de 5 minutes au seuil anaérobie (85-90% VMA) / 1min30 de récupération active. Recul du seuil lactique et maintien en forme.' },
  { key: 'AS_LONG_02', label: "Seuil Long (3x8')", build: () => buildIntervalSteps(480, 'seuil60', 'Z4', 120, 3),
    desc: '3 répétitions de 8 minutes au seuil (85-90% VMA) / 2 minutes de récupération active. Endurance critique et tolérance à l\'effort continu.' },
  { key: 'AS_LONG_03', label: "Allure Modérée (3x10')", build: () => buildIntervalSteps(600, 'half-marathon', 'Z4', 150, 3),
    desc: '3 répétitions de 10 minutes à allure dynamique (80-85% VMA) / 2min30 de récupération active. Rendement aérobie et mémorisation d\'allure.' },
  { key: 'AS_LONG_04', label: "Allure Modérée Longue (2x15')", build: () => buildIntervalSteps(900, 'half-marathon', 'Z4', 180, 2),
    desc: '2 répétitions de 15 minutes à allure modérée (80-85% VMA) / 3 minutes de récupération active. Efficacité énergétique et tenue du rythme.' },
  { key: 'AS_LONG_05', label: 'Mixte Seuil / Allure Vive',
    build: () => [zoneBlock(10, 'seuil60', 'Z4'), restBlock(180), ...buildIntervalSteps(360, '10km', 'Z4', 120, 2)],
    desc: '10 minutes au seuil (85% VMA) puis 3 minutes de récupération puis 2 x (6 minutes à allure vive à 90% VMA / 2 minutes de récupération). Adaptation aux variations de fatigue.' },
  { key: 'PYR_01', label: 'Pyramide Courte VMA', build: () => buildPyramidSteps([60, 120, 180, 120, 60], 'vma', 'Z5', [30, 60, 90, 60]),
    desc: 'Pyramide 1\'-2\'-3\'-2\'-1\' à 95-100% VMA (récupération = 50% du temps d\'effort). Casser la routine et travailler différentes durées d\'effort.' },
  { key: 'PYR_02', label: 'Pyramide Moyenne Seuil', build: () => buildPyramidSteps([120, 240, 360, 240, 120], 'seuil60', 'Z4', [90, 90, 90, 90]),
    desc: 'Pyramide 2\'-4\'-6\'-4\'-2\' au seuil (85-90% VMA), 1 à 2 minutes de récupération entre paliers. Gestion de la montée et redescente d\'effort.' },
  { key: 'PYR_03', label: 'Pyramide Longue Aérobie',
    build: () => [zoneBlock(5, 'sweet-spot', 'Z4'), restBlock(120), zoneBlock(10, 'seuil60', 'Z4'), restBlock(120), zoneBlock(5, '10km', 'Z4')],
    desc: '5 minutes à 80% VMA puis 10 minutes à 85% VMA puis 5 minutes à 90% VMA, 2 minutes de récupération entre paliers. Progression en intensité au fil de la séance.' },
  { key: 'FART_01', label: 'Over-Under Seuil',
    build: () => { const s = []; for (let i = 0; i < 10; i++) { s.push({ kind: 'Z4', duration: 120, slug: 'seuil60' }, { kind: 'Z3', duration: 60, slug: 'marathon' }); } return s; },
    desc: '30 minutes continues en alternant 2 minutes à allure vive (85-90% VMA) et 1 minute à allure modérée (75-80% VMA). Clairance du lactate en effort continu.' },
  { key: 'FART_02', label: 'Australienne Continu (30/30)',
    build: () => { const s = []; for (let i = 0; i < 15; i++) { s.push({ kind: 'Z5', duration: 30, slug: 'vma' }, { kind: 'Z3', duration: 30, slug: 'aerobie' }); } return s; },
    desc: '15 minutes continues de 30 secondes à 100% VMA / 30 secondes à 75% VMA, sans interruption de course. Travail cardiovasculaire sans interruption.' },
  { key: 'FART_03', label: 'Pyramide Nature Fartlek',
    build: () => {
      const durs = [60, 120, 180, 240, 180, 120, 60];
      const s = [];
      durs.forEach((d, i) => { s.push({ kind: 'Z4', duration: d, slug: '10km' }); if (i < durs.length - 1) s.push({ kind: 'Z2', duration: d, slug: 'ef' }); });
      return s;
    },
    desc: 'Pyramide 1\'-2\'-3\'-4\'-3\'-2\'-1\' proche de 90% VMA, récupération à allure EF de même durée que l\'effort précédent. Séance ludique aux sensations.' },
  { key: 'FART_04', label: 'Accélérations Progressives', build: () => buildIntervalSteps(45, 'vma', 'Z5', 75, 8),
    desc: '8 répétitions de 45 secondes en accélération progressive (jusqu\'à 100% VMA) / 1min15 de marche ou trot. Travail de la vitesse maximale et de la posture.' },
];
const LIGHT_QUALITE_POOL = QUALITE_POOL.slice(0, 6); // les 6 "Fractionnés Courts" (35-44 min)

// Tiers de charge (léger → modéré → dur), même principe que LONGUE_TIERS
// ci-dessus (score = minutes × %VMA moyen sur le corps de séance, hors
// warmup/cooldown fixes puisqu'ils sont identiques pour toutes les variantes).
const QUALITE_TIER_KEYS = [
  ['VMA_SHORT_01', 'VMA_SHORT_05', 'VMA_SHORT_06', 'VMA_SHORT_03', 'FART_04', 'PYR_01', 'FART_02', 'VMA_SHORT_02'],
  ['VMA_MID_01', 'VMA_MID_04', 'VMA_MID_02', 'PYR_02', 'PYR_03', 'VMA_MID_03', 'VMA_SHORT_04', 'AS_LONG_01'],
  ['AS_LONG_05', 'AS_LONG_02', 'FART_03', 'FART_01', 'VMA_MID_05', 'AS_LONG_04', 'AS_LONG_03'],
];
const QUALITE_TIERS = QUALITE_TIER_KEYS.map(keys => keys.map(k => QUALITE_POOL.find(v => v.key === k)));

// blockPos (0/1/2) = position dans les 3 semaines chargées du bloc de 4
// semaines courant → choisit le tier (charge croissante S1→S3, cf.
// buildFreeSessionsWeekData). blockIdx = numéro du bloc de 4 semaines
// écoulé → fait varier la séance choisie *dans* le tier d'un bloc à
// l'autre, pour ne pas reproposer toujours la même à charge égale.
// poolOffset : decale le choix dans le pool par rapport a blockIdx - permet
// a une 2e seance fractionnee de la meme semaine (frequence 5) de piocher
// une variante differente de la 1ere sans jamais les faire coincider, tout
// en gardant chacune sa propre rotation independante bloc apres bloc.
function buildFractionneSession(idx, terrain, blockPos, blockIdx, light, poolOffset = 0) {
  const pool = light ? LIGHT_QUALITE_POOL : QUALITE_TIERS[blockPos];
  const variant = pool[(blockIdx + poolOffset) % pool.length];
  const steps = [
    { kind: 'WARMUP', duration: 900, slug: 'ef' },
    ...variant.build(),
    { kind: 'COOLDOWN', duration: 600, slug: 'ef' },
  ];
  const totalSec = steps.reduce((s, x) => s + x.duration, 0);
  const { paceZones, exercisesBlocks } = stepsToSession(steps);
  return {
    displayName: variant.label,
    name: variant.label,
    trainingCategory: terrain === 'trail' ? 'trail_intensity' : 'road_intensity',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: variant.desc,
    coachAdvice: NOT_A_PLAN_ADVICE,
    stats: { expectedDuration: totalSec, expectedElevationGain: terrain === 'trail' ? 100 : 0 },
  };
}

// ─── Génération d'une semaine donnée ────────────────────────────────────
// Composition par fréquence choisie - la sortie longue est toujours
// présente et vient toujours en dernier (repère fixe de la semaine), EF et
// fractionné s'alternent avant elle pour une progression "logique"
// (dur/facile) plutôt qu'un bloc de fractionnés d'affilée :
//   2x/sem = 1 EF + 1 SL (pas de fractionné, la SL porte elle-même des
//            variantes "actives" avec exercices ou "EF pure" sans, cf.
//            LONGUE_POOL)
//   3x/sem = 1 EF + 1 fractionné + 1 SL (comportement historique, inchangé)
//   4x/sem = 2 EF + 1 fractionné + 1 SL (comportement historique, inchangé)
//   5x/sem = 2 EF + 2 fractionnés + 1 SL
const FREE_SESSIONS_COMPOSITION = {
  2: { ef: 1, fractionne: 0 },
  3: { ef: 1, fractionne: 1 },
  4: { ef: 2, fractionne: 1 },
  5: { ef: 2, fractionne: 2 },
};

// blockPos (0/1/2/3) = position dans le bloc de 4 semaines courant : 0→1→2
// = montée en charge (léger→modéré→dur), 3 = semaine allégée (isLightFreeWeek
// tombe exactement sur blockPos===3 puisque les deux utilisent % 4 sur la
// même base). blockIdx = index du bloc (0 pour S1-4, 1 pour S5-8...) : fait
// tourner la séance choisie dans chaque tier d'un bloc à l'autre.
function buildFreeSessionsWeekData(prefs, weekNum) {
  const light = isLightFreeWeek(weekNum);
  const blockPos = (weekNum - 1) % 4;
  const blockIdx = Math.floor((weekNum - 1) / 4);
  const terrain = prefs.terrain;
  const comp = FREE_SESSIONS_COMPOSITION[prefs.frequency] || FREE_SESSIONS_COMPOSITION[3];
  const sessions = [];
  let idx = 0;
  const rounds = Math.max(comp.ef, comp.fractionne);
  for (let i = 0; i < rounds; i++) {
    if (i < comp.ef) sessions.push(buildEfSession(idx++, terrain, weekNum - 1 + i));
    if (i < comp.fractionne) sessions.push(buildFractionneSession(idx++, terrain, blockPos, blockIdx, light, i));
  }
  sessions.push(buildSlSession(idx++, terrain, blockPos, blockIdx, light));
  return { weekNum, light, tier: light ? null : blockPos, sessions };
}

// Conservée pour compat (tests) : une seule semaine, calculée depuis `now`.
function generateFreeSessionsWeek(prefs, now = Date.now()) {
  return buildFreeSessionsWeekData(prefs, freeSessionsWeekNumber(prefs, now));
}

// ─── Routines v2 : semaines figées ──────────────────────────────────────
// Depuis les routines "hors plan" (routine_catalog.js / routine_engine.js),
// une semaine n'est générée qu'UNE FOIS, au moment où on l'ouvre, puis
// conservée telle quelle dans `suivi_free_routine` (clé durable, donc
// synchronisée/restaurée comme le reste) : le moteur tient compte de
// l'historique et de la forme du moment, régénérer une semaine passée la
// changerait sous les pieds de l'utilisateur. Les semaines AVANT
// `prefs.engineStartWeek` (utilisateurs existants) restent celles de
// l'ancien moteur (buildFreeSessionsWeekData ci-dessus) pour que les séances
// déjà pointées "faites" gardent leur sens. Clé de stockage = lundi (ms), le
// même `weekDate` que l'identifiant de semaine (`free_<weekDate>`) : les
// pointages "fait" retombent donc sur les bonnes séances.
const ROUTINE_STORE_KEY = 'suivi_free_routine';
const ROUTINE_STORE_KEEP_WEEKS = 40;
const FREE_SESSIONS_MIN_WEEKS = 16;
const FREE_SESSIONS_LOOKAHEAD = 8;

const ROUTINE_PHASE_LABEL = { S1: 'souple', S2: 'modérée', S3: 'intense', S4: 'récupération' };
const ROUTINE_PHASE_DOT = { S1: '🟢', S2: '🟡', S3: '🔴', S4: '\u{1FAB6}' };
// ancien moteur
const TIER_DOT = ['🟢', '🟡', '🔴'];
const TIER_LABEL = ['légère', 'modérée', 'élevée'];

function getRoutineStore() {
  try {
    const s = JSON.parse(localStorage.getItem(ROUTINE_STORE_KEY) || 'null');
    if (s && s.v === 2 && s.weeks) return s;
  } catch (e) { /* stockage illisible : on repart d'un magasin vide */ }
  return { v: 2, weeks: {} };
}
function saveRoutineStore(store) {
  const keys = Object.keys(store.weeks).map(Number).sort((a, b) => b - a);
  keys.slice(ROUTINE_STORE_KEEP_WEEKS).forEach(k => { delete store.weeks[k]; });
  localStorage.setItem(ROUTINE_STORE_KEY, JSON.stringify(store));
}

function freeWeekDate(prefs, weekNum) { return prefs.anchorMonday + (weekNum - 1) * 7 * 86400000; }
function routineEngineStart(prefs) { return prefs.engineStartWeek || 1; }

// Migration douce : un utilisateur existant (sans `engine`) garde l'ancien
// moteur jusqu'à la fin de la semaine en cours, le nouveau prend le relais
// dès la semaine suivante.
function migrateFreeSessionsPrefs(prefs) {
  if (!prefs || prefs.engine === 'v2') return prefs;
  const next = { ...prefs, engine: 'v2', maxMin: prefs.maxMin || 90, engineStartWeek: freeSessionsWeekNumber(prefs) + 1 };
  saveFreeSessionsPrefs(next);
  return next;
}

let _routineActsFallback = null;
async function routineActivities() {
  if (typeof _allActivities !== 'undefined' && _allActivities.length) return _allActivities;
  if (_routineActsFallback) return _routineActsFallback;
  try {
    const res = await fetch(`${API}/api/dashboard`);
    if (res.ok) { const d = await res.json(); _routineActsFallback = d.allActivities || d.lastRuns || []; }
  } catch (e) { /* hors-ligne : profil par défaut */ }
  return _routineActsFallback || [];
}

// Réglages du moteur posés par l'admin (page Admin > Routines hors plan).
let _routineCfgCache = null;
async function routineServerConfig(force) {
  if (_routineCfgCache && !force) return _routineCfgCache;
  try {
    const res = await fetch(`${API}/api/routine-config`);
    if (res.ok) _routineCfgCache = await res.json();
  } catch (e) { /* hors-ligne : réglages par défaut */ }
  return _routineCfgCache || { trailRoadFamilies: false };
}

// ─── Plan Allure+ à venir / course envisagée ───────────────────────────
// Un plan chargé depuis le catalogue a une date de début (lundi, calée sur la
// date de course) et s'affiche aussitôt, même si ses semaines sont dans le
// futur. Tant que ce début n'est pas arrivé, la routine "hors plan" prend la
// main ; à la date de début le plan reprend (renderTrainingPlan, campus.js),
// la routine cesse de générer et son historique est conservé.
const ROUTINE_HORIZON_LABEL = { long: 'Fondamentaux', intermediate: 'Orientation vers le plan', close: 'Stabilisation', final: 'Transition' };

function routineWeeksBetween(fromMs, toMs) { return Math.round((toMs - fromMs) / (7 * 86400000)); }
function routineDateFr(ms) { return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }

// Résumé d'un plan pour le moteur : début, charge d'entrée, sorties longues, cible
function routinePlanInfoFrom(goal, weeks) {
  if (!goal || !Array.isArray(weeks) || !weeks.length) return null;
  const sorted = [...weeks].sort((a, b) => (a.weekDate || 0) - (b.weekDate || 0));
  if (!sorted[0].weekDate) return null;
  const isRun = s => !(s.sport === 'ppg' || s.trainingCategory === 'gpp');
  const mins = s => ((s.stats && s.stats.expectedDuration) || (s.paceZones || []).reduce((a, z) => a + (z.duration || 0), 0)) / 60;
  const runs = w => (w.sessions || []).filter(isRun);
  const cat = goal.planCategory || {};
  const trail = /trail/i.test((cat.sportLabel || '') + ' ' + (goal.goalType || ''));
  const dist = String(cat.distLabel || goal.goalType || '');
  const targetKey = trail ? 'trail'
    : /semi|20|21/i.test(dist) ? 'semi'
      : /marathon|42/i.test(dist) ? 'marathon'
        : /10/.test(dist) ? '10k' : /5/.test(dist) ? '5k' : null;
  const counts = sorted.slice(0, 4).map(w => runs(w).length).filter(n => n > 0);
  const perWeek = goal.sessionsPerWeek || (counts.length ? counts.sort((a, b) => a - b)[counts.length >> 1] : null);
  return {
    name: goal.name || goal.goalTitle || 'ton plan',
    startMs: mondayOfWeek(sorted[0].weekDate),
    totalWeeks: sorted.length,
    week1Min: Math.round(runs(sorted[0]).reduce((a, s) => a + mins(s), 0)),
    longestMin: Math.round(Math.max(0, ...sorted.slice(0, 4).flatMap(w => runs(w).map(mins)))),
    sessionsPerWeek: perWeek,
    isTrail: trail,
    targetKey,
  };
}

// Plan dont le début est encore à venir (sinon le plan s'affiche normalement)
function routineCurrentPlanInfo() {
  const snap = campusState.planSnapshot;
  if (!snap) return null;
  const info = routinePlanInfoFrom(snap.goal, snap.weeks);
  return info && info.startMs > mondayOfWeek(Date.now()) ? info : null;
}

// campus.js renderTrainingPlan : la routine précède-t-elle ce plan ?
function routineShouldPrecedePlan(goal, weeks) {
  const fp = getFreeSessionsPrefs();
  if (!fp || fp.dormant) return false;
  const info = routinePlanInfoFrom(goal, weeks);
  return !!(info && info.startMs > mondayOfWeek(Date.now()));
}

// Date de début du plan modifiée / plan retiré / course changée : les semaines
// en cours ou à venir déjà figées sous l'ancienne échéance sont régénérées
// (sauf si une séance y a déjà été pointée) pour recaler le cycle.
// Empreinte des réglages utilisés pour générer une semaine
function routinePrefsSig(prefs) { return [prefs.terrain, prefs.frequency, prefs.maxMin || 90, prefs.caution ? 1 : 0].join('|'); }

// Une semaine "intacte" n'a ni séance pointée (faite / passée) ni variante choisie
function routineWeekIsUntouched(wd, w) {
  return w.sessions.every((s, i) => {
    const st = typeof getLocalSessionStatus === 'function' ? getLocalSessionStatus('free_' + wd, i) : null;
    return !['done', 'skip'].includes(st) && (!s.variant || s.variant === 'yellow');
  });
}

function reconcileRoutineWithPlan(prefs, planInfo) {
  const store = getRoutineStore();
  const sig = routinePrefsSig(prefs);
  const now = Date.now();
  const wantPlan = planInfo ? planInfo.startMs : null;
  const wantRace = prefs.race ? prefs.race.dateMs : null;
  let changed = false;
  Object.keys(store.weeks).forEach(k => {
    if (Number(k) + 7 * 86400000 < now) return;                      // semaine passée : intacte
    const w = store.weeks[k];
    // obsolète si l'échéance (plan / course) OU les réglages (terrain, séances/semaine,
    // durée max, gêne) ont changé depuis sa génération — sans signature mémorisée
    // (ancienne semaine), on juge au nombre de séances
    const stale = (w.planStartMs || null) !== wantPlan || (w.raceMs || null) !== wantRace
      || (w.sig ? w.sig !== sig : w.sessions.length !== prefs.frequency);
    if (!stale) return;
    if (!routineWeekIsUntouched(k, w)) return;
    delete store.weeks[k];
    changed = true;
  });
  if (changed) saveRoutineStore(store);
}

// opts.preview : semaine à venir montrée en AVANT-PREMIÈRE (cycle complet visible).
// Elle est reconstruite d'après la forme du moment dès qu'elle devient la semaine en
// cours, sauf si l'utilisateur y a déjà touché (variante choisie, séance pointée).
async function ensureRoutineWeek(prefs, weekNum, planInfo, opts) {
  const store = getRoutineStore();
  const wd = freeWeekDate(prefs, weekNum);
  const existing = store.weeks[wd];
  if (existing) {
    const rebuild = existing.preview && !(opts && opts.preview) && routineWeekIsUntouched(wd, existing);
    if (!rebuild) return existing;
    delete store.weeks[wd];
  }
  const acts = await routineActivities();
  const profile = RoutineEngine.routineAssessProfile(acts, Date.now(), prefs.maxMin || 90);
  const history = Object.keys(store.weeks).map(k => ({
    age: Math.round((wd - Number(k)) / (7 * 86400000)),
    sessions: store.weeks[k].sessions,
  })).filter(h => h.age >= 1 && h.age <= ROUTINE_STORE_KEEP_WEEKS);
  const cfg = await routineServerConfig();
  const prev = store.weeks[wd - 7 * 86400000];
  const prevExcess = prev ? RoutineEngine.routineWeekExcess(prev.sessions).excessPct : 0;
  // échéance : plan Allure+ à venir (prioritaire) ou simple course envisagée
  const weeksToStart = planInfo ? routineWeeksBetween(wd, planInfo.startMs) : null;
  const plan = planInfo && weeksToStart >= 1 ? { ...planInfo, weeksToStart } : null;
  const weeksToRace = !planInfo && prefs.race ? routineWeeksBetween(wd, prefs.race.dateMs) : null;
  const race = weeksToRace != null && weeksToRace >= 1 ? { name: prefs.race.name || null, weeksToRace, targetKey: prefs.race.distKey } : null;
  const week = RoutineEngine.routineGenerateWeek(prefs, weekNum, {
    ...profile, history, prevExcess,
    caution: !!prefs.caution,
    trailRoadFamilies: !!cfg.trailRoadFamilies,
    plan, race,
  });
  week.preview = !!(opts && opts.preview);
  week.sig = routinePrefsSig(prefs);
  week.planStartMs = planInfo ? planInfo.startMs : null;
  week.raceMs = prefs.race ? prefs.race.dateMs : null;
  week.profile = { level: profile.level, weeklyMin: profile.weeklyMin, runsPerWeek: profile.runsPerWeek, efTarget: profile.efTarget, slTarget: profile.slTarget, otherMin7: profile.otherMin7, hasData: profile.hasData };
  store.weeks[wd] = week;
  saveRoutineStore(store);
  return week;
}

// Fiche figée → séance au format Campus (affichage, pointage, export Garmin, analyse)
function routineSnapshotToSession(snap, idx) {
  const compiled = compileRoutineDsl(snap.dsl, { wuCd: snap.wuCd });
  const { paceZones, exercisesBlocks } = routineToSessionStructure(compiled);
  const trail = snap.terrain === 'trail';
  const cat = snap.role === 'ef' ? 'basic_endurance' : snap.role === 'long' ? 'long_run' : 'intensity';
  const session = {
    displayName: snap.name,
    name: snap.name,
    trainingCategory: (trail ? 'trail_' : 'road_') + cat,
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: RoutineEngine.routineDescribe(snap.dsl) + '.',
    stats: { expectedDuration: compiled.totalSec, expectedElevationGain: trail ? (snap.role === 'long' ? 300 : 100) : 0 },
    routine: { modelId: snap.modelId, slot: snap.slot, family: snap.family, tier: snap.tier, variant: snap.variant || 'yellow' },
  };
  if (snap.role === 'quality') session.coachAdvice = NOT_A_PLAN_ADVICE;
  return session;
}

// ─── Rendu ───────────────────────────────────────────────────────────────
// Ce n'est pas un plan avec une fin (routine reconduite indéfiniment) mais on
// affiche un horizon d'au moins 16 semaines pour pouvoir parcourir la
// rotation : les semaines déjà générées montrent leurs séances, les autres
// seulement leur phase (S1 souple … S4 récupération), générées à l'ouverture.
async function renderFreeSessionsWeek(forceIdx) {
  let prefs = getFreeSessionsPrefs();
  if (!prefs) return;
  prefs = migrateFreeSessionsPrefs(prefs);
  const start = routineEngineStart(prefs);
  const currentWeekNum = freeSessionsWeekNumber(prefs);
  const planInfo = routineCurrentPlanInfo();
  reconcileRoutineWithPlan(prefs, planInfo);
  if (currentWeekNum >= start) await ensureRoutineWeek(prefs, currentWeekNum, planInfo);
  // Un cycle complet visible : semaine en cours + 3 suivantes, en avant-première
  // (réajustées à la forme du moment quand chacune devient la semaine en cours).
  for (let k = 1; k <= 3; k++) {
    const wn = currentWeekNum + k;
    if (wn < start) continue;
    if (planInfo && routineWeeksBetween(freeWeekDate(prefs, wn), planInfo.startMs) < 1) break;
    await ensureRoutineWeek(prefs, wn, planInfo, { preview: true });
  }
  const store = getRoutineStore();
  const totalWeeks = Math.max(FREE_SESSIONS_MIN_WEEKS, currentWeekNum + FREE_SESSIONS_LOOKAHEAD);

  const weeks = [];
  for (let wn = 1; wn <= totalWeeks; wn++) {
    const weekDate = freeWeekDate(prefs, wn);
    const base = { _id: 'free_' + weekDate, weekDate, context: {} };
    if (wn < start) {
      const { light, tier, sessions } = buildFreeSessionsWeekData(prefs, wn);
      weeks.push({ ...base, sessions, legacy: true, light, tier, dot: light ? '\u{1FAB6}' : TIER_DOT[tier], tabTitle: light ? 'Semaine allégée' : `Charge ${TIER_LABEL[tier]} (${tier + 1}/3 du bloc)` });
      continue;
    }
    const { phase } = RoutineEngine.routinePhaseOf(wn);
    if (planInfo && routineWeeksBetween(weekDate, planInfo.startMs) <= 0) {
      // à partir du début du plan, c'est lui qui prend le relais : rien n'est généré
      weeks.push({ ...base, sessions: [], pending: true, planWeek: true, dot: '🏁', tabTitle: 'Début du plan — ses séances remplacent la routine',
        emptyMessage: `Ton plan « ${planInfo.name} » a démarré : ses séances remplacent la routine (le plan s'affiche ici dès le lundi ${routineDateFr(planInfo.startMs)}).` });
      continue;
    }
    const stored = store.weeks[weekDate];
    // phase affichée : celle figée dans la semaine (la dernière semaine avant un plan est
    // une transition allégée, S4 quel que soit son rang dans le cycle)
    const shownPhase = stored ? stored.phase : (planInfo && routineWeeksBetween(weekDate, planInfo.startMs) === 1 ? 'S4' : phase);
    const isTransition = !!(stored ? (stored.plan && stored.plan.transition) : (planInfo && routineWeeksBetween(weekDate, planInfo.startMs) === 1));
    const w = { ...base, phase: shownPhase, dot: ROUTINE_PHASE_DOT[shownPhase], tabTitle: isTransition ? 'Transition avant ton plan — charge allégée' : `${shownPhase} — ${ROUTINE_PHASE_LABEL[shownPhase]}`, light: shownPhase === 'S4' };
    if (stored) {
      w.sessions = stored.sessions.map((s, i) => routineSnapshotToSession(s, i));
      w.stored = stored;
      if (stored.preview) w.context = { cycleDescription: 'Séances proposées à titre indicatif : elles seront modifiées si besoin d’après ta forme, ton assiduité, ta charge récente et tes ressentis avant que cette semaine commence.' };
    } else {
      w.sessions = [];
      w.pending = true;
      w.emptyMessage = wn < currentWeekNum
        ? 'Semaine non générée (l’application n’a pas été ouverte cette semaine-là).'
        : wn <= currentWeekNum + 1
          ? 'Cliquez sur l’onglet pour générer cette semaine.'
          : `Semaine ${phase} (${ROUTINE_PHASE_LABEL[phase]}) : ses séances seront construites à l’approche, en fonction de ta forme du moment, de ton assiduité, de ta charge récente et de tes ressentis. Ce qui est déjà prévu pour cette semaine : une charge ${phase === 'S1' ? 'souple' : phase === 'S2' ? 'modérée' : phase === 'S3' ? 'intense' : 'de récupération'}.`;
    }
    weeks.push(w);
  }

  campusState.weeks = weeks;
  const currentIdx = Math.min(Math.max(currentWeekNum - 1, 0), weeks.length - 1);
  campusState.selectedWeekIdx = forceIdx != null ? forceIdx : currentIdx;
  campusState.openSessionIdx = -1;
  campusState.usingImportedPlan = true; // active "Marquer comme fait" (getLocalSessionStatus)
  campusState.campusConnected = false;
  campusState.goal = null; // pas d'objectif associé - évite un bloc "Allure objectif" perimé

  const cur = weeks[currentIdx];
  const terrainLabel = prefs.terrain === 'trail' ? 'Trail' : 'Route';
  el('campus-connect-card').style.display = 'none';
  el('campus-loading').style.display = 'none';
  el('campus-plan-wrap').style.display = '';
  el('campus-plan-subtitle').textContent = `Séances libres — ${terrainLabel} · ${prefs.frequency}x/semaine`;

  // Bandeau de phase de la semaine en cours + transparence sur ce que le
  // moteur a retenu (niveau, volume) et sur ses éventuelles précautions.
  let phaseHtml, badges;
  if (cur.legacy) {
    phaseHtml = cur.light ? ' <strong>Semaine allégée cette semaine</strong> (récupération).' : ` <strong>Semaine ${cur.tier + 1}/3</strong> du bloc — charge ${TIER_LABEL[cur.tier]}.`;
    badges = cur.light ? '<span class="plan-type-badge" style="background:#fef3c7;color:#b45309">Semaine légère</span>' : `<span class="plan-type-badge">${TIER_DOT[cur.tier]} Charge ${TIER_LABEL[cur.tier]}</span>`;
  } else {
    phaseHtml = ` <strong>${cur.phase} — semaine ${ROUTINE_PHASE_LABEL[cur.phase]}</strong> du cycle de 4 semaines.`;
    badges = `<span class="plan-type-badge">${cur.dot} ${cur.phase} · ${ROUTINE_PHASE_LABEL[cur.phase]}</span>`;
    const st = cur.stored;
    if (st) {
      const lv = ['', 'débutant', 'régulier', 'confirmé'][st.level] || '';
      if (st.profile && st.profile.hasData) phaseHtml += ` <span style="opacity:.8">Niveau retenu : ${lv} (≈ ${st.profile.weeklyMin} min de course par semaine sur 6 semaines).</span>`;
      else phaseHtml += ' <span style="opacity:.8">Pas encore assez d’activités récentes pour affiner : séances prudentes par défaut.</span>';
      (st.notes || []).concat(st.warnings || []).forEach(n => { phaseHtml += `<br><span style="opacity:.85">ℹ️ ${n}</span>`; });
    }
  }

  // Bandeau plan / course : explique pourquoi la routine s'adapte et jusqu'à quand
  let planBannerHtml = '';
  const curStored = cur.stored;
  if (planInfo) {
    const n = Math.max(1, routineWeeksBetween(freeWeekDate(prefs, currentWeekNum), planInfo.startMs));
    const hz = curStored && curStored.plan ? ROUTINE_HORIZON_LABEL[curStored.plan.horizon] : null;
    planBannerHtml = `<div class="rt-plan-banner">
      <div>🏁 Ton plan <strong>${planInfo.name}</strong> démarre le <strong>${routineDateFr(planInfo.startMs)}</strong> (dans ${n} semaine${n > 1 ? 's' : ''}).
      Ta routine t’accompagne jusqu’au démarrage de ton plan Allure+ ; tes prochaines semaines sont adaptées pour l’aborder en forme.${hz ? ` <span class="rt-plan-horizon">${hz}</span>` : ''}</div>
      <button type="button" class="btn-plan-action" onclick="routineShowPlan()">Voir le plan</button></div>`;
  } else if (prefs.race && prefs.race.dateMs > Date.now()) {
    const n = Math.max(1, routineWeeksBetween(freeWeekDate(prefs, currentWeekNum), prefs.race.dateMs));
    planBannerHtml = `<div class="rt-plan-banner"><div>🎯 Course envisagée${prefs.race.name ? ' : <strong>' + prefs.race.name + '</strong>' : ''} le <strong>${routineDateFr(prefs.race.dateMs)}</strong> (dans ${n} semaine${n > 1 ? 's' : ''}).
      Cette routine entretient ta base sans préparer la course de façon ciblée ; un plan Allure+ du catalogue sera recommandé au bon moment.</div></div>`;
  }

  const header = `
    <div class="training-plan-header card">
      <div class="plan-header-top">
        <div>
          <div class="plan-title">Séances libres — entretien</div>
          <div class="plan-subtitle-desc">${NOT_A_PLAN_ADVICE}${phaseHtml}</div>
          <div class="rt-adapt-note">🔄 <strong>Des séances qui s’adaptent.</strong> Celles que tu vois sont des <strong>propositions</strong> : elles peuvent être modifiées selon ta forme, ton assiduité (séances faites ou manquées), ta charge récente, tes autres sports et ton ressenti. La semaine en cours reste stable ; les semaines à venir sont ajustées quand elles commencent.</div>
          ${planBannerHtml}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span class="plan-type-badge">${terrainLabel}</span>
          <span class="plan-type-badge">${prefs.frequency}x/sem</span>
          ${badges}
        </div>
      </div>
    </div>`;

  const weekTabs = `
    <div class="week-tabs-wrap">
      <div class="week-tabs" id="week-tabs">
        ${weeks.map((w, i) => {
          const isCurrent = i === currentIdx;
          const isPast = i < currentIdx;
          return `
            <button class="week-tab${i === campusState.selectedWeekIdx ? ' week-tab--active' : ''}${isCurrent ? ' week-tab--current' : ''}${isPast ? ' week-tab--past' : ''}"
              onclick="selectFreeWeek(${i})" id="week-tab-${i}" title="${w.tabTitle}">
              <span class="week-tab-num">${isPast ? '✓ ' : ''}S${i + 1} ${w.dot}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;

  const horizonNote = `<div class="rt-horizon-note">ℹ️ <strong>Pourquoi seulement les 4 prochaines semaines ?</strong>
    Ces séances ne sont pas un plan écrit d’avance : chaque semaine est construite d’après ta forme du moment, ton assiduité, ta charge récente (y compris tes autres sports) et tes ressentis. Les 4 semaines d’un cycle complet sont montrées en aperçu pour te projeter, puis réajustées quand elles arrivent ; au-delà, seule la phase du cycle est connue (souple, modérée, intense, récupération) — figer 16 semaines à l’avance deviendrait faux dès que tu manques ou ajoutes une séance.</div>`;

  const actions = `
    <div class="plan-actions-bar">
      <button class="btn-plan-action" onclick="editFreeSessionsPrefs()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Modifier (terrain / fréquence / durée)
      </button>
      <button class="btn-plan-action" onclick="toggleRoutineCaution()" title="Bloque les variantes orange et rouge et garde les prochaines séances au palier modéré">
        ${prefs.caution ? '🩹 Gêne signalée — lever' : '🩹 Signaler une gêne / fatigue'}
      </button>
      <button class="btn-plan-action btn-cancel-plan" onclick="disableFreeSessions()" style="margin-left:auto;opacity:.85;background:rgba(229,57,53,.15);color:#e53935;border:1px solid rgba(229,57,53,.3);">
        ✕ Désactiver les séances libres
      </button>
    </div>`;

  el('campus-plan-wrap').innerHTML = header + weekTabs + horizonNote + actions + `<div id="training-session-list"></div>`;
  renderSessionList(campusState.selectedWeekIdx);
}

// Un onglet de semaine non générée (semaine en cours ou suivante) la génère
// à l'ouverture ; les autres se contentent d'afficher leur message.
async function selectFreeWeek(idx) {
  const prefs = getFreeSessionsPrefs();
  const w = campusState.weeks[idx];
  if (prefs && w && w.pending) {
    const wn = idx + 1;
    const planInfo = routineCurrentPlanInfo();
    const beforePlan = !planInfo || routineWeeksBetween(freeWeekDate(prefs, wn), planInfo.startMs) >= 1;
    if (beforePlan && wn >= routineEngineStart(prefs) && wn <= freeSessionsWeekNumber(prefs) + 1) {
      await ensureRoutineWeek(prefs, wn, planInfo);
      await renderFreeSessionsWeek(idx);
      return;
    }
  }
  selectWeek(idx);
}

// ─── Configuration (démarrage / modification / arrêt) ──────────────────
function startFreeSessions() {
  const terrainBtn = document.querySelector('#free-sessions-terrain-toggle .routes-toggle-btn.active');
  const freqBtn = document.querySelector('#free-sessions-freq-toggle .routes-toggle-btn.active');
  const maxBtn = document.querySelector('#free-sessions-maxmin-toggle .routes-toggle-btn.active');
  const anchorMonday = mondayOfWeek(Date.now());
  const prefs = {
    terrain: terrainBtn?.dataset.terrain || 'route',
    frequency: parseInt(freqBtn?.dataset.freq, 10) || 3,
    maxMin: parseInt(maxBtn?.dataset.maxmin, 10) || 90,
    anchorMonday,
    engine: 'v2',
    engineStartWeek: 1,
  };
  const rDate = document.getElementById('free-sessions-race-date')?.value;
  const rDist = document.getElementById('free-sessions-race-dist')?.value;
  if (rDate && rDist) {
    const dateMs = new Date(rDate + 'T12:00:00').getTime();
    if (dateMs > Date.now()) prefs.race = { dateMs, distKey: rDist, name: (document.getElementById('free-sessions-race-name')?.value || '').trim().slice(0, 60) };
  }
  // La semaine en cours est régénérée avec les nouveaux réglages ; les
  // semaines passées restent dans le magasin et servent d'historique (variété).
  const store = getRoutineStore();
  delete store.weeks[anchorMonday];
  saveRoutineStore(store);
  saveFreeSessionsPrefs(prefs);
  renderFreeSessionsWeek();
  showToast('Séances libres générées pour cette semaine', 'success');
}

async function disableFreeSessions() {
  const ok = await showConfirmModal({
    title: 'Désactiver les séances libres ?',
    message: 'Vous pourrez les réactiver à tout moment (terrain, fréquence et durée vous seront redemandés).',
    confirmLabel: 'Désactiver',
    icon: '✕',
  });
  if (!ok) return;
  localStorage.removeItem(FREE_SESSIONS_KEY);
  campusState.usingImportedPlan = false;
  const snap = campusState.planSnapshot;
  if (snap) renderTrainingPlan(snap.goal, snap.weeks, { skipRoutine: true });
  else showTrainingEmpty();
}

function editFreeSessionsPrefs() {
  const prefs = getFreeSessionsPrefs();
  const note = document.getElementById('free-sessions-note');
  if (note) note.style.display = prefs && prefs.dormant ? '' : 'none';
  el('campus-connect-card').style.display = '';
  el('campus-plan-wrap').style.display = 'none';
  el('campus-login-block').style.display = 'none';
  el('campus-import-only').style.display = '';
  if (prefs) {
    document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.terrain === prefs.terrain));
    document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.freq === String(prefs.frequency)));
    document.querySelectorAll('#free-sessions-maxmin-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.maxmin === String(prefs.maxMin || 90)));
    const rd = document.getElementById('free-sessions-race-date'), rs = document.getElementById('free-sessions-race-dist'), rn = document.getElementById('free-sessions-race-name');
    if (rd && rs && rn) {
      const r = prefs.race && prefs.race.dateMs > Date.now() ? prefs.race : null;
      rd.value = r ? new Date(r.dateMs).toISOString().slice(0, 10) : '';
      rs.value = r ? r.distKey : '';
      rn.value = r ? (r.name || '') : '';
    }
  }
}


// ─── Variantes vert / jaune / orange / rouge ─────────────────────────────
// Le choix se fait AVANT la séance : la fiche figée de la semaine est
// remplacée par la variante (dsl recalculé, durée / récupérations / charge
// avec), jamais les allures (toujours celles du profil). Une séance déjà
// pointée ou une semaine passée ne change plus.
const ROUTINE_VARIANT_DOT = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴' };

function routineWeekCtx(prefs, stored, snapIdx, locked) {
  return {
    phase: stored.phase, cap: stored.cap, level: stored.level, warnings: stored.warnings || [],
    caution: !!prefs.caution, maxMin: prefs.maxMin || 90, locked,
    otherTiers: stored.sessions.filter((s, i) => i !== snapIdx).map(s => s.tier),
  };
}

function routineLookup(weekId, idx) {
  const prefs = getFreeSessionsPrefs();
  if (!prefs || !weekId || !String(weekId).startsWith('free_')) return null;
  const wd = Number(String(weekId).slice(5));
  const store = getRoutineStore();
  const stored = store.weeks[wd];
  if (!stored || !stored.sessions[idx]) return null;
  return { prefs, store, stored, wd, snap: stored.sessions[idx] };
}

// Barre de choix affichée dans le détail d'une séance (campus.js renderSessionDetail)
function renderRoutineVariantBar(session, weekId) {
  const idx = session.trainingIndex ?? 0;
  const found = routineLookup(weekId, idx);
  if (!found) return '';
  const { prefs, stored, wd, snap } = found;
  const done = typeof getLocalSessionStatus === 'function' && getLocalSessionStatus(weekId, idx) === 'done';
  const pastWeek = wd + 7 * 86400000 < Date.now();
  const variants = RoutineEngine.routineBuildVariants(snap, routineWeekCtx(prefs, stored, idx, done || pastWeek));
  const sel = variants.find(v => v.selected) || variants[1];
  const btn = v => {
    const delta = v.variant === 'yellow' ? 'prévue' : `${v.deltaLoadPct >= 0 ? '+' : ''}${v.deltaLoadPct} % de charge`;
    const title = v.available || v.selected
      ? `${v.label} — ${v.totalMin} min au total (${v.deltaTotalMin >= 0 ? '+' : ''}${v.deltaTotalMin} min), ${v.deltaWorkMin >= 0 ? '+' : ''}${v.deltaWorkMin} min de travail${v.intensity ? ', allure ' + v.intensity + ' de la zone' : ''}. ${RoutineEngine.routineDescribe(v.dsl)}.`
      : v.reason;
    return `<button type="button" class="rt-variant rt-variant--${v.variant}${v.selected ? ' rt-variant--on' : ''}"${v.available || v.selected ? '' : ' disabled'}
      title="${title.replace(/"/g, '&quot;')}" onclick="event.stopPropagation();setRoutineVariant('${weekId}',${idx},'${v.variant}')">
      <span class="rt-variant-name">${ROUTINE_VARIANT_DOT[v.variant]} ${v.label}</span>
      <span class="rt-variant-meta">${v.totalMin} min · ${delta}</span>${v.intensity ? `<span class="rt-variant-meta">allure ${v.intensity}</span>` : ''}</button>`;
  };
  const lockedMsg = (done || pastWeek) ? '<div class="rt-variant-note">Séance faite ou semaine passée : variante figée.</div>'
    : prefs.caution ? '<div class="rt-variant-note">🩹 Gêne signalée : les variantes plus exigeantes sont bloquées.</div>' : '';
  return `<div class="session-detail-section rt-variants">
    <div class="session-detail-section-title">Intensité de la séance <span class="zones-source-note">charge ≈ ${sel.load}</span></div>
    <div class="rt-variant-row">${variants.map(btn).join('')}</div>
    ${lockedMsg}
  </div>`;
}

function setRoutineVariant(weekId, idx, variant) {
  const found = routineLookup(weekId, idx);
  if (!found) return;
  const { prefs, store, stored, wd, snap } = found;
  const done = typeof getLocalSessionStatus === 'function' && getLocalSessionStatus(weekId, idx) === 'done';
  if (done || wd + 7 * 86400000 < Date.now()) return;
  const v = RoutineEngine.routineBuildVariants(snap, routineWeekCtx(prefs, stored, idx, false)).find(x => x.variant === variant);
  if (!v || !v.available) { if (v && v.reason) showToast(v.reason, 'info'); return; }
  snap.baseDsl = snap.baseDsl || snap.dsl;
  snap.variant = variant;
  snap.dsl = v.dsl;
  snap.totalSec = v.totalMin * 60;
  snap.qualitySec = Math.round(RoutineEngine.routineLoadOfDsl(v.dsl, snap.wuCd !== false).qualityMin * 60);
  snap.tier = v.tier;
  snap.load = v.load;
  stored.hardCount = stored.sessions.filter(s => s.tier >= 2).length;
  const others = (stored.warnings || []).filter(w => !/très exigeantes/.test(w));
  stored.warnings = stored.hardCount > 1 ? others.concat('Deux séances très exigeantes dans la même semaine.') : others;
  saveRoutineStore(store);
  // ré-affiche la semaine en gardant la séance ouverte
  const keepIdx = campusState.selectedWeekIdx;
  renderFreeSessionsWeek(keepIdx).then(() => {
    campusState.openSessionIdx = idx;
    renderSessionList(keepIdx);
  });
}

// ─── Gêne / fatigue signalée ─────────────────────────────────────────────
// Bloque les variantes orange/rouge et ramène la génération au palier modéré
// (cahier des charges §8 : limiter les hausses en cas de douleur, fatigue,
// retour de blessure). Les semaines à venir déjà générées repassent en jaune.
async function toggleRoutineCaution() {
  const prefs = getFreeSessionsPrefs();
  if (!prefs) return;
  const on = !prefs.caution;
  prefs.caution = on;
  saveFreeSessionsPrefs(prefs);
  if (on) {
    const store = getRoutineStore();
    const now = Date.now();
    Object.keys(store.weeks).forEach(k => {
      if (Number(k) + 7 * 86400000 < now) return;           // semaines passées : intactes
      const w = store.weeks[k];
      w.sessions.forEach((snap, i) => {
        if (snap.variant !== 'orange' && snap.variant !== 'red') return;
        const wasDone = typeof getLocalSessionStatus === 'function' && getLocalSessionStatus('free_' + k, i) === 'done';
        if (wasDone) return;
        const yellow = RoutineEngine.routineBuildVariants({ ...snap, variant: 'yellow' }, { phase: w.phase, cap: 2, level: w.level, caution: true, maxMin: 999, locked: false, otherTiers: [] })[1];
        snap.variant = 'yellow'; snap.dsl = snap.baseDsl || snap.dsl; snap.totalSec = yellow.totalMin * 60; snap.tier = yellow.tier; snap.load = yellow.load;
      });
      w.hardCount = w.sessions.filter(s => s.tier >= 2).length;
    });
    saveRoutineStore(store);
  }
  showToast(on ? 'Gêne signalée : variantes plus exigeantes bloquées.' : 'Gêne levée : variantes de nouveau disponibles.', 'info');
  await renderFreeSessionsWeek(campusState.selectedWeekIdx);
}

// ─── Page Admin > Routines hors plan ─────────────────────────────────────
async function loadAdminRoutines() {
  const box = document.getElementById('admin-routines');
  if (!box) return;
  const cfg = await routineServerConfig(true);
  const roadOnly = ROUTINE_FAMILIES.filter(f => !f.terrain.includes('trail'));
  const trailNow = ROUTINE_FAMILIES.filter(f => f.terrain.includes('trail'));
  const count = id => ROUTINE_CATALOG.filter(m => m.family === id).length;
  const trailFam = trailNow.length + (cfg.trailRoadFamilies ? roadOnly.length : 0);
  setAdminSectionMeta('routines', `Trail : ${trailFam} familles sur ${ROUTINE_FAMILIES.length}`);
  box.innerHTML = `
    <label class="admin-switch-row">
      <input type="checkbox" id="admin-routines-trailfam" ${cfg.trailRoadFamilies ? 'checked' : ''}>
      <span>
        <strong>Ouvrir au trail les 7 familles « route seulement »</strong><br>
        <span class="admin-switch-hint">Les routines Trail proposeront aussi : ${roadOnly.map(f => f.name + ' (' + count(f.id) + ')').join(' · ')}. Les allures restent celles du profil, avec la correction trail habituelle. Ne change pas les semaines déjà générées : seulement celles à venir.</span>
      </span>
    </label>
    <div class="admin-switch-hint" style="margin-top:12px">Réglage propre à <strong>ce poste</strong> (fichier <code>data/routine_config.json</code>) : il n'est pas diffusé aux autres utilisateurs.</div>
    <div class="admin-subtitle" style="margin-top:16px">Familles disponibles en trail aujourd'hui</div>
    <div class="admin-switch-hint">${ROUTINE_FAMILIES.filter(f => f.terrain.includes('trail') || cfg.trailRoadFamilies).map(f => f.id + ' ' + f.name).join(' · ')}</div>`;
  document.getElementById('admin-routines-trailfam').addEventListener('change', async ev => {
    const want = ev.target.checked;
    try {
      const res = await fetch(`${API}/api/admin/routine-config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trailRoadFamilies: want }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _routineCfgCache = await res.json();
      showToast(want ? 'Familles route ouvertes au trail.' : 'Trail limité à ses 5 familles.', 'success');
      loadAdminRoutines();
    } catch (e) {
      ev.target.checked = !want;
      showToast('Enregistrement impossible : ' + e.message, 'error');
    }
  });
}


// ─── Passage routine ⇄ plan ───────────────────────────────────────────────
// Depuis la routine : afficher le plan à venir (sans rien désactiver)
function routineShowPlan() {
  const snap = campusState.planSnapshot;
  if (snap) renderTrainingPlan(snap.goal, snap.weeks, { skipRoutine: true });
}
// Depuis un plan à venir : bandeau qui propose / reprend la routine d'ici là
function renderPrePlanBanner(goal, weeks) {
  const info = routinePlanInfoFrom(goal, weeks);
  const wrap = document.getElementById('campus-plan-wrap');
  if (!info || !wrap || info.startMs <= mondayOfWeek(Date.now())) return;
  const n = Math.max(1, routineWeeksBetween(mondayOfWeek(Date.now()), info.startMs));
  const fp = getFreeSessionsPrefs();
  const hasRoutine = !!(fp && !fp.dormant);
  const banner = document.createElement('div');
  banner.className = 'rt-plan-banner rt-plan-banner--card card';
  banner.innerHTML = `<div>🏁 Ton plan démarre le <strong>${routineDateFr(info.startMs)}</strong> (dans ${n} semaine${n > 1 ? 's' : ''}).
    ${hasRoutine ? 'Ta routine t’accompagne jusqu’au démarrage de ton plan.' : 'Une routine d’entretien peut t’accompagner d’ici là pour arriver en forme.'}</div>
    <button type="button" class="btn-plan-action" onclick="${hasRoutine ? 'renderFreeSessionsWeek()' : 'editFreeSessionsPrefs()'}">${hasRoutine ? 'Retour à ma routine' : 'Créer ma routine d’ici là'}</button>`;
  wrap.insertBefore(banner, wrap.firstChild);
}

// ─── Boutons de réglage (terrain, séances/semaine, durée max) ────────────
// Délégation sur tout le bloc de configuration : un clic active le bouton et
// désactive ses voisins du même groupe. (Ce câblage a disparu par erreur à la
// refonte v1.86.0 — les boutons restaient figés sur leurs valeurs par défaut.)
document.addEventListener('click', ev => {
  const btn = ev.target.closest && ev.target.closest('#free-sessions-setup .routes-toggle-btn');
  if (!btn || !btn.parentElement) return;
  btn.parentElement.querySelectorAll('.routes-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
});
