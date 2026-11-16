// Tests du moteur de prédiction Route (frontend/js/race_predictor.js)
const test = require('node:test');
const assert = require('node:assert');
const RP = require('../frontend/js/race_predictor.js');

const NOW = new Date('2026-11-16T00:00:00').getTime();
const DAY = 86400000;
const base = { nowMs: NOW, vo2max: 50, sex: 'M', races: [], activities: [] };

test('courbe continue : pas de rupture à 5 / 10 / 21,1 km', () => {
  for (const d of [5, 10, 21.1, 42.195]) {
    const a = RP.predictRoad({ ...base, distKm: d }).sec / d;
    const b = RP.predictRoad({ ...base, distKm: d * 1.01 }).sec / (d * 1.01);
    assert.ok(Math.abs(b / a - 1) < 0.005, `saut d'allure autour de ${d} km : ${(b / a - 1) * 100}%`);
  }
});

test('le temps augmente avec la distance, et diminue avec la VO2max', () => {
  const t = d => RP.predictRoad({ ...base, distKm: d }).sec;
  assert.ok(t(5) < t(10) && t(10) < t(21.1) && t(21.1) < t(42.195));
  const hi = RP.predictRoad({ ...base, distKm: 10, vo2max: 56 }).sec;
  assert.ok(hi < t(10));
});

test('le dénivelé ralentit la prédiction', () => {
  const flat = RP.predictRoad({ ...base, distKm: 20, dplusM: 0 }).sec;
  const hilly = RP.predictRoad({ ...base, distKm: 20, dplusM: 400 }).sec;
  assert.ok(hilly > flat);
});

test('sans course ni activité : confiance faible, fourchette large, explication', () => {
  const r = RP.predictRoad({ ...base, distKm: 21.1 });
  assert.strictEqual(r.confidence, 'low');
  assert.ok((r.highSec - r.lowSec) / r.sec > 0.15);
  assert.ok(r.factors.some(f => /VO2max/.test(f)));
  assert.strictEqual(r.voies.B, null);
});

test('une course récente de distance proche corrige un modèle physiologique trop optimiste', () => {
  // VO2max élevée mais chrono de semi lent : la performance observée doit tirer l'estimation vers le bas
  const phys = RP.predictRoad({ ...base, vo2max: 58, distKm: 21.1 }).sec;
  const races = [{ dateMs: NOW - 30 * DAY, distanceKm: 21.1, durationSec: 7200, type: 'route', elevationGain: 50 }];
  const r = RP.predictRoad({ ...base, vo2max: 58, distKm: 21.1, races });
  assert.ok(r.sec > phys, 'estimation non corrigée par la course récente');
  assert.ok(r.sec < 7200 * 1.02);
  assert.ok(['high', 'medium'].includes(r.confidence));
});

test('une course trop ancienne (> 12 mois) est ignorée', () => {
  const races = [{ dateMs: NOW - 500 * DAY, distanceKm: 10, durationSec: 2400, type: 'route', elevationGain: 10 }];
  const r = RP.predictRoad({ ...base, distKm: 10, races });
  assert.strictEqual(r.voies.B, null);
});

test('une course DNF ou trail n\'est jamais une référence', () => {
  const races = [
    { dateMs: NOW - 20 * DAY, distanceKm: 10, durationSec: 2000, type: 'route', dnf: true },
    { dateMs: NOW - 20 * DAY, distanceKm: 10, durationSec: 2000, type: 'trail', elevationGain: 10 },
  ];
  assert.strictEqual(RP.predictRoad({ ...base, distKm: 10, races }).voies.B, null);
});

test('aucune fuite du futur : une course postérieure à nowMs est ignorée', () => {
  const races = [{ dateMs: NOW + 5 * DAY, distanceKm: 10, durationSec: 2000, type: 'route', elevationGain: 10 }];
  assert.strictEqual(RP.predictRoad({ ...base, distKm: 10, races }).voies.B, null);
});

test('un effort récent soutenu plafonne une estimation plus lente (borne C)', () => {
  const acts = [];
  for (let i = 1; i <= 8; i++) acts.push({ dateMs: NOW - i * 20 * DAY, distanceKm: 8, durationSec: 3000, avgHR: 140, maxHR: 185, elevationGain: 20 });
  // effort dur : 10 km en 45 min à 92 % de la FC max
  acts.push({ dateMs: NOW - 10 * DAY, distanceKm: 10, durationSec: 2700, avgHR: 170, maxHR: 186, elevationGain: 30 });
  const r = RP.predictRoad({ ...base, vo2max: 44, distKm: 10, activities: acts });
  assert.ok(r.voies.C != null);
  assert.ok(r.sec <= r.voies.C);
});

test('une sortie facile n\'est pas prise pour un chrono maximal', () => {
  const acts = [];
  for (let i = 1; i <= 10; i++) acts.push({ dateMs: NOW - i * 5 * DAY, distanceKm: 10, durationSec: 3300, avgHR: 135, maxHR: 185, elevationGain: 20 });
  const r = RP.predictRoad({ ...base, distKm: 10, activities: acts });
  assert.strictEqual(r.voies.C, null);
});

test('désaccord fort entre les voies : fourchette élargie et mention', () => {
  const races = [{ dateMs: NOW - 20 * DAY, distanceKm: 10, durationSec: 4000, type: 'route', elevationGain: 10 }];
  const r = RP.predictRoad({ ...base, vo2max: 56, distKm: 10, races });
  assert.ok(r.factors.some(f => /divergent/.test(f)));
  assert.notStrictEqual(r.confidence, 'high');
});
