// Tests du catalogue de routines hors plan (lot P0). Lancer : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROUTINE_CATALOG, ROUTINE_FAMILIES, compileRoutineDsl, routineToSessionStructure, getRoutineCompiled,
} = require('../frontend/js/routine_catalog.js');

test('toutes les fiches compilent', () => {
  for (const m of ROUTINE_CATALOG) assert.doesNotThrow(() => getRoutineCompiled(m), m.id);
});

test('identifiants uniques', () => {
  const ids = ROUTINE_CATALOG.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('les 120 fiches du cahier des charges sont présentes', () => {
  const cahier = ROUTINE_CATALOG.filter(m => m.source === 'cahier');
  assert.equal(cahier.length, 120);
  assert.equal(ROUTINE_FAMILIES.length, 12);
});

test('durée compilée = total annoncé du cahier des charges (±30 s)', () => {
  for (const m of ROUTINE_CATALOG.filter(x => x.statedMin != null)) {
    const min = getRoutineCompiled(m).totalSec / 60;
    assert.ok(Math.abs(min - m.statedMin) <= 0.5, `${m.id} ${m.name} : compilé ${min} min, annoncé ${m.statedMin} min`);
  }
});

test('jamais de récupération en fin de séance ni de séance vide', () => {
  for (const m of ROUTINE_CATALOG) {
    const { steps } = getRoutineCompiled(m);
    assert.ok(steps.length > 0, m.id);
    const last = steps[steps.length - 1];
    // séances de qualité : jamais de récup en fin (le retour au calme conclut) ;
    // exception voulue : une EF marche-course (A01-09) finit sur sa marche.
    if (getRoutineCompiled(m).hasQuality) assert.ok(last.role !== 'recovery' && last.role !== 'setRecovery', m.id);
    else assert.notEqual(last.role, 'setRecovery', m.id);
  }
});

test('r et R seulement ENTRE répétitions : 2×10′ r3′ = une seule récupération', () => {
  const c = compileRoutineDsl('15m EF + 2x(10m AS10) r3m EF + 10m EF');
  assert.equal(c.steps.filter(s => s.role === 'recovery').length, 1);
  assert.equal(c.totalSec, (15 + 20 + 3 + 10) * 60);
});

// Le §9 du cahier des charges annonce 96 min, mais 15+23+5+33+10 = 86 min (erreur du document).
test('exemple du §9 : 86 minutes (et non 96), 50′ spécifiques dont 20′ AS10', () => {
  const bloc = compileRoutineDsl('15m EF + 2x(10m AS10) r3m EF + 5m EF + 2x(15m AS21) r3m EF + 10m EF');
  assert.equal(bloc.totalSec / 60, 86);
  assert.equal(bloc.qualitySec / 60, 50);
});

test('échauffement / retour au calme assignés seulement sur les séances de qualité', () => {
  const q = compileRoutineDsl('15m EF + 3x(6m TEMPO) r2m EF + 10m EF');
  assert.equal(q.steps[0].role, 'warmup');
  assert.equal(q.steps[q.steps.length - 1].role, 'cooldown');
  const ef = compileRoutineDsl('40m EF');
  assert.equal(ef.steps[0].role, 'base');
  const sl = compileRoutineDsl('45m EF + 2x(10m TEMPO) r3m EF + 17m EF', { wuCd: false });
  assert.equal(sl.steps[0].role, 'easy');
});

test('structure Campus : bloc répété sans récup fantôme, retour au calme dédié', () => {
  const st = routineToSessionStructure(compileRoutineDsl('15m EF + 3x(6m TEMPO) r2m EF + 10m EF'));
  // échauffement | 2 x [Tempo + récup] | Tempo final | retour au calme
  assert.deepEqual(st.exercisesBlocks.map(b => [b.blockType, b.repeat]), [['warm-up', 1], ['main', 2], ['main', 1], ['cool-down', 1]]);
  assert.equal(st.paceZones.reduce((a, z) => a + z.duration, 0), (15 + 18 + 4 + 10) * 60);
  assert.equal(st.paceZones.filter(z => z.kind === 'RECOVER').length, 2);
  assert.equal(st.paceZones[st.paceZones.length - 1].kind, 'COOLDOWN');
  assert.equal(st.exercisesBlocks[1].exercises[1].exerciseType, 'recuperation');
});

test("paceZones suit exactement l'ordre des blocs déroulés", () => {
  for (const m of ROUTINE_CATALOG) {
    const st = routineToSessionStructure(getRoutineCompiled(m));
    const expected = st.exercisesBlocks.flatMap(b => Array.from({ length: b.repeat }, () => b.exercises).flat()).length;
    assert.equal(st.paceZones.length, expected, m.id);
    assert.equal(st.paceZones.reduce((a, z) => a + z.duration, 0), getRoutineCompiled(m).totalSec, m.id);
  }
});

test('séances imbriquées : pas de répétition dans une répétition', () => {
  const c = compileRoutineDsl('15m EF + 2x(3x(2m S30) r1m EF) R4m EF + 10m EF');
  assert.equal(c.totalSec / 60, 15 + 2 * (6 + 2) + 4 + 10);
  const st = routineToSessionStructure(c);
  // le groupe interne (3 x 2' S30) reste un groupe ; l'extérieur est déroulé
  assert.ok(st.exercisesBlocks.some(b => b.repeat === 2));
  assert.equal(st.paceZones.reduce((a, z) => a + z.duration, 0), c.totalSec);
});

test('toute séance de qualité se termine par un retour au calme', () => {
  for (const m of ROUTINE_CATALOG) {
    const c = getRoutineCompiled(m);
    if (c.hasQuality) assert.equal(c.steps[c.steps.length - 1].role, 'cooldown', m.id);
  }
});

test('EF intercalée entre deux efforts = récup ; EF haute = EF active', () => {
  const c = compileRoutineDsl('15m EF + 4x(4m TEMPO + 2m EF) + 10m EF');
  assert.equal(c.steps.filter(s => s.role === 'recovery').length, 4);
  const d = compileRoutineDsl('15m EF + 3x(5m EFH + 4m TEMPO) + 10m EF');
  assert.equal(d.steps.filter(s => s.role === 'recovery').length, 0);
});

test("RPE : zone sans cible d'allure", () => {
  const st = routineToSessionStructure(compileRoutineDsl('15m EF + 3x(1m RPE7:cote + 2m EF) + 10m EF'));
  const z = st.paceZones.find(x => x.rpe === 7);
  assert.equal(z.noTarget, true);
  assert.equal(z.pace, null);
});

test('le DSL refuse un code d\'allure inconnu', () => {
  assert.throws(() => compileRoutineDsl('10m XYZ'));
  assert.throws(() => compileRoutineDsl('10m EF +'));
});

test('aucun doublon exact de structure dans le catalogue', () => {
  const seen = new Map();
  for (const m of ROUTINE_CATALOG) {
    const key = JSON.stringify(getRoutineCompiled(m).steps.map(s => [s.sec, s.code, s.rpe || 0]));
    if (seen.has(key)) {
      // EF pures de même durée (EF 50 vs terrain souple 45 etc.) tolérées si noms/terrains diffèrent
      const other = seen.get(key);
      assert.ok(m.freeTerrain || other.freeTerrain || m.familyName !== other.familyName, `${m.id} = ${other.id}`);
    }
    seen.set(key, m);
  }
});

test('arbre → DSL → arbre : aller-retour sans perte sur tout le catalogue', () => {
  const { routineParseDsl, routineTreeToDsl } = require('../frontend/js/routine_catalog.js');
  for (const m of ROUTINE_CATALOG) {
    const again = routineTreeToDsl(routineParseDsl(m.dsl));
    const a = compileRoutineDsl(m.dsl, { wuCd: m.wuCd }), b = compileRoutineDsl(again, { wuCd: m.wuCd });
    assert.equal(b.totalSec, a.totalSec, m.id);
    assert.deepEqual(b.steps.map(s => [s.sec, s.code, s.role]), a.steps.map(s => [s.sec, s.code, s.role]), m.id);
  }
});
