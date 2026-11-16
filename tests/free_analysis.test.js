const test = require('node:test');
const assert = require('node:assert');
const FA = require('../frontend/js/free_analysis.js');
const RP = require('../frontend/js/race_predictor.js');

// série 60 min à 3 m/s ; FC dérive de 140 à 140+drift
function series(totalSec, hrStart, hrEnd, gap = 3) {
  const s = [];
  for (let t = 0; t <= totalSec; t += 5) s.push({ sec: t, movingSec: t, speedMps: gap, gapMps: gap, hr: hrStart + (hrEnd - hrStart) * t / totalSec, distKm: gap * t / 1000, alt: 10 });
  return s;
}

test('dérive cardiaque : FC stable = découplage ~0, FC qui monte = positif', () => {
  const flat = FA.computeCardiacDrift(series(3600, 140, 140));
  assert.ok(flat.ok); assert.ok(Math.abs(flat.decouplingPct) < 0.5); assert.equal(flat.level, 'excellent');
  const drift = FA.computeCardiacDrift(series(3600, 135, 155));
  assert.ok(drift.ok); assert.ok(drift.decouplingPct > 5);
});

test('dérive cardiaque : sortie courte ou variable = refus explicite, pas de chiffre', () => {
  assert.equal(FA.computeCardiacDrift(series(900, 140, 150)).ok, false);
  const v = series(3600, 140, 150).map((p, i) => ({ ...p, gapMps: (i % 120 < 60) ? 2.0 : 4.2, speedMps: (i % 120 < 60) ? 2.0 : 4.2 }));
  const r = FA.computeCardiacDrift(v);
  assert.equal(r.ok, false); assert.ok(r.why);
});

test('efficacité : comparaison à FC comparable, minimum d\'échantillons', () => {
  const now = Date.parse('2026-11-16T10:00:00');
  const mk = (id, daysAgo, pace, hr) => ({ id, date: new Date(now - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' '), activityType: 'running', distanceKm: 10, durationSec: pace * 10, avgHR: hr, elevationGain: 50 });
  const act = mk(1, 0, 360, 145);
  assert.equal(FA.compareEfficiency(act, [mk(2, 7, 370, 143)], now).enough, false);
  const peers = [2, 3, 4, 5, 6].map(i => mk(i, i * 7, 372, 145 + (i % 2)));
  const r = FA.compareEfficiency(act, peers, now);
  assert.ok(r.enough); assert.equal(r.verdict, 'hausse'); assert.ok(r.deltaPct > 2);
  const far = [2, 3, 4, 5, 6].map(i => mk(i, i * 7, 372, 175));
  assert.equal(FA.compareEfficiency(act, far, now).enough, false); // FC non comparable
});

const lap = (i, spd, extra = {}) => ({ distance: 1000, duration: 1000 / spd, elapsedDuration: 1000 / spd, movingDuration: 1000 / spd, averageSpeed: spd, avgGradeAdjustedSpeed: spd, averageHR: 140, ...extra });

test('régularité : GAP neutralise le dénivelé, split négatif détecté', () => {
  const laps = [3, 3, 3, 3, 3, 3].map((s, i) => lap(i, s, { averageSpeed: s * (i % 2 ? 0.85 : 1.1) }));
  const r = FA.computeRegularity(laps);
  assert.equal(r.basis, 'GAP'); assert.ok(r.cvPct < 0.5); assert.equal(r.splitKind, 'stable');
  const neg = FA.computeRegularity([2.8, 2.9, 3.0, 3.1, 3.2, 3.3].map((s, i) => lap(i, s)));
  assert.equal(neg.splitKind, 'negatif');
});

test('technique : fatigue = cadence qui chute / contact qui s\'allonge', () => {
  const laps = [0, 1, 2, 3, 4, 5].map(i => lap(i, 3, { averageRunCadence: 170 - i, groundContactTime: 240 + i * 4, strideLength: 110, verticalOscillation: 8.5, verticalRatio: 7.5 }));
  const t = FA.computeTechnique(laps);
  assert.ok(t.cadence.delta <= -3); assert.ok(t.gct.delta >= 8); assert.equal(t.fatigue.length, 2);
  assert.equal(FA.computeTechnique([lap(0, 3), lap(1, 3), lap(2, 3)]), null);
});

test('puissance : indice de variabilité et dérive', () => {
  const laps = [0, 1, 2, 3, 4, 5].map(i => lap(i, 3, { averagePower: 300 - i * 5, normalizedPower: 305 - i * 5 }));
  const p = FA.computePower(laps);
  assert.ok(p.vi > 1 && p.vi < 1.05); assert.ok(p.deltaPct < 0);
});

test('équivalent course : seulement pour un effort maximal soutenu', () => {
  const act = { distanceKm: 10, durationSec: 2700, avgHR: 175, elevationGain: 0 };
  const hi = FA.equivalentRace(act, 190, 21.0975, RP, 0);
  assert.ok(hi.applicable); assert.ok(hi.sec > 2700 * 2.1);
  const lo = FA.equivalentRace({ ...act, avgHR: 140 }, 190, 21.0975, RP, 0);
  assert.equal(lo.applicable, false);
});

test('bilan : phrase sans note chiffrée, signale les points à surveiller', () => {
  const laps = [0, 1, 2, 3, 4, 5].map(i => lap(i, 3, { averageRunCadence: 170 - 2 * i, groundContactTime: 240 + 5 * i }));
  const f = FA.analyze({ activity: { id: 1, date: '2026-11-15 08:00:00', activityType: 'running', distanceKm: 6, durationSec: 2000, avgHR: 140, elevationGain: 0 }, laps, series: null, allActivities: [], nowMs: Date.parse('2026-11-16'), hrMax: 190, RP });
  assert.match(f.bilan, /Sortie endurance fondamentale/); assert.match(f.bilan, /À surveiller/);
});
