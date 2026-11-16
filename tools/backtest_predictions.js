#!/usr/bin/env node
// ============================================================================
// Backtest des prédictions de chrono (cahier des charges Route & Trail, lot P0)
// ----------------------------------------------------------------------------
// Rejoue, pour chaque course réelle de data/races.json, les estimateurs
// disponibles en n'utilisant QUE ce qui précède la date de la course
// (aucune fuite de résultat futur), et mesure l'écart au chrono réel.
//
//   node tools/backtest_predictions.js            -> tableau lisible
//   node tools/backtest_predictions.js --json     -> sortie JSON (comparaisons)
//
// Estimateurs comparés (voir aussi frontend/js/app.js) :
//   A  moteur ACTUEL : VMA = (VO2max-3,5) x 0,313 (0,315 F), % de VMA fixe par
//      distance (97/90/83/76 %). Reproduit à l'identique estimateRaceTime().
//   B  extrapolation de la course précédente (Riegel, exposant 1,06), choisie
//      parmi les courses des 12 mois précédents (proximité de distance, puis
//      fraîcheur).
//   AB moyenne simple de A et B (aperçu d'un modèle hybride, poids non calibrés).
//
// LIMITE CONNUE : la VO2max saisie sur une course est celle du jour ; Garmin
// peut l'avoir mise à jour APRÈS la course (fuite possible, qui flatte A).
// À corriger au lot suivant par l'historique Garmin d'avant-course.
// ============================================================================
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const readJson = n => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8').replace(/^﻿/, ''));

const RIEGEL = 1.06;
const MAX_ELEV_M_PER_KM = 15;   // au-delà : trop vallonné pour un modèle « route plate »
const MIN_DIST_KM = 5;
const REF_WINDOW_DAYS = 365;

// --- Estimateur A : copie fidèle du moteur actuel (app.js, calcVMA + estimateRaceTime)
function engineA(vo2max, sex, distKm) {
  const vma = (vo2max - 3.5) * (sex === 'F' ? 0.315 : 0.313);
  const pct = distKm <= 5 ? 0.97 : distKm <= 10 ? 0.90 : distKm <= 21.1 ? 0.83 : 0.76;
  return Math.round(distKm / (vma * pct) * 3600);
}

const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const isFlatRoute = r => r.type === 'route' && !r.dnf && r.distanceKm >= MIN_DIST_KM
  && (r.elevationGain || 0) / r.distanceKm < MAX_ELEV_M_PER_KM && r.durationSec > 0;

// --- Estimateur B : meilleure référence antérieure
function engineB(race, pool) {
  const cands = pool.filter(p => p !== race && p.date < race.date && days(p.date, race.date) <= REF_WINDOW_DAYS);
  if (!cands.length) return null;
  cands.sort((a, b) => {
    const da = Math.abs(Math.log(a.distanceKm / race.distanceKm));
    const db = Math.abs(Math.log(b.distanceKm / race.distanceKm));
    return (da - db) || (b.date < a.date ? -1 : 1);
  });
  const ref = cands[0];
  return { sec: Math.round(ref.durationSec * Math.pow(race.distanceKm / ref.distanceKm, RIEGEL)), ref };
}

const pct = (est, real) => (est - real) / real * 100;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const stats = errs => errs.length ? {
  n: errs.length,
  biasPct: +mean(errs).toFixed(1),
  medAbsPct: +median(errs.map(Math.abs)).toFixed(1),
  p90AbsPct: +[...errs.map(Math.abs)].sort((a, b) => a - b)[Math.min(errs.length - 1, Math.floor(errs.length * 0.9))].toFixed(1),
  within3: Math.round(errs.filter(e => Math.abs(e) <= 3).length / errs.length * 100),
} : { n: 0 };
const bucket = d => d <= 10.5 ? '5-10 km' : d <= 22 ? '20-21 km' : d <= 31 ? '25-30 km' : '42 km';

function run() {
  const all = readJson('races.json');
  const prefs = (() => { try { return readJson('prefs.json'); } catch (e) { return {}; } })();
  const rows = [];
  for (const [email, list] of Object.entries(all)) {
    const sex = (prefs[email] && prefs[email].sex) || 'M';
    const pool = list.filter(isFlatRoute).sort((a, b) => a.date < b.date ? -1 : 1);
    for (const r of pool) {
      const A = r.vo2max ? engineA(r.vo2max, sex, r.distanceKm) : null;
      const B = engineB(r, pool);
      rows.push({
        user: email.split('@')[0], date: r.date, km: r.distanceKm, real: r.durationSec,
        errA: A ? pct(A, r.durationSec) : null,
        errB: B ? pct(B.sec, r.durationSec) : null,
        errAB: (A && B) ? pct((A + B.sec) / 2, r.durationSec) : null,
        refB: B ? `${B.ref.date} ${B.ref.distanceKm}km` : null,
      });
    }
  }
  return rows;
}

function report(rows) {
  const keys = ['errA', 'errB', 'errAB'];
  const labels = { errA: 'A  moteur actuel', errB: 'B  Riegel (course précédente)', errAB: 'AB moyenne A+B' };
  const both = rows.filter(r => r.errA != null && r.errB != null);
  const out = { courses: rows.length, avecA: rows.filter(r => r.errA != null).length, avecB: rows.filter(r => r.errB != null).length, communes: both.length, global: {}, parDistance: {}, parCoureur: {} };
  keys.forEach(k => { out.global[k] = stats(both.map(r => r[k])); });
  const group = (fn, dest) => {
    const g = {};
    both.forEach(r => { (g[fn(r)] = g[fn(r)] || []).push(r); });
    Object.entries(g).forEach(([name, rs]) => { dest[name] = {}; keys.forEach(k => { dest[name][k] = stats(rs.map(r => r[k])); }); });
  };
  group(r => bucket(r.km), out.parDistance);
  group(r => r.user, out.parCoureur);
  return { out, labels };
}

if (require.main === module) {
  const rows = run();
  const { out, labels } = report(rows);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ out, rows }, null, 2)); process.exit(0); }
  const line = (name, s) => `  ${name.padEnd(30)} n=${String(s.n).padStart(2)}  biais ${String(s.biasPct).padStart(5)} %  |err| médiane ${String(s.medAbsPct).padStart(4)} %  p90 ${String(s.p90AbsPct).padStart(4)} %  dans ±3 % : ${String(s.within3).padStart(3)} %`;
  console.log(`Courses route plates (≥${MIN_DIST_KM} km, < ${MAX_ELEV_M_PER_KM} m/km) : ${out.courses} | avec VO2max : ${out.avecA} | avec référence antérieure : ${out.avecB} | comparées : ${out.communes}`);
  console.log('(biais < 0 = estimation trop rapide ; > 0 = trop lente)\n');
  console.log('GLOBAL (mêmes courses pour les 3 méthodes)');
  Object.keys(labels).forEach(k => console.log(line(labels[k], out.global[k])));
  console.log('\nPAR DISTANCE');
  Object.entries(out.parDistance).forEach(([d, v]) => { console.log(' ' + d); Object.keys(labels).forEach(k => console.log(line(labels[k], v[k]))); });
  console.log('\nPAR COUREUR');
  Object.entries(out.parCoureur).forEach(([d, v]) => { console.log(' ' + d); Object.keys(labels).forEach(k => console.log(line(labels[k], v[k]))); });
}
module.exports = { engineA, engineB, run, report, stats };
