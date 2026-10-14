// Tests du moteur de routines hors plan (lot P1). Lancer : node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../frontend/js/routine_engine.js');
const { ROUTINE_CATALOG } = require('../frontend/js/routine_catalog.js');

const byId = Object.fromEntries(ROUTINE_CATALOG.map(m => [m.id, m]));
const DAY = 86400000;

// Simule N semaines en réinjectant l'historique, comme le fait l'application.
function simulate(prefs, ctx, weeks = 24) {
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const history = out.map((o, i) => ({ age: w - o.weekNum, sessions: o.sessions.map(s => ({ modelId: s.modelId, slot: s.slot, family: s.family })) }));
    out.push(E.routineGenerateWeek(prefs, w, { ...ctx, history }));
  }
  return out;
}

const PROFILES = [
  { name: 'route 3x niveau 2', prefs: { terrain: 'route', frequency: 3, maxMin: 90, anchorMonday: 1700000000000 }, ctx: { level: 2, efTarget: 45, slTarget: 75 } },
  { name: 'route 4x niveau 3', prefs: { terrain: 'route', frequency: 4, maxMin: 120, anchorMonday: 1700000000000 }, ctx: { level: 3, efTarget: 50, slTarget: 90 } },
  { name: 'route 5x niveau 2', prefs: { terrain: 'route', frequency: 5, maxMin: 90, anchorMonday: 1700000000000 }, ctx: { level: 2, efTarget: 45, slTarget: 75 } },
  { name: 'route 2x niveau 1', prefs: { terrain: 'route', frequency: 2, maxMin: 60, anchorMonday: 1700000000000 }, ctx: { level: 1, efTarget: 35, slTarget: 60 } },
  { name: 'trail 3x niveau 2', prefs: { terrain: 'trail', frequency: 3, maxMin: 90, anchorMonday: 1700000000000 }, ctx: { level: 2, efTarget: 45, slTarget: 75 } },
  { name: 'trail 4x niveau 3', prefs: { terrain: 'trail', frequency: 4, maxMin: 120, anchorMonday: 1700000000000 }, ctx: { level: 3, efTarget: 50, slTarget: 90 } },
  { name: 'route 6x niveau 3', prefs: { terrain: 'route', frequency: 6, maxMin: 120, anchorMonday: 1700000000000 }, ctx: { level: 3, efTarget: 50, slTarget: 90 } },
];

for (const p of PROFILES) {
  test(`invariants de sécurité — ${p.name}`, () => {
    const weeks = simulate(p.prefs, p.ctx);
    const wantTerrain = p.prefs.terrain === 'trail' ? 'trail' : 'road';
    weeks.forEach(w => {
      assert.equal(w.sessions.length, p.prefs.frequency, `S${w.weekNum} : nombre de séances`);
      assert.equal(w.sessions[w.sessions.length - 1].slot, 'SL', `S${w.weekNum} : la sortie longue ferme la semaine`);
      assert.ok(w.hardCount <= 1, `S${w.weekNum} : une seule séance très exigeante`);
      const qual = w.sessions.filter(s => s.role !== 'ef' && s.qualitySec > 0).length;
      assert.ok(qual <= 2, `S${w.weekNum} : au plus 2 séances de qualité (SL active comprise), trouvé ${qual}`);
      w.sessions.forEach(s => {
        const m = byId[s.modelId];
        assert.ok(m.terrain.includes(wantTerrain), `${s.modelId} interdit en ${wantTerrain}`);
        assert.ok(s.totalSec / 60 <= p.prefs.maxMin + 0.01, `${s.modelId} dépasse le temps disponible`);
        if (p.ctx.level <= 1) assert.ok(!['04', '05', '09'].includes(m.family), `${s.modelId} trop intense pour le niveau 1`);
        if (p.ctx.level <= 2) assert.ok(!(['04', '05', '09'].includes(m.family) && s.tier >= 2), `${s.modelId} palier dur réservé au niveau 3`);
      });
      if (w.phase === 'S4') {
        assert.ok(w.sessions.every(s => s.tier <= 0), `S${w.weekNum} (S4) : rien au-dessus du palier léger`);
        const q = w.sessions.filter(s => s.role !== 'ef' && s.qualitySec > 0);
        assert.ok(q.length <= 1, `S${w.weekNum} (S4) : au plus un rappel court`);
      }
    });
  });
}

