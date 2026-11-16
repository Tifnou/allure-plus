#!/usr/bin/env node
// ============================================================================
// Backtest chronologique des prédictions de chrono ROUTE (cahier des charges, lot P0/P1)
// ----------------------------------------------------------------------------
// Pour chaque course réelle de data/races.json, rejoue les estimateurs en n'utilisant
// QUE ce qui précède la date de la course (VO2max d'avant-course, courses et activités
// antérieures) et mesure l'écart au chrono réel. Aucune fuite du résultat.
//
//   node tools/backtest_fetch.js        (une fois : prépare data/backtest_cache/, serveur lancé)
//   node tools/backtest_predictions.js  (tableau)   |   --json (sortie machine)
//
// Méthodes comparées :
//   ACTUEL   moteur d'origine : VMA x % fixe par palier (97/90/83/76 %)
//   A        voie physiologique continue du nouveau moteur (coefficients calibrés)
//   B        voie « courses récentes » seule
//   HYBRIDE  moteur complet (A + B + borne C) = frontend/js/race_predictor.js
// Calibration des coefficients de la voie A : validation croisée « une course à la fois »
// (chaque course est prédite avec des coefficients ajustés SANS elle).
// ============================================================================
const fs = require('fs');
const path = require('path');
const RP = require('../frontend/js/race_predictor.js');

const DATA = path.join(__dirname, '..', 'data');
const CACHE = path.join(DATA, 'backtest_cache');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

const MIN_KM = 5, MAX_ELEV = 40;
const dateMs = d => new Date(String(d).slice(0, 10) + 'T00:00:00').getTime();

function engineOld(vo2max, sex, distKm) {
  const vma = (vo2max - 3.5) * (sex === 'F' ? 0.315 : 0.313);
  const pct = distKm <= 5 ? 0.97 : distKm <= 10 ? 0.90 : distKm <= 21.1 ? 0.83 : 0.76;
  return distKm / (vma * pct) * 3600;
}

const err = (est, real) => (est - real) / real * 100;
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const pctile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const stats = e => e.length ? {
  n: e.length, bias: +mean(e).toFixed(1), medAbs: +med(e.map(Math.abs)).toFixed(1),
  p90Abs: +pctile(e.map(Math.abs), 0.9).toFixed(1), within3: Math.round(e.filter(x => Math.abs(x) <= 3).length / e.length * 100),
} : { n: 0 };
const bucket = d => d <= 10.5 ? '5-10 km' : d <= 22 ? '20-21 km' : d <= 31 ? '25-30 km' : '42 km';

function loadAll() {
  const racesAll = readJson(path.join(DATA, 'races.json'));
  const act = readJson(path.join(CACHE, 'activities.json'));
  const vo2 = readJson(path.join(CACHE, 'vo2max.json'));
  const email = act.email;
  const sexOf = () => { try { const u = readJson(path.join(DATA, 'user_data.json'))[email]; const p = JSON.parse(u.suivi_sport_profile); return p.sex === 'F' ? 'F' : 'M'; } catch (e) { return 'M'; } };
  const isRun = a => /run/i.test(a.activityType || '') && !/treadmill/i.test('');
  const activities = act.activities.filter(isRun).map(a => ({ dateMs: new Date(String(a.date).replace(' ', 'T')).getTime(), distanceKm: a.distanceKm, durationSec: a.durationSec, avgHR: a.avgHR, maxHR: a.maxHR, elevationGain: a.elevationGain }));
  const races = (racesAll[email] || []).map(r => ({ ...r, dateMs: dateMs(r.date) }));
  return { email, sex: sexOf(), activities, races, vo2 };
}

function vo2Before(vo2, dateStr) { let last = null; for (const p of vo2) { if (p.date < dateStr) last = p; else break; } return last && (new Date(dateStr) - new Date(last.date)) / 86400000 <= 60 ? last.precise : null; }

function evaluate(ctx, params) {
  const rows = [];
  const pool = ctx.races.filter(r => r.type === 'route' && !r.dnf && r.distanceKm >= MIN_KM && (r.elevationGain || 0) / r.distanceKm < MAX_ELEV && r.durationSec > 0).sort((a, b) => a.dateMs - b.dateMs);
  for (const r of pool) {
    const nowMs = r.dateMs;
    const v = vo2Before(ctx.vo2, r.date);
    if (!v) continue;
    const prior = ctx.races.filter(x => x.dateMs < nowMs);
    const acts = ctx.activities.filter(a => a.dateMs < nowMs);
    const base = { distKm: r.distanceKm, dplusM: r.elevationGain || 0, nowMs, vo2max: v, sex: ctx.sex, races: prior, activities: acts };
    const full = RP.predictRoad({ ...base, params });
    const noC = RP.predictRoad({ ...base, activities: [], params });
    const onlyA = RP.predictRoad({ ...base, races: [], activities: [], params });
    const onlyB = RP.voieB(r.distanceKm, nowMs, prior, { ...RP.PARAMS, ...params }, r.elevationGain || 0);
    rows.push({
      date: r.date, km: r.distanceKm, eKm: (r.elevationGain || 0) / r.distanceKm, real: r.durationSec, vo2: v,
      old: err(engineOld(v, ctx.sex, r.distanceKm), r.durationSec),
      A: err(onlyA.sec, r.durationSec),
      B: onlyB ? err(onlyB.sec, r.durationSec) : null,
      noC: err(noC.sec, r.durationSec),
      hybrid: err(full.sec, r.durationSec),
      conf: full.confidence,
      inside: r.durationSec >= full.lowSec && r.durationSec <= full.highSec,
      capped: full.voies.C != null && full.sec === full.voies.C,
    });
  }
  return rows;
}

