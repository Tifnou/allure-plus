#!/usr/bin/env node
// Prépare les données du backtest dans data/backtest_cache/ (jamais commité : data/ est ignoré).
//   - activities.json : résumés d'activités de TOUTES les années (cache serveur des années
//     passées + année en cours demandée au serveur local déjà lancé).
//   - vo2max.json     : historique quotidien de la VO2max Garmin, reconstitué par tranches
//     d'un an (Garmin refuse les plages plus longues, cf garmin_client.getVO2MaxHistory).
// Usage : node tools/backtest_fetch.js [email]   (défaut : premier compte de data/activities_cache.json)
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'backtest_cache');
fs.mkdirSync(OUT, { recursive: true });
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

function getLocal(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3001, path: p, timeout: 120000 }, res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s.replace(/^﻿/, ''))); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const cache = readJson(path.join(DATA, 'activities_cache.json'));
  const email = process.argv[2] || Object.keys(cache)[0];
  const byYear = cache[email] || {};
  const acts = [];
  Object.values(byYear).forEach(arr => acts.push(...arr));
  const cur = new Date().getFullYear();
  try {
    const r = await getLocal('/api/activities/year/' + cur);
    acts.push(...(r.activities || []));
  } catch (e) { console.log('Année en cours indisponible (serveur arrêté ?) :', e.message); }
  const seen = new Set();
  const uniq = acts.filter(a => a && !seen.has(a.id) && seen.add(a.id));
  fs.writeFileSync(path.join(OUT, 'activities.json'), JSON.stringify({ email, activities: uniq }));
  console.log('activités :', uniq.length);

  // VO2max par tranches d'un an (compte du dossier .garmin_tokens correspondant)
  require(path.join(ROOT, 'garmin_mfa_patch.js'));
  const { GarminConnect } = require(path.join(ROOT, 'node_modules', 'garmin-connect'));
  const slug = email.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const gc = new GarminConnect({ username: 'x', password: 'x' });
  gc.loadTokenByFile(path.join(ROOT, '.garmin_tokens', slug));
  const fmt = d => d.toISOString().slice(0, 10);
  const out = [];
  let end = new Date();
  const first = uniq.map(a => a.date).filter(Boolean).sort()[0] || '2016-01-01';
  const start = new Date(first.slice(0, 10));
  while (end > start) {
    const from = new Date(Math.max(start.getTime(), end.getTime() - 364 * 86400000));
    try {
      const res = await gc.get(`https://connectapi.garmin.com/metrics-service/metrics/maxmet/daily/${fmt(from)}/${fmt(end)}`);
      (Array.isArray(res) ? res : []).forEach(r => {
        if (r.generic && typeof r.generic.vo2MaxPreciseValue === 'number') out.push({ date: r.generic.calendarDate, precise: r.generic.vo2MaxPreciseValue, value: r.generic.vo2MaxValue });
      });
    } catch (e) { console.log('tranche', fmt(from), fmt(end), 'échec :', String(e.message).slice(0, 80)); }
    end = new Date(from.getTime() - 86400000);
  }
  out.sort((a, b) => a.date < b.date ? -1 : 1);
  fs.writeFileSync(path.join(OUT, 'vo2max.json'), JSON.stringify(out));
  console.log('points VO2max :', out.length, out[0] && out[0].date, '→', out.length && out[out.length - 1].date);
})();
