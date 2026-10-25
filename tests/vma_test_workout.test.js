const test = require('node:test');
const assert = require('node:assert');
const { buildVmaTestWorkout } = require('../vma_test_workout');

const steps = () => buildVmaTestWorkout().workoutSegments[0].workoutSteps;
const isLap = s => s.endCondition.conditionTypeKey === 'lap.button';

test('les deux efforts sont en temps (3 et 9 min), sans cible', () => {
  const eff = steps().filter(s => s.stepType.stepTypeKey === 'interval');
  assert.deepStrictEqual(eff.map(s => s.endConditionValue), [180, 540]);
  eff.forEach(s => assert.strictEqual(s.targetType.workoutTargetTypeKey, 'no.target'));
});

test('pause au lap juste avant chaque effort', () => {
  const st = steps();
  st.forEach((s, i) => {
    if (s.stepType.stepTypeKey === 'interval') {
      assert.ok(isLap(st[i - 1]), 'etape precedente au lap');
      assert.strictEqual(st[i - 1].stepType.stepTypeKey, 'rest');
    }
  });
});

test('la recuperation entre les deux efforts dure exactement 30 min', () => {
  const st = steps();
  const a = st.findIndex(s => s.stepType.stepTypeKey === 'interval');
  const b = st.length - 1 - [...st].reverse().findIndex(s => s.stepType.stepTypeKey === 'interval');
  const between = st.slice(a + 1, b).filter(s => !isLap(s));
  assert.strictEqual(between.reduce((t, s) => t + s.endConditionValue, 0), 30 * 60);
  assert.strictEqual(between.length, 5);
});

test('retour au calme au lap, derniere etape ; ordre sequentiel', () => {
  const st = steps();
  const last = st[st.length - 1];
  assert.strictEqual(last.stepType.stepTypeKey, 'cooldown');
  assert.ok(isLap(last));
  st.forEach((s, i) => assert.strictEqual(s.stepOrder, i + 1));
});

test('variante de repli : mises en place en recup si "rest" est refuse', () => {
  const st = buildVmaTestWorkout({ restAsRecovery: true }).workoutSegments[0].workoutSteps;
  assert.ok(!st.some(s => s.stepType.stepTypeKey === 'rest'));
});

test('echauffement = UN seul bloc de 15 min, puis mise en place au lap ; 11 etapes au total', () => {
  const st = steps();
  assert.strictEqual(st[0].stepType.stepTypeKey, 'warmup');
  assert.strictEqual(st[0].endConditionValue, 15 * 60);
  assert.strictEqual(st.filter(s => s.stepType.stepTypeKey === 'warmup').length, 1);
  assert.strictEqual(st[1].stepType.stepTypeKey, 'rest');
  assert.strictEqual(st.length, 11);
});
