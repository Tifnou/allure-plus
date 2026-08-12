// ============================================================
// free_sessions.js — Séances libres (hors plan d'entraînement)
// Propose chaque semaine 3 ou 4 séances d'entretien (EF, fractionné,
// sortie longue) quand aucun plan Campus/importé n'est actif. Ce n'est
// PAS un plan structuré (pas d'objectif/date de fin), mais les 23 séances
// de fractionné (QUALITE_POOL/QUALITE_TIERS) et les 12 sorties longues
// (LONGUE_POOL/LONGUE_TIERS) suivent une vraie progression cyclique par
// bloc de 4 semaines : semaines 1→3 montent en charge (léger→modéré→dur,
// cf. TIER_KEYS), semaine 4 = allégée (isLightFreeWeek). Le bloc suivant
// recommence au tier léger mais pioche une autre séance dans chaque tier
// (blockIdx), pour ne jamais reproposer deux fois la même séance à charge
// équivalente avant plusieurs mois.
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
function buildFractionneSession(idx, terrain, blockPos, blockIdx, light) {
  const pool = light ? LIGHT_QUALITE_POOL : QUALITE_TIERS[blockPos];
  const variant = pool[blockIdx % pool.length];
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
  const sessions = [];
  let idx = 0;
  sessions.push(buildEfSession(idx++, terrain, weekNum - 1));
  sessions.push(buildFractionneSession(idx++, terrain, blockPos, blockIdx, light));
  if (prefs.frequency >= 4) sessions.push(buildEfSession(idx++, terrain, weekNum));
  sessions.push(buildSlSession(idx++, terrain, blockPos, blockIdx, light));
  return { weekNum, light, tier: light ? null : blockPos, sessions };
}

// Conservée pour compat (tests) : une seule semaine, calculée depuis `now`.
function generateFreeSessionsWeek(prefs, now = Date.now()) {
  return buildFreeSessionsWeekData(prefs, freeSessionsWeekNumber(prefs, now));
}

// ─── Rendu ───────────────────────────────────────────────────────────────
// Ce n'est pas un plan avec une fin (séances "d'entretien" reconduites
// indéfiniment) : on génère et affiche quand même un horizon d'au moins
// 16 semaines (avec onglets, comme un vrai plan) - purement pour que
// l'utilisateur puisse parcourir à l'avance et valider la rotation des
// fractionnés / la cadence des semaines allégées, sans attendre semaine
// après semaine. La fenêtre glisse avec le temps (16 semaines mini,
// toujours au moins 8 semaines d'avance sur la semaine courante).
const FREE_SESSIONS_MIN_WEEKS = 16;
const FREE_SESSIONS_LOOKAHEAD = 8;

// Charge du tier (0/1/2) : couleur pour le point dans les onglets + libellé
// pour le bandeau d'en-tête et le title="" au survol.
const TIER_DOT = ['🟢', '🟡', '🔴'];
const TIER_LABEL = ['légère', 'modérée', 'élevée'];

