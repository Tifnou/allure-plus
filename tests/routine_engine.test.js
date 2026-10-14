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

// ─── P3 : variantes vert / jaune / orange / rouge ────────────────────────
const WK = { phase: 'S2', cap: 2, level: 3, caution: false, maxMin: 120, warnings: [], otherTiers: [], locked: false };
const snapOf = id => { const m = byId[id]; return { modelId: id, role: m.role, wuCd: m.wuCd, dsl: m.dsl, baseDsl: m.dsl, variant: 'yellow' }; };
const V = (id, wk = WK) => Object.fromEntries(E.routineBuildVariants(snapOf(id), wk).map(v => [v.variant, v]));

test('variantes : vert < jaune < orange < rouge en charge, jaune = fiche telle quelle', () => {
  const v = V('A03-01');   // S60 3×6
  assert.equal(v.yellow.dsl, byId['A03-01'].dsl);
  assert.ok(v.green.load < v.yellow.load && v.yellow.load < v.orange.load && v.orange.load < v.red.load);
  assert.ok(v.green.totalMin < v.yellow.totalMin && v.orange.totalMin > v.yellow.totalMin);
  assert.ok(v.green.dsl.includes('2x(6m S60)') && v.orange.dsl.includes('4x(6m S60)'), `${v.green.dsl} / ${v.orange.dsl}`);
});

test('variantes : la nature de la séance ne change jamais (mêmes codes d\'allure)', () => {
  const { routineParseDsl } = require('../frontend/js/routine_catalog.js');
  const codes = dsl => JSON.stringify([...new Set(JSON.stringify(routineParseDsl(dsl)).match(/"code":"[A-Z0-9]+"/g))].sort());
  for (const m of ROUTINE_CATALOG) {
    for (const v of E.routineBuildVariants(snapOf(m.id), WK)) assert.equal(codes(v.dsl), codes(m.dsl), `${m.id} ${v.variant}`);
  }
});

test('variantes : échauffement et retour au calme jamais modifiés, aucune récup fantôme', () => {
  const { compileRoutineDsl } = require('../frontend/js/routine_catalog.js');
  for (const m of ROUTINE_CATALOG) {
    const base = compileRoutineDsl(m.dsl, { wuCd: m.wuCd });
    for (const v of E.routineBuildVariants(snapOf(m.id), WK)) {
      const c = compileRoutineDsl(v.dsl, { wuCd: m.wuCd });       // doit compiler
      if (base.hasQuality) {
        assert.equal(c.steps[c.steps.length - 1].role, 'cooldown', `${m.id} ${v.variant}`);
        assert.equal(c.steps[c.steps.length - 1].sec, base.steps[base.steps.length - 1].sec, `${m.id} ${v.variant} : retour au calme modifié`);
        assert.equal(c.steps[0].sec, base.steps[0].sec, `${m.id} ${v.variant} : échauffement modifié`);
      }
    }
  }
});

test('variantes : plafonds respectés et temps disponible', () => {
  for (const m of ROUTINE_CATALOG) {
    for (const v of E.routineBuildVariants(snapOf(m.id), { ...WK, maxMin: 90 })) {
      if (v.variant === 'yellow' || !v.available) continue;
      assert.ok(v.totalMin <= 90 || v.variant === 'green', `${m.id} ${v.variant} : ${v.totalMin} min > 90`);
      const l = E.routineLoadOfDsl(v.dsl, m.wuCd);
      Object.entries(l.counts).forEach(([k, sec]) => { if (v.variant !== 'green') assert.ok(sec / 60 <= (E.ROUTINE_WORK_CAP_MIN[k] || 1e9), `${m.id} ${v.variant} ${k}`); });
    }
  }
});

test('rouge : verrouillé hors niveau 3, hors S2/S3, avec gêne, en S4 ; orange aussi bloqué en S4 / gêne', () => {
  assert.equal(V('A03-01', { ...WK, level: 2 }).red.available, false);
  assert.equal(V('A03-01', { ...WK, phase: 'S1' }).red.available, false);
  assert.equal(V('A03-01', { ...WK, phase: 'S4' }).orange.available, false);
  assert.equal(V('A03-01', { ...WK, phase: 'S4' }).green.available, true);
  const c = V('A03-01', { ...WK, caution: true });
  assert.equal(c.orange.available, false); assert.equal(c.red.available, false); assert.equal(c.green.available, true);
  assert.equal(V('A03-01', { ...WK, cap: 1 }).red.available, false);
  assert.equal(V('A03-01', { ...WK, warnings: ['x'] }).red.available, false);
  assert.ok(V('A03-01').red.available);
});

