const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../frontend/js/routine_share.js');
const { compileRoutineDsl } = require('../frontend/js/routine_catalog.js');

const DAY = 86400000, WEEK = 7 * DAY;
const MON = new Date(2026, 10, 2).getTime();            // lundi 2 nov. 2026 (heure locale)
const NOW = MON + 2 * DAY;                              // mercredi de cette semaine

const loadOf = () => ({ tier: 1, load: 70, totalSec: 3000, qualitySec: 1200 });
const snap = (id, dsl, extra = {}) => ({ slot: 'Q1', modelId: id, name: 'Séance ' + id, dsl, baseDsl: dsl, family: '03', role: 'quality', wuCd: true, terrain: 'route', variant: 'yellow', ...extra });
const week = (phase, sessions, extra = {}) => ({ phase, phaseIdx: 0, sessions, macro: { cycleIdx: 0, phaseName: 'Reprise', themeLabel: 'Seuil', targetLabel: 'polyvalent', why: 'test' }, ...extra });

test('publication : fiche de BASE (jamais la variante), pas de semaine passée ni de semaine reçue', () => {
  const store = { v: 2, weeks: {
    [MON - 2 * WEEK]: week('S1', [snap('A', '15m EF + 3x(6m S60) r2m EF + 10m EF')]),
    [MON]: week('S2', [snap('B', '15m EF + 5x(6m S60_P3) r2m EF + 10m EF', { baseDsl: '15m EF + 3x(6m S60) r2m EF + 10m EF', variant: 'orange', lever: 'both' })]),
    [MON + WEEK]: week('S3', [snap('C', '10m EF')], { shared: true }),
    [MON + 2 * WEEK]: week('S4', [snap('D', '10m EF')]),
  } };
  const p = S.buildSharePayload(store, NOW, loadOf, { fromName: 'Stéph<an>e', terrain: 'route', frequency: 3 });
  assert.equal(p.weeks.length, 2);
  assert.deepEqual(p.weeks.map(w => w.weekMs), [MON, MON + 2 * WEEK]);
  const s = p.weeks[0].sessions[0];
  assert.equal(s.dsl, '15m EF + 3x(6m S60) r2m EF + 10m EF');
  assert.ok(!('variant' in s) && !('lever' in s));
  assert.equal(p.fromName, 'Stéphane');                                   // balises retirées
});

test('fusion : une semaine suit l\'animateur sauf si une séance y est pointée', () => {
  const payload = { weeks: [
    { weekMs: MON, phase: 'S2', sessions: [{ modelId: 'A03-01', dsl: '15m EF + 3x(6m S60) r2m EF + 10m EF', role: 'quality', tier: 1, load: 70, totalSec: 2820, qualitySec: 1080 }] },
    { weekMs: MON + WEEK, phase: 'S3', sessions: [{ modelId: 'A03-02', dsl: '15m EF + 2x(10m S60) r3m EF + 10m EF', role: 'quality', tier: 2, load: 90, totalSec: 3300, qualitySec: 1200 }] },
  ] };
  const touched = new Set([MON]);                                         // semaine en cours : séance déjà pointée
  const store = { v: 2, weeks: { [MON]: week('S1', [snap('X', '10m EF')]), [MON + WEEK]: week('S1', [snap('Y', '10m EF')]) } };
  const ctx = { now: NOW, anchorMonday: MON, from: 'a@b.fr', fromName: 'Stéphane', isTouched: k => touched.has(k), level: 2, cap: 2, compile: compileRoutineDsl, nameOf: () => null };
  const r = S.applySharedWeeks(store, payload, ctx);
  assert.deepEqual(r.kept, [MON]);                                        // intouchable
  assert.deepEqual(r.applied, [MON + WEEK]);                              // remplacée
  assert.equal(store.weeks[MON].sessions[0].modelId, 'X');
  const w = store.weeks[MON + WEEK];
  assert.equal(w.shared, true);
  assert.equal(w.sessions[0].modelId, 'A03-02');
  assert.equal(w.sessions[0].variant, 'yellow');
  assert.equal(w.sessions[0].trainingIndex, 0);
});