function renderFreeSessionsWeek() {
  const prefs = getFreeSessionsPrefs();
  if (!prefs) return;
  const currentWeekNum = freeSessionsWeekNumber(prefs);
  const currentLight = isLightFreeWeek(currentWeekNum);
  const currentTier = currentLight ? null : (currentWeekNum - 1) % 4;
  const totalWeeks = Math.max(FREE_SESSIONS_MIN_WEEKS, currentWeekNum + FREE_SESSIONS_LOOKAHEAD);

  const weeks = [];
  for (let wn = 1; wn <= totalWeeks; wn++) {
    const { light, tier, sessions } = buildFreeSessionsWeekData(prefs, wn);
    const weekDate = prefs.anchorMonday + (wn - 1) * 7 * 86400000;
    weeks.push({ _id: 'free_' + weekDate, weekDate, sessions, context: {}, light, tier });
  }

  campusState.weeks = weeks;
  const currentIdx = Math.min(Math.max(currentWeekNum - 1, 0), weeks.length - 1);
  campusState.selectedWeekIdx = currentIdx;
  campusState.openSessionIdx = -1;
  campusState.usingImportedPlan = true; // active "Marquer comme fait" (getLocalSessionStatus)
  campusState.campusConnected = false;
  campusState.goal = null; // pas d'objectif associé - évite un bloc "Allure objectif" perimé

  const terrainLabel = prefs.terrain === 'trail' ? 'Trail' : 'Route';

  el('campus-connect-card').style.display = 'none';
  el('campus-loading').style.display = 'none';
  el('campus-plan-wrap').style.display = '';
  el('campus-plan-subtitle').textContent = `Séances libres — ${terrainLabel} · ${prefs.frequency}x/semaine`;

  const header = `
    <div class="training-plan-header card">
      <div class="plan-header-top">
        <div>
          <div class="plan-title">Séances libres — entretien</div>
          <div class="plan-subtitle-desc">${NOT_A_PLAN_ADVICE}${currentLight ? ' <strong>Semaine allégée cette semaine</strong> (récupération).' : ` <strong>Semaine ${currentTier + 1}/3</strong> du bloc — charge ${TIER_LABEL[currentTier]}.`}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span class="plan-type-badge">${terrainLabel}</span>
          <span class="plan-type-badge">${prefs.frequency}x/sem</span>
          ${currentLight ? '<span class="plan-type-badge" style="background:#fef3c7;color:#b45309">Semaine légère</span>' : `<span class="plan-type-badge">${TIER_DOT[currentTier]} Charge ${TIER_LABEL[currentTier]}</span>`}
        </div>
      </div>
    </div>`;

  const weekTabs = `
    <div class="week-tabs-wrap">
      <div class="week-tabs" id="week-tabs">
        ${weeks.map((w, i) => {
          const isCurrent = i === currentIdx;
          const isPast = i < currentIdx;
          const tabTitle = w.light ? 'Semaine allégée' : `Charge ${TIER_LABEL[w.tier]} (${w.tier + 1}/3 du bloc)`;
          return `
            <button class="week-tab${i === campusState.selectedWeekIdx ? ' week-tab--active' : ''}${isCurrent ? ' week-tab--current' : ''}${isPast ? ' week-tab--past' : ''}"
              onclick="selectWeek(${i})" id="week-tab-${i}" title="${tabTitle}">
              <span class="week-tab-num">${isPast ? '✓ ' : ''}S${i + 1}${w.light ? ' \u{1FAB6}' : ' ' + TIER_DOT[w.tier]}</span>
            </button>`;
        }).join('')}
      </div>
    </div>`;

  const actions = `
    <div class="plan-actions-bar">
      <button class="btn-plan-action" onclick="editFreeSessionsPrefs()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Modifier (terrain / fréquence)
      </button>
      <button class="btn-plan-action btn-cancel-plan" onclick="disableFreeSessions()" style="margin-left:auto;opacity:.85;background:rgba(229,57,53,.15);color:#e53935;border:1px solid rgba(229,57,53,.3);">
        ✕ Désactiver les séances libres
      </button>
    </div>`;

  el('campus-plan-wrap').innerHTML = header + weekTabs + actions + `<div id="training-session-list"></div>`;
  renderSessionList(campusState.selectedWeekIdx);
}

// ─── Configuration (démarrage / modification / arrêt) ──────────────────
function startFreeSessions() {
  const terrainBtn = document.querySelector('#free-sessions-terrain-toggle .routes-toggle-btn.active');
  const freqBtn = document.querySelector('#free-sessions-freq-toggle .routes-toggle-btn.active');
  const prefs = {
    terrain: terrainBtn?.dataset.terrain || 'route',
    frequency: parseInt(freqBtn?.dataset.freq, 10) || 3,
    anchorMonday: mondayOfWeek(Date.now()),
  };
  saveFreeSessionsPrefs(prefs);
  renderFreeSessionsWeek();
  showToast('Séances libres générées pour cette semaine', 'success');
}

async function disableFreeSessions() {
  const ok = await showConfirmModal({
    title: 'Désactiver les séances libres ?',
    message: 'Vous pourrez les réactiver à tout moment (terrain et fréquence vous seront redemandés).',
    confirmLabel: 'Désactiver',
    icon: '✕',
  });
  if (!ok) return;
  localStorage.removeItem(FREE_SESSIONS_KEY);
  campusState.usingImportedPlan = false;
  showTrainingEmpty();
}

function editFreeSessionsPrefs() {
  const prefs = getFreeSessionsPrefs();
  el('campus-connect-card').style.display = '';
  el('campus-plan-wrap').style.display = 'none';
  el('campus-login-block').style.display = 'none';
  el('campus-import-only').style.display = '';
  if (prefs) {
    document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.terrain === prefs.terrain));
    document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.freq === String(prefs.frequency)));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});