test('une seule séance très exigeante par semaine, variantes comprises', () => {
  const v = V('A03-02', { ...WK, otherTiers: [2] });     // S60 3×8 : orange/rouge passeraient palier dur
  assert.equal(v.red.available, false);
});

test('séance d\'endurance : volume ±10 min, jamais de rouge ; semaine passée : tout verrouillé sauf le choix actuel', () => {
  const v = V('A01-03');
  assert.equal(v.red.available, false);
  assert.equal(v.green.totalMin, 40); assert.equal(v.orange.totalMin, 60);
  const l = V('A03-01', { ...WK, locked: true });
  assert.equal(l.green.available, false); assert.equal(l.orange.available, false); assert.equal(l.yellow.selected, true);
});

test('semaine plus chargée que prévu → palier suivant ramené d\'un cran, jamais de rattrapage après du vert', () => {
  const p = PROFILES[1];
  const normal = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [] });
  const apres = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], prevExcess: 0.3 });
  assert.equal(apres.target, normal.target - 1);
  const apresVert = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], prevExcess: -0.2 });
  assert.equal(apresVert.target, normal.target);
  const w = [{ ...snapOf('A03-01'), variant: 'orange', dsl: V('A03-01').orange.dsl }];
  assert.ok(E.routineWeekExcess(w).excessPct > 0.2);
  assert.equal(E.routineWeekExcess([snapOf('A03-01')]).excessPct, 0);
});

test('gêne signalée : la génération reste au palier modéré', () => {
  const p = PROFILES[1];
  const w = E.routineGenerateWeek(p.prefs, 3, { ...p.ctx, history: [], caution: true });
  assert.ok(w.sessions.every(s => s.tier <= 1));
  assert.equal(w.caution, true);
});

test('trail : les 7 familles route restent fermées par défaut, s\'ouvrent avec le réglage Admin', () => {
  const p = PROFILES[5];
  const ROAD_ONLY = ['03', '04', '05', '07', '08', '09', '10'];
  const closed = simulate(p.prefs, p.ctx, 24).flatMap(w => w.sessions);
  assert.ok(closed.every(s => !ROAD_ONLY.includes(s.family)), 'aucune famille route en trail par défaut');
  const opened = simulate(p.prefs, { ...p.ctx, trailRoadFamilies: true }, 24).flatMap(w => w.sessions);
  assert.ok(opened.some(s => ROAD_ONLY.includes(s.family)), 'avec le réglage, des familles route apparaissent');
  opened.forEach(s => assert.ok(byId[s.modelId].terrain.includes('trail') || byId[s.modelId].trailReopenable));
});

// ─── P2 : plan Allure+ à venir, course envisagée ─────────────────────────
function simulateToPlan(prefs, ctx, plan, totalWeeks = 26) {
  // le plan démarre à la semaine `totalWeeks + 1` : la routine génère les semaines 1..totalWeeks
  const out = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const history = out.map(o => ({ age: w - o.weekNum, sessions: o.sessions.map(s => ({ modelId: s.modelId, slot: s.slot, family: s.family })) }));
    out.push(E.routineGenerateWeek(prefs, w, { ...ctx, history, plan: { ...plan, weeksToStart: totalWeeks + 1 - w } }));
  }
  return out;
}
const PLAN10K = { name: '10 km juin 2027', totalWeeks: 10, week1Min: 180, longestMin: 70, sessionsPerWeek: 4, isTrail: false, targetKey: '10k' };

test('plan à venir : dernière semaine = transition allégée (S4), avant-dernière sans palier dur', () => {
  for (const p of [PROFILES[0], PROFILES[1], PROFILES[2]]) {
    const w = simulateToPlan(p.prefs, p.ctx, PLAN10K);
    const last = w[w.length - 1], before = w[w.length - 2];
    assert.equal(last.phase, 'S4'); assert.equal(last.plan.transition, true);
    assert.ok(last.sessions.every(s => s.tier <= 0), 'dernière semaine : rien au-dessus du palier léger');
    assert.ok(before.sessions.every(s => s.tier <= 1), 'avant-dernière : pas de palier dur');
    assert.equal(before.plan.horizon, 'final');
  }
});

test('plan à venir : pas de palier dur ni de famille nouvelle dans les dernières semaines', () => {
  const p = PROFILES[1];
  const w = simulateToPlan(p.prefs, p.ctx, PLAN10K);
  const close = w.filter(x => ['close', 'final'].includes(x.plan.horizon));
  assert.ok(close.length >= 3);
  close.forEach(x => assert.ok(x.sessions.every(s => s.tier <= 1), `S${x.weekNum} ${x.plan.horizon}`));
  // familles de qualité déjà pratiquées dans les 12 semaines précédentes
  close.forEach(x => {
    const seen = new Set(w.filter(o => o.weekNum < x.weekNum && x.weekNum - o.weekNum <= 12).flatMap(o => o.sessions.map(s => s.family)));
    const q1 = x.sessions.find(s => s.slot === 'Q1');
    if (q1 && seen.size) assert.ok(seen.has(q1.family), `S${x.weekNum} : famille ${q1.family} jamais pratiquée`);
  });
});

