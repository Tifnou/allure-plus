#!/usr/bin/env node
// Backtest de la PROJECTION de gain de capacité (cahier des charges §5, lot P1 « fin de plan »).
// Pour chaque course ≥ 10 km, on se place 12 semaines avant, on projette le gain de VO2max jusqu'à la
// course avec le modèle `plan-1` (RacePredictor.projectPlanGain) et l'on compare au gain réellement
// observé (VO2max précise Garmin 3 jours avant la course). Comparé à l'ancien modèle (+3 % fixe pour
// un plan ≤ 12 semaines) et à « aucun gain ». Données : node tools/backtest_fetch.js d'abord.
const fs = require('fs'), path = require('path');
const RP = require('../frontend/js/race_predictor.js');
const DATA = path.join(__dirname, '..', 'data');
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const vo2 = rj(path.join(DATA, 'backtest_cache', 'vo2max.json')).filter(p => p.date >= '2018-01-01'); // valeurs précises
const act = rj(path.join(DATA, 'backtest_cache', 'activities.json'));
const races = rj(path.join(DATA, 'races.json'))[act.email].filter(r => r.distanceKm >= 10 && !r.dnf && r.date >= '2018-06-01');
const DAY = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
const at = d => { let l = null; for (const p of vo2) { if (p.date <= d) l = p; else break; } return l; };
const peak = t => { let pk = 0; for (const p of vo2) { if (p.date > iso(t)) break; if (new Date(p.date).getTime() >= t - 365 * DAY) pk = Math.max(pk, p.precise); } return pk; };
const runs = act.activities.filter(a => /run/i.test(a.activityType || '') && !/treadmill/i.test(a.activityType || ''));
const firstRun = Math.min(...runs.map(a => new Date(String(a.date).replace(' ', 'T')).getTime()));
const historyDays = t => Math.max(0, (t - firstRun) / DAY);

const rows = [];
races.forEach(r => {
  const t = new Date(r.date).getTime(), s = t - 84 * DAY;
  const a = at(iso(s)), b = at(iso(t - 3 * DAY)), pk = peak(s);
  if (!a || !b || !pk) return;
  const p = RP.projectPlanGain({ params: process.env.BT_B ? { baseByMaturity: { experienced: +process.env.BT_B, intermediate: 1, novice: 3 }, gapSlope: +process.env.BT_S } : undefined, weeksTotal: 12, weeksElapsed: 0, vo2Now: a.precise, vo2Peak: pk, historyDays: historyDays(s), adherence: { score: 0.9 } });
  rows.push({ date: r.date, real: (b.precise / a.precise - 1) * 100, plan1: p.vo2GainPct, lo: p.vo2GainPct - 3.2, hi: p.vo2GainPct + 3.2, mat: p.maturity });
});
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const mae = f => mean(rows.map(r => Math.abs(f(r) - r.real)));
console.log(`Fenêtres de 12 semaines avant une course (≥10 km, VO2max précise) : ${rows.length}`);
console.log(`Gain réel de VO2max : moyenne ${mean(rows.map(r => r.real)).toFixed(2)} %`);
console.log(`Erreur absolue moyenne du gain prédit (en points de % de VO2max) :`);
console.log(`  ancien modèle (+3 % fixe, assiduité pleine) : ${mae(() => 3).toFixed(2)}`);
console.log(`  aucun gain                                   : ${mae(() => 0).toFixed(2)}`);
console.log(`  plan-1 (marge de progression + maturité)     : ${mae(r => r.plan1).toFixed(2)}`);
console.log(`Biais : ancien ${(3 - mean(rows.map(r => r.real))).toFixed(2)} | plan-1 ${(mean(rows.map(r => r.plan1)) - mean(rows.map(r => r.real))).toFixed(2)}`);
console.log(`Gain réel dans l'intervalle ±3,2 % annoncé : ${Math.round(rows.filter(r => r.real >= r.lo && r.real <= r.hi).length / rows.length * 100)} %`);
const mat = {}; rows.forEach(r => { mat[r.mat] = (mat[r.mat] || 0) + 1; }); console.log('Maturité détectée :', JSON.stringify(mat));