test('fusion : jamais de semaine passée, DSL invalide ignoré, semaine retirée par l\'animateur supprimée si intacte', () => {
  const ok = { modelId: 'A', dsl: '20m EF', role: 'ef', tier: 0, load: 10, totalSec: 1200, qualitySec: 0 };
  const payload = { weeks: [
    { weekMs: MON - 2 * WEEK, phase: 'S1', sessions: [ok] },                                  // passée
    { weekMs: MON + WEEK, phase: 'S2', sessions: [{ ...ok, dsl: '12m XYZ' }, ok] },            // une fiche invalide
  ] };
  const store = { v: 2, weeks: { [MON + 2 * WEEK]: { ...week('S3', [snap('Z', '10m EF')]), shared: true }, [MON + 3 * WEEK]: { ...week('S4', [snap('T', '10m EF')]), shared: true } } };
  const touched = new Set([MON + 3 * WEEK]);
  const r = S.applySharedWeeks(store, payload, { now: NOW, anchorMonday: MON, from: 'a@b.fr', isTouched: k => touched.has(k), level: 2, cap: 2, compile: compileRoutineDsl, nameOf: () => null });
  assert.equal(store.weeks[MON - 2 * WEEK], undefined);
  assert.equal(store.weeks[MON + WEEK].sessions.length, 1);
  assert.deepEqual(r.removed, [MON + 2 * WEEK]);                          // intacte : retirée
  assert.ok(store.weeks[MON + 3 * WEEK]);                                 // touchée : gardée
});

test('fusion : la semaine en cours n\'est jamais retirée même si l\'animateur ne la publie plus', () => {
  const store = { v: 2, weeks: { [MON]: { ...week('S2', [snap('Z', '10m EF')]), shared: true } } };
  const r = S.applySharedWeeks(store, { weeks: [] }, { now: NOW, anchorMonday: MON, from: 'a@b.fr', isTouched: () => false, compile: compileRoutineDsl });
  assert.deepEqual(r.removed, []);
  assert.ok(store.weeks[MON]);
});

test('clé de semaine : aligne le lundi de l\'animateur sur l\'ancre du suiveur (dérive d\'heure d\'été comprise)', () => {
  const anchor = MON - 10 * WEEK;                                         // traverse le changement d'heure d'octobre
  const leaderMon = new Date(2026, 10, 9).getTime();
  const { n, key } = S.routineShareKeyFor(anchor, leaderMon);
  assert.equal(n, 12);
  assert.ok(Math.abs(key - leaderMon) <= 2 * 3600000);
});

test('quitter : retire les semaines partagées à venir intactes, garde la semaine en cours et les touchées', () => {
  const store = { v: 2, weeks: {
    [MON]: { ...week('S2', [snap('a', '10m EF')]), shared: true },
    [MON + WEEK]: { ...week('S3', [snap('b', '10m EF')]), shared: true },
    [MON + 2 * WEEK]: { ...week('S4', [snap('c', '10m EF')]), shared: true },
    [MON + 3 * WEEK]: week('S1', [snap('d', '10m EF')]),
  } };
  const removed = S.leaveSharedWeeks(store, NOW, k => k === MON + 2 * WEEK);
  assert.deepEqual(removed, [MON + WEEK]);
  assert.ok(store.weeks[MON] && store.weeks[MON + 2 * WEEK] && store.weeks[MON + 3 * WEEK]);
});

test('invitation : on propose une fois, on applique les mises à jour, on ne reharcèle pas', () => {
  const inbox = { offered: true, since: 's1', updatedAt: '2026-11-04T10:00:00Z' };
  assert.equal(S.routineShareDecision({}, inbox), 'ask');
  assert.equal(S.routineShareDecision({ state: 'declined', inviteSince: 's1' }, inbox), 'none');
  assert.equal(S.routineShareDecision({ state: 'declined', inviteSince: 's0' }, inbox), 'ask');        // nouvelle invitation
  assert.equal(S.routineShareDecision({ state: 'accepted', appliedUpdatedAt: '' }, inbox), 'apply');
  assert.equal(S.routineShareDecision({ state: 'accepted', appliedUpdatedAt: inbox.updatedAt }, inbox), 'none');
  assert.equal(S.routineShareDecision({ state: 'accepted' }, { offered: false }), 'end');             // retiré par l'animateur
  assert.equal(S.routineShareDecision({ state: 'left', inviteSince: 's1' }, inbox), 'none');
  assert.equal(S.routineShareDecision({}, { offered: false }), 'none');
});

test('fiche reçue : nom nettoyé, rôle et terrain bornés, DSL non compilable refusé', () => {
  const f = S.sanitizeShareFiche({ name: '<b>x</b>"', dsl: '15m EF + 3x(6m S60) r2m EF + 10m EF', role: 'hack', terrain: 'ailleurs', tier: 9, totalSec: 'abc' }, compileRoutineDsl, null);
  assert.equal(f.name, 'bx/b');
  assert.equal(f.role, 'quality');
  assert.equal(f.terrain, 'route');
  assert.equal(f.tier, 1);
  assert.equal(f.totalSec, 0);
  assert.equal(S.sanitizeShareFiche({ dsl: 'n importe quoi' }, compileRoutineDsl, null), null);
  assert.equal(S.sanitizeShareFiche({ dsl: 'x'.repeat(500) }, compileRoutineDsl, null), null);
});
