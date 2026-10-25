// Séance Garmin du test VMA 3'+9' (protocole Running Addict / Campus).
//
// Contrairement aux séances de plan (buildGarminWorkoutFromSession, server.js),
// aucune allure cible : les deux efforts sont "à fond". Ce qui compte ici, ce
// sont les PAUSES AU LAP : l'athlète doit être placé sur la piste avant chaque
// effort, donc l'échauffement, la mise en place avant le 3', la mise en place
// avant le 9' et le retour au calme se terminent au bouton Lap, jamais à la
// durée. Seules les récupérations (30' en 5 étapes) et les efforts ont une
// durée fixe — les 30' de récup sont comptées exactement entre la fin du 3' et
// la mise en place du 9' (la pause au lap ne les allonge pas).
//
// Échauffement : version GÉNÉRIQUE (EF tranquille + gammes), à ajuster par
// l'utilisateur — voir WARMUP_DRILLS.

const LAP = { conditionTypeId: 1, conditionTypeKey: 'lap.button' };
const TIME = { conditionTypeId: 2, conditionTypeKey: 'time' };
const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' };
const TYPES = {
  warmup:   { stepTypeId: 1, stepTypeKey: 'warmup' },
  cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown' },
  interval: { stepTypeId: 3, stepTypeKey: 'interval' },
  recovery: { stepTypeId: 4, stepTypeKey: 'recovery' },
  rest:     { stepTypeId: 5, stepTypeKey: 'rest' },
};

const WARMUP_EF_SEC = 8 * 60; // EF tranquille avant les gammes
const WARMUP_DRILLS = [
  'Gammes : talons-fesses',
  'Gammes : montees de genou',
  'Gammes : pointes de pieds',
  'Accelerations progressives (2 x 80 a 100 m)',
];
// Récupération de 30' entre les deux efforts : [description, secondes]
const RECOVERY_30 = [
  ['Marche', 5 * 60],
  ['Jogging lent', 10 * 60],
  ['Marche', 5 * 60],
  ['Jogging lent', 5 * 60],
  ['Marche', 5 * 60],
];

function buildVmaTestWorkout(opts = {}) {
  const restKey = opts.restAsRecovery ? 'recovery' : 'rest';
  const steps = [];
  const add = (type, description, endCondition, value) => {
    steps.push({
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: steps.length + 1,
      childStepId: null,
      description,
      stepType: TYPES[type],
      endCondition,
      endConditionValue: endCondition === LAP ? null : value,
      endConditionCompare: null,
      endConditionZone: null,
      preferredEndConditionUnit: null,
      targetType: NO_TARGET,
      targetValueOne: null,
      targetValueTwo: null,
      zoneNumber: null,
    });
  };

  // Échauffement 15' : EF tranquille puis gammes, chaque gamme au lap suivie
  // d'un temps de replacement (marche retour) lui aussi au lap.
  add('warmup', 'EF tranquille', TIME, WARMUP_EF_SEC);
  WARMUP_DRILLS.forEach((d, i) => {
    add('warmup', d, LAP);
    if (i < WARMUP_DRILLS.length - 1) add('recovery', 'Replacement (marche)', LAP);
  });

  add(restKey, 'Mise en place sur la piste - lap quand pret', LAP);
  add('interval', 'EFFORT 1 : 3 min a fond - noter distance et temps au repere', TIME, 3 * 60);
  RECOVERY_30.forEach(([d, s]) => add('recovery', d, TIME, s));
  add(restKey, 'Mise en place sur la piste - lap quand pret', LAP);
  add('interval', 'EFFORT 2 : 9 min a fond - noter distance et temps au repere', TIME, 9 * 60);
  add('cooldown', 'Retour au calme : 10 a 15 min de jogging lent', LAP);

  const sportType = { sportTypeId: 1, sportTypeKey: 'running' };
  return {
    workoutName: 'Test VMA 3+9',
    description: "Test VMA 3'+9' (Allure+) : pauses au lap avant chaque effort, aucun objectif d'allure. Echauffement generique a ajuster.",
    sportType,
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps: steps }],
  };
}

module.exports = { buildVmaTestWorkout, WARMUP_DRILLS, RECOVERY_30 };
