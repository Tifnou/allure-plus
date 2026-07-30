// zones.js
// Source de vérité UNIQUE pour les zones d'allure Allure+ (% de la VMA).
// Doit rester cohérent avec ALLURE_PLUS_ZONES dans frontend/js/campus.js.
// Utilisé par toutes les routes serveur qui calculent des allures cibles,
// pour éviter que deux endroits du code aient des valeurs différentes.

const ALLURE_PLUS_ZONES = {
  RECOVER:    { pctLow: 0.55, pctHigh: 0.62 },
  EF:         { pctLow: 0.62, pctHigh: 0.67 },
  TEMPO:      { pctLow: 0.71, pctHigh: 0.75 },
  AS42:       { pctLow: 0.75, pctHigh: 0.78 },
  SWEET_SPOT: { pctLow: 0.79, pctHigh: 0.82, isSweetSpot: true },
  AS21:       { pctLow: 0.82, pctHigh: 0.85 },
  S60:        { pctLow: 0.84, pctHigh: 0.87 },
  AS10:       { pctLow: 0.88, pctHigh: 0.91 },
  S30:        { pctLow: 0.89, pctHigh: 0.92 },
  VMA:        { pctLow: 0.95, pctHigh: 1.05 },
};

// Sweet Spot = 95% de la vitesse S60 (règle métier Allure+)
function getZoneRange(zoneKey) {
  const ref = ALLURE_PLUS_ZONES[zoneKey];
  if (!ref) return null;
  if (ref.isSweetSpot) {
    return { pctLow: ALLURE_PLUS_ZONES.S60.pctLow * 0.95, pctHigh: ALLURE_PLUS_ZONES.S60.pctHigh * 0.95 };
  }
  return { pctLow: ref.pctLow, pctHigh: ref.pctHigh };
}

// ═══════════════════════════════════════════════════════
// Résolution de zone depuis pace.slug (fichier .aplus)
// SOURCE DE VÉRITÉ : le champ pace.slug fourni par Campus dans
// exercisesBlocks est fiable à 100% (contrairement au code générique
// Z1-Z5 + devinette sur le nom de séance, qui produisait des erreurs
// comme "Big Five" classée entièrement en S60 au lieu de S30/Sweet Spot).
// ⚠️ Ce bloc doit rester identique à celui de frontend/js/campus.js.
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

// Libellés affichés (description du pas Garmin, nom de zone dans l'app)
const ZONE_LABELS = {
  RECOVER:    'Récupération',
  EF:         'EF — Endurance fond.',
  TEMPO:      'Tempo',
  AS42:       'AS42 — Allure Marathon',
  SWEET_SPOT: 'Sweet Spot',
  AS21:       'AS21 — Allure Semi',
  S60:        'S60 — Seuil 60min',
  AS10:       'AS10 — Allure 10km',
  S30:        'S30 — Seuil 30min',
  VMA:        'VMA',
};

// "race" = allure de course cible. Son sens dépend de la distance de l'objectif.
// En trail (ou objectif inconnu), pas de zone AS pertinente → repli sur EF
// (les valeurs D+ ayant servi à générer le plan ne sont pas celles du coureur réel).
const RACE_GOAL_ZONE = { '10km': 'AS10', 'half-marathon': 'AS21', 'marathon': 'AS42' };

// Résout la zone Allure+ d'un exercice depuis pace.slug (fiable),
// avec repli sur le code générique zoneKind si le slug est absent/inconnu.
function resolveZoneFromExercise(pace, zoneKind, goalType) {
  const slug = ((pace && pace.slug) || '').toLowerCase();
  const zk   = (zoneKind || (pace && pace.zoneKind) || '').toUpperCase();

  if (slug === 'race') {
    return (goalType && RACE_GOAL_ZONE[goalType]) ? RACE_GOAL_ZONE[goalType] : 'EF';
  }
  if (slug && SLUG_TO_ZONE[slug]) return SLUG_TO_ZONE[slug];

  // Repli : code générique Campus (utilisé seulement si le slug manque)
  if (['RECOVER','RECOVERY','REST','REPOS'].includes(zk)) return 'RECOVER';
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
  return zones.map((z, i) => Object.assign({}, z, { resolvedZone: resolveZoneFromExercise(paces[i], z.kind, goalType) }));
}

module.exports = { ALLURE_PLUS_ZONES, ZONE_LABELS, getZoneRange, resolveZoneFromExercise, annotatePaceZones };