test('progression S1 → S3 : le palier monte (niveau 3)', () => {
  const weeks = simulate(PROFILES[1].prefs, PROFILES[1].ctx, 8);
  const tierOfQ1 = w => w.sessions.find(s => s.slot === 'Q1').tier;
  for (let b = 0; b < 2; b++) {
    const [s1, s2, s3] = [weeks[b * 4], weeks[b * 4 + 1], weeks[b * 4 + 2]].map(tierOfQ1);
    assert.ok(s1 <= s2 && s2 <= s3, `bloc ${b + 1} : ${s1} ${s2} ${s3}`);
    assert.equal(s3, 2);
  }
});

test('variété : pas la même séance de qualité deux semaines de suite, et un bon éventail de fiches', () => {
  const weeks = simulate(PROFILES[0].prefs, PROFILES[0].ctx, 24);
  const q1 = weeks.map(w => (w.sessions.find(s => s.slot === 'Q1') || {}).modelId);
  q1.forEach((id, i) => { if (i > 0) assert.notEqual(id, q1[i - 1], `S${i + 1} répète ${id}`); });
  const distinct = new Set(q1).size;
  assert.ok(distinct >= 12, `seulement ${distinct} fiches différentes sur 24 semaines`);
});

test('déterministe : mêmes entrées, mêmes séances', () => {
  const a = simulate(PROFILES[2].prefs, PROFILES[2].ctx, 12).map(w => w.sessions.map(s => s.modelId));
  const b = simulate(PROFILES[2].prefs, PROFILES[2].ctx, 12).map(w => w.sessions.map(s => s.modelId));
  assert.deepEqual(a, b);
});

test('charge hors course élevée : la qualité est plafonnée', () => {
  const p = PROFILES[1];
  const w3 = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], otherMin7: 520 });   // S3, normalement dur
  assert.equal(w3.cap, 0);
  assert.ok(w3.sessions.every(s => s.tier <= 0));
  assert.ok(w3.warnings.length > 0);
  const w3b = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], otherMin7: 350 });
  assert.ok(w3b.sessions.every(s => s.tier <= 1));
});

test('séance dure très récente : pas de palier dur', () => {
  const p = PROFILES[1];
  const w = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], hoursSinceLongRun: 20 });
  assert.ok(w.sessions.every(s => s.tier <= 1));
});

test('sortie longue : durée proche du volume habituel, plus courte en S4', () => {
  const p = PROFILES[1];
  const dur = n => E.routineGenerateWeek(p.prefs, n, { ...p.ctx, history: [] }).sessions.find(s => s.slot === 'SL').totalSec / 60;
  assert.ok(Math.abs(dur(1) - 90) <= 20);
  assert.ok(dur(4) <= dur(1), `S4 ${dur(4)} min doit rester <= S1 ${dur(1)} min`);
});

test('évaluation du profil depuis les activités Garmin', () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const mk = (daysAgo, min, type = 'running') => ({ date: now - daysAgo * DAY, durationSec: min * 60, activityType: type });
  const debutant = E.routineAssessProfile([mk(3, 30), mk(12, 25), mk(25, 35)], now);
  assert.equal(debutant.level, 1);
  const regulier = E.routineAssessProfile([...[2, 5, 9, 12, 16, 19, 23, 26, 30, 33].map(d => mk(d, 45)), mk(6, 80)], now);
  assert.ok(regulier.level >= 2, 'régulier : niveau 2 ou plus');
  assert.ok(regulier.efTarget >= 40 && regulier.efTarget <= 50);
  const confirme = E.routineAssessProfile([...Array.from({ length: 24 }, (_, i) => mk(1 + i * 1.7, 55)), mk(8, 100)], now);
  assert.equal(confirme.level, 3);
  const velo = E.routineAssessProfile([mk(1, 90, 'cycling'), mk(3, 60, 'strength_training'), mk(4, 40, 'running')], now);
  assert.equal(velo.otherMin7, 150);
  assert.equal(velo.hasData, false);
});

test('description lisible', () => {
  assert.equal(E.routineDescribe('15m EF + 3x(6m TEMPO) r2m EF + 10m EF'), '15 min EF → 3 × (6 min Tempo), récup 2 min EF → 10 min EF');
});
