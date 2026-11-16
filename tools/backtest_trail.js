#!/usr/bin/env node
// Backtest chronologique du moteur trail (trail-1) : chaque course trail de data/races.json est prédite
// avec la seule information antérieure (courses passées + sa VO2max saisie), comparée à l'ancienne formule
// (km équivalents 1 m D+ = 10 m, % VMA fixe par palier). biais > 0 = trop lent.
const fs = require('fs'), path = require('path');
const RP = require('../frontend/js/race_predictor.js');
const DATA = path.join(__dirname, '..', 'data');
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const all = rj(path.join(DATA, 'races.json'));
const udata = (() => { try { return rj(path.join(DATA, 'user_data.json')); } catch (e) { return {}; } })();
const rows = [];
for (const [email, list] of Object.entries(all)) {
  let sex = 'M'; try { sex = JSON.parse(udata[email].suivi_sport_profile).sex === 'F' ? 'F' : 'M'; } catch (e) {}
  const races = list.map(r => ({ ...r, dateMs: new Date(String(r.date).slice(0, 10) + 'T00:00:00').getTime() }));
  races.filter(r => r.type !== 'route' && !r.dnf && r.durationSec > 0 && r.vo2max > 3.5).forEach(r => {
    const pred = RP.predictTrail({ distKm: r.distanceKm, dplusM: r.elevationGain || 0, nowMs: r.dateMs, vo2max: r.vo2max, sex, races: races.filter(x => x.dateMs < r.dateMs) });
    const vma = (r.vo2max - 3.5) * (sex === 'F' ? 0.315 : 0.313);
    const pc = r.distanceKm <= 21 ? 0.70 : r.distanceKm <= 42 ? 0.65 : r.distanceKm <= 80 ? 0.58 : 0.50;
    const old = (r.distanceKm + (r.elevationGain || 0) / 100) / (vma * pc) * 3600;
    rows.push({ who: email[0], date: r.date, km: r.distanceKm, d: r.elevationGain || 0, real: r.durationSec, e: (pred.sec - r.durationSec) / r.durationSec * 100, eOld: (old - r.durationSec) / r.durationSec * 100, inside: r.durationSec >= pred.lowSec && r.durationSec <= pred.highSec, conf: pred.confidence });
  });
}
const mae = a => a.reduce((s, x) => s + Math.abs(x), 0) / a.length, mean = a => a.reduce((s, x) => s + x, 0) / a.length;
rows.forEach(r => console.log(r.who, r.date, String(r.km).padEnd(6), String(Math.round(r.d)).padEnd(5), 'nouveau', r.e.toFixed(1).padStart(6), '% | ancien', r.eOld.toFixed(1).padStart(6), '%', r.inside ? ' dans la fourchette' : ' HORS fourchette', r.conf));
console.log(`n=${rows.length}  MAE nouveau ${mae(rows.map(r => r.e)).toFixed(1)} % (biais ${mean(rows.map(r => r.e)).toFixed(1)})  MAE ancien ${mae(rows.map(r => r.eOld)).toFixed(1)} % (biais ${mean(rows.map(r => r.eOld)).toFixed(1)})  couverture ${Math.round(rows.filter(r => r.inside).length / rows.length * 100)} %`);