test('plan à venir : horizon long = cycle normal (palier dur possible en S3)', () => {
  const w = simulateToPlan(PROFILES[1].prefs, PROFILES[1].ctx, PLAN10K);
  const longWeeks = w.filter(x => x.plan.horizon === 'long' && x.phase === 'S3');
  assert.ok(longWeeks.length >= 2);
  assert.ok(longWeeks.some(x => x.sessions.some(s => s.tier >= 2)), 'le palier dur reste possible loin du plan');
});

test('plan à venir : l\'horizon intermédiaire oriente vers les qualités du plan', () => {
  const FAV = E.ROUTINE_TARGET_FAMILIES['10k'];
  const share = weeks => { const q = weeks.flatMap(x => x.sessions.filter(s => s.slot === 'Q1')); return q.filter(s => FAV.includes(s.family)).length / q.length; };
  const inter = [], base = [];
  for (let n = 0; n < 6; n++) {                       // plusieurs ancrages pour lisser le hasard
    const prefs = { ...PROFILES[1].prefs, anchorMonday: 1700000000000 + n * 86400000 * 7 };
    const w = simulateToPlan(prefs, PROFILES[1].ctx, PLAN10K, 24);
    const none = simulate(prefs, PROFILES[1].ctx, 24);
    inter.push(...w.filter(x => x.plan.horizon === 'intermediate'));
    base.push(...none.filter(x => 24 + 1 - x.weekNum <= 6 && 24 + 1 - x.weekNum > 3));
  }
  assert.ok(share(inter) >= share(base), `orienté ${share(inter)} vs neutre ${share(base)}`);
});

test('horizons : un plan court ou une 1re semaine très chargée changent les seuils (pas de 4/8 figé)', () => {
  const base = E.routinePlanHorizon(5, { totalWeeks: 12, week1Min: 150 }, { weeklyMin: 150 });
  const court = E.routinePlanHorizon(5, { totalWeeks: 6, week1Min: 150 }, { weeklyMin: 150 });
  const gros = E.routinePlanHorizon(5, { totalWeeks: 12, week1Min: 300 }, { weeklyMin: 150 });
  assert.equal(base.name, 'intermediate');
  assert.ok(court.bounds.long < base.bounds.long);
  assert.ok(gros.bounds.close > base.bounds.close && gros.bounds.inter > base.bounds.inter);
  assert.equal(E.routinePlanHorizon(1, {}, {}).name, 'final');
  assert.equal(E.routinePlanHorizon(2, {}, {}).name, 'final');
  assert.equal(E.routinePlanHorizon(20, {}, {}).name, 'long');
});

test('plan à venir : messages utiles (séances/semaine, trail, volume)', () => {
  const p = PROFILES[0];
  const w = E.routineGenerateWeek(p.prefs, 5, { ...p.ctx, weeklyMin: 100, history: [], plan: { ...PLAN10K, sessionsPerWeek: 5, week1Min: 260, isTrail: true, weeksToStart: 4 } });
  const txt = w.notes.join(' | ');
  assert.match(txt, /5 séances par semaine/);
  assert.match(txt, /plan Trail/);
  assert.match(txt, /plus chargée/);
});

test('course envisagée sans plan : conseil de calendrier, jamais de transition', () => {
  const p = PROFILES[0];
  const proche = E.routineGenerateWeek(p.prefs, 5, { ...p.ctx, history: [], race: { name: 'Corrida', weeksToRace: 9, targetKey: '10k' } });
  assert.equal(proche.race.recommendNow, true);
  assert.match(proche.notes.join(' '), /bon moment de charger un plan/);
  const loin = E.routineGenerateWeek(p.prefs, 5, { ...p.ctx, history: [], race: { weeksToRace: 40, targetKey: '10k' } });
  assert.equal(loin.race.recommendNow, false);
  assert.equal(loin.plan, null);
  assert.equal(E.routineRaceAdvice(30, 'marathon').weeksUntilPlan, 14);
});

test('plan déjà démarré (weeksToStart <= 0) : le moteur ne le traite pas comme une pré-préparation', () => {
  const p = PROFILES[0];
  const w = E.routineGenerateWeek(p.prefs, 5, { ...p.ctx, history: [], plan: { ...PLAN10K, weeksToStart: 0 } });
  assert.equal(w.plan, null);
});