// Ajuste (pctAtTen, pctSlope) de la voie A pour minimiser l'erreur absolue médiane en log
function fitA(ctx, exclude) {
  const pool = ctx.races.filter(r => r.type === 'route' && !r.dnf && r.distanceKm >= MIN_KM && (r.elevationGain || 0) / r.distanceKm < MAX_ELEV && r.durationSec > 0 && r.date !== exclude);
  const pts = pool.map(r => ({ r, v: vo2Before(ctx.vo2, r.date) })).filter(x => x.v);
  let best = null;
  for (let p10 = 0.78; p10 <= 0.98; p10 += 0.01) {
    for (let s = 0.04; s <= 0.16; s += 0.01) {
      for (let el = 0; el <= 1.21; el += 0.1) {
        const P = { ...RP.PARAMS, pctAtTen: p10, pctSlope: s, elevKmPer100: el };
        const e = pts.map(({ r, v }) => Math.abs(Math.log(RP.voieA(r.distanceKm, v, ctx.sex, P, 1, r.elevationGain || 0).sec / r.durationSec)));
        const cost = mean(e);
        if (!best || cost < best.cost) best = { cost, pctAtTen: +p10.toFixed(3), pctSlope: +s.toFixed(3), elevKmPer100: +el.toFixed(2) };
      }
    }
  }
  return best;
}

function summarize(rows) {
  const keys = ['old', 'A', 'B', 'noC', 'hybrid'];
  const both = rows.filter(r => r.B != null);
  const g = {}; keys.forEach(k => { g[k] = stats(both.map(r => r[k])); });
  const byDist = {};
  both.forEach(r => { (byDist[bucket(r.km)] = byDist[bucket(r.km)] || []).push(r); });
  const parDistance = {};
  Object.entries(byDist).forEach(([d, rs]) => { parDistance[d] = {}; keys.forEach(k => { parDistance[d][k] = stats(rs.map(r => r[k])); }); });
  const coverage = rows.length ? Math.round(rows.filter(r => r.inside).length / rows.length * 100) : null;
  const byConf = {};
  rows.forEach(r => { (byConf[r.conf] = byConf[r.conf] || []).push(r); });
  const parConfiance = {};
  Object.entries(byConf).forEach(([c, rs]) => { parConfiance[c] = { n: rs.length, medAbs: +med(rs.map(r => Math.abs(r.hybrid))).toFixed(1), couverture: Math.round(rs.filter(r => r.inside).length / rs.length * 100) }; });
  return { n: rows.length, comparables: both.length, global: g, parDistance, couvertureIntervalle: coverage, parConfiance };
}

if (require.main === module) {
  if (!fs.existsSync(path.join(CACHE, 'activities.json'))) { console.error('Lancez d\'abord : node tools/backtest_fetch.js'); process.exit(1); }
  const ctx = loadAll();
  const fitAll = fitA(ctx, null);
  // Validation croisée : chaque course est prédite avec des coefficients ajustés sans elle
  const rows = [];
  const pool = evaluate(ctx, {});
  pool.forEach(r => {
    const f = fitA(ctx, r.date);
    const one = evaluate({ ...ctx, races: ctx.races }, { pctAtTen: f.pctAtTen, pctSlope: f.pctSlope, elevKmPer100: f.elevKmPer100 }).find(x => x.date === r.date && x.km === r.km);
    rows.push(one);
  });
  const S = summarize(rows.filter(r => r.eKm < 15));
  const SH = summarize(rows.filter(r => r.eKm >= 15));
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ fitAll, S, SH, rows }, null, 2)); process.exit(0); }
  console.log(`Courses route avec VO2max d'avant-course : ${rows.length} (plates < 15 m/km : ${S.n} | vallonnées 15-40 m/km : ${SH.n}) ; comparables avec course de référence antérieure : ${S.comparables} plates, ${SH.comparables} vallonnées`);
  console.log(`Coefficients voie A ajustés sur toutes les courses : %VMA à 10 km = ${fitAll.pctAtTen}, pente = ${fitAll.pctSlope}, D+ = ${fitAll.elevKmPer100} km/100 m (défaut 0.90 / 0.0975 / 0.5)`);
  console.log('Validation croisée (une course exclue du calibrage à chaque fois). biais < 0 = trop rapide.\n');
  const line = (name, s) => `  ${name.padEnd(34)} n=${String(s.n).padStart(2)}  biais ${String(s.bias).padStart(5)} %  |err| médiane ${String(s.medAbs).padStart(4)} %  p90 ${String(s.p90Abs).padStart(4)} %  dans ±3 % : ${String(s.within3).padStart(3)} %`;
  const L = { old: 'ACTUEL (moteur d\'origine)', A: 'A  physiologique continue', B: 'B  courses récentes', noC: 'A+B fusion', hybrid: 'HYBRIDE A+B + borne C' };
  console.log('GLOBAL'); Object.keys(L).forEach(k => console.log(line(L[k], S.global[k])));
  console.log('\nPAR DISTANCE');
  Object.entries(S.parDistance).forEach(([d, v]) => { console.log(' ' + d); Object.keys(L).forEach(k => console.log(line(L[k], v[k]))); });
  console.log('\nCOURSES VALLONNEES (15-40 m/km de D+), GLOBAL'); Object.keys(L).forEach(k => console.log(line(L[k], SH.global[k])));
  console.log(`\nINTERVALLE annoncé : le chrono réel est dedans dans ${S.couvertureIntervalle} % des cas`);
  Object.entries(S.parConfiance).forEach(([c, v]) => console.log(`  confiance ${c.padEnd(6)} n=${v.n}  erreur médiane ${v.medAbs} %  couverture ${v.couverture} %`));
}
module.exports = { loadAll, evaluate, fitA, summarize };
