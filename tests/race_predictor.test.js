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

// ─── Projection de fin de plan (plan-1) ───────────────────────────────────────────────
const planBase = { weeksTotal: 12, weeksElapsed: 0, vo2Now: 50, vo2Peak: 50, historyDays: 1500, adherence: { score: 0.9 } };

test('plan : un coureur confirmé AU sommet n\'a aucune progression forcée (gain nul ou négatif)', () => {
  const p = RP.projectPlanGain(planBase);
  assert.ok(p.vo2GainPct <= 0.01, `gain ${p.vo2GainPct}`);
});

test('plan : plus la VO2max est sous le sommet personnel, plus la marge est grande', () => {
  const near = RP.projectPlanGain({ ...planBase, vo2Now: 49.5 }).vo2GainPct;
  const far = RP.projectPlanGain({ ...planBase, vo2Now: 45 }).vo2GainPct;
  assert.ok(far > near);
});

test('plan : séances manquées -> projection sans gain positif automatique', () => {
  const p = RP.projectPlanGain({ ...planBase, vo2Now: 45, weeksElapsed: 3, adherence: { score: 0.2 } });
  assert.ok(p.vo2GainPct <= 0.5, `gain ${p.vo2GainPct}`);
});

test('plan : 100 % d\'assiduité mais performances stagnantes -> pas d\'amélioration forcée', () => {
  // tendance observée nulle sur 6 semaines : la tendance pèse 6/14 et tire le gain vers 0
  const noTrend = RP.projectPlanGain({ ...planBase, vo2Now: 45, weeksElapsed: 6, vo2Start: 45, adherence: { score: 1 } }).vo2GainPct;
  const prior = RP.projectPlanGain({ ...planBase, vo2Now: 45, weeksElapsed: 6, adherence: { score: 1 } }).vo2GainPct;
  assert.ok(noTrend < prior);
});

test('plan : une charge très supérieure au plan plafonne le gain', () => {
  const ok = RP.projectPlanGain({ ...planBase, vo2Now: 44, adherence: { score: 0.95 } }).vo2GainPct;
  const over = RP.projectPlanGain({ ...planBase, vo2Now: 44, adherence: { score: 0.95, overload: true } }).vo2GainPct;
  assert.ok(over < ok);
});

test('plan : début de plan sans semaine écoulée -> provisoire, fourchette large', () => {
  const p = RP.projectPlanGain({ ...planBase, vo2Now: 46, adherence: { score: null } });
  assert.ok(p.factors.some(f => /provisoire/.test(f)));
  assert.ok(p.highFrac - p.lowFrac > 0.05);
});

test('plan : plan terminé -> aucune progression, aucune fourchette', () => {
  const p = RP.projectPlanGain({ ...planBase, weeksElapsed: 12 });
  assert.strictEqual(p.gainFrac, 0);
  assert.strictEqual(p.highFrac, p.lowFrac);
});

test('plan : un débutant a plus de marge qu\'un coureur confirmé (même écart au sommet)', () => {
  const nov = RP.projectPlanGain({ ...planBase, vo2Now: 42, vo2Peak: 42, historyDays: 100 }).vo2GainPct;
  const exp = RP.projectPlanGain({ ...planBase, vo2Now: 42, vo2Peak: 42, historyDays: 2000 }).vo2GainPct;
  assert.ok(nov > exp);
});

test('plan : la fourchette contient le gain central et s\'élargit avec les semaines restantes', () => {
  const short = RP.projectPlanGain({ ...planBase, weeksTotal: 4, vo2Now: 46 });
  const long = RP.projectPlanGain({ ...planBase, weeksTotal: 20, vo2Now: 46 });
  assert.ok(short.lowFrac <= short.gainFrac && short.gainFrac <= short.highFrac);
  assert.ok((long.highFrac - long.lowFrac) > (short.highFrac - short.lowFrac));
});

// --- Trail (trail-1) ---------------------------------------------------------
test('trail : le D+ allonge le temps, 1 m de D+ pèse plus qu\'en route', () => {
  const vma = 15;
  const flat = RP.timeFromVmaTrail(20, 0, vma), hilly = RP.timeFromVmaTrail(20, 800, vma);
  assert.ok(hilly > flat * 1.3);
  assert.ok(hilly > RP.timeFromVma(20, 800, vma));
});

test('trail : coefficient personnel nul sans course, borné et atténué avec peu de courses', () => {
  const now = Date.UTC(2026, 10, 1);
  const base = { distKm: 25, dplusM: 700, nowMs: now, vo2max: 50, sex: 'M' };
  const none = RP.predictTrail({ ...base, races: [] });
  assert.equal(none.personalFactor, 1);
  assert.equal(none.confidence, 'low');
  const vma = (50 - 3.5) * 0.313;
  const model = RP.timeFromVmaTrail(20, 500, vma);
  const slowRace = { dateMs: now - 90 * 86400000, distanceKm: 20, durationSec: model * 1.3, type: 'trail', elevationGain: 500, vo2max: 50 };
  const one = RP.predictTrail({ ...base, races: [slowRace] });
  assert.ok(one.personalFactor > 1 && one.personalFactor < 1.2);
  const two = RP.predictTrail({ ...base, races: [slowRace, { ...slowRace, dateMs: now - 200 * 86400000 }] });
  assert.ok(two.personalFactor > one.personalFactor);
  assert.equal(two.confidence, 'medium');
});

test('trail : terrain de montagne = confiance faible et fourchette élargie vers le haut', () => {
  const r = RP.predictTrail({ distKm: 34, dplusM: 1700, nowMs: Date.UTC(2026, 10, 1), vo2max: 49, sex: 'M', races: [] });
  assert.equal(r.confidence, 'low');
  assert.ok((r.highSec - r.sec) > (r.sec - r.lowSec) * 1.5);
  assert.ok(r.factors.some(f => /montagne/.test(f)));
});
