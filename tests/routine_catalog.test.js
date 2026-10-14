// Tests du catalogue de routines hors plan (lot P0). Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROUTINE_CATALOG, ROUTINE_FAMILIES, compileRoutineDsl, routineToLegacySteps, getRoutineCompiled,
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
    assert.ok(last.role !== 'recovery' && last.role !== 'setRecovery', m.id);
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

test('export historique : récupérations en RECOVER, RPE sans allure', () => {
  const legacy = routineToLegacySteps(compileRoutineDsl('15m EF + 3x(1m RPE7:cote + 2m EF) + 10m EF'));
  assert.equal(legacy[0].kind, 'WARMUP');
  assert.equal(legacy[legacy.length - 1].kind, 'COOLDOWN');
  const rpe = legacy.find(s => s.rpe === 7);
  assert.equal(rpe.slug, null);
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
