// ============================================================================
// free_analysis.js — analyse APPROFONDIE d'une sortie libre (ni plan ni routine)
// ----------------------------------------------------------------------------
// Partie 1 (pure, testée Node : tests/free_analysis.test.js) : calculs à partir des tours Garmin
// (laps) et de la série seconde-par-seconde (/api/activity/:id/gps -> elevation[]).
// Partie 2 (navigateur) : rendu dans #activity-deep-card (voir renderFreeDeepAnalysis).
//
// Principes : jamais de verdict inventé (si les données manquent ou si la sortie est trop variable,
// on le dit), jamais de note chiffrée opaque, chaque chiffre est comparé à TON historique.
// Chargé après session-analysis.js (computeMovementSplit) et race_predictor.js.
// ============================================================================
(function (root) {
  'use strict';
  const DAY = 86400000;
  const CFG = {
    runSpeedMps: 1.5,            // en dessous : marche / arrêt (même seuil que computeMovementSplit)
    warmupSkipSec: 600,          // décrochage cardiaque : on écarte les 10 premières minutes (le cœur « démarre »)
    decoupMinHalfSec: 720,       // chaque moitié doit durer ≥ 12 min de course
    steadyMaxCv: 0.10,           // au-delà, la sortie est trop variable pour parler de dérive
    effWindowDays: 84, effMinSamples: 4, effHrTol: 8, effDistLo: 0.6, effDistHi: 1.6,
    elevKmPer100: 0.5,           // km équivalents / 100 m de D+ (même valeur que le moteur route)
    effortHrFrac: 0.90,          // FC moy ≥ 90 % FC max : effort maximal soutenu -> équivalent course
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
  const r1 = v => Math.round(v * 10) / 10;
  const fr = v => String(r1(v)).replace('.', ',');
  const pace = mps => mps > 0 ? 1000 / mps : null;

  // ---------------------------------------------------------------- Lot 1.2 / 1.3 : efficacité & dérive
  /** Points « de course » exploitables de la série : FC + vitesse ajustée au dénivelé (GAP) valides. */
  function usablePoints(series) {
    const out = [];
    if (!Array.isArray(series)) return out;
    for (let i = 1; i < series.length; i++) {
      const p = series[i], q = series[i - 1];
      if (p.sec == null || q.sec == null) continue;
      const dt = Math.min(30, Math.max(0, p.sec - q.sec));
      const moving = (p.movingSec != null && q.movingSec != null) ? Math.min(dt, Math.max(0, p.movingSec - q.movingSec)) : dt;
      const speed = p.speedMps != null ? p.speedMps : q.speedMps;
      if (!(moving > 0) || !(p.hr > 40) || !(p.gapMps > 0.8)) continue;
      if (speed != null && speed < CFG.runSpeedMps) continue;
      out.push({ t: p.sec, dt: moving, hr: p.hr, gap: p.gapMps });
    }
    return out;
  }
  const effOf = pts => {
    const w = pts.reduce((s, p) => s + p.dt, 0);
    if (!(w > 0)) return null;
    const gap = pts.reduce((s, p) => s + p.gap * p.dt, 0) / w, hr = pts.reduce((s, p) => s + p.hr * p.dt, 0) / w;
    return { eff: gap * 60 / hr, gap, hr, sec: w }; // m/min par battement/min
  };

  /** Découplage aérobie (Pa:HR) : perte d'efficacité vitesse/FC entre 1re et 2e moitié de la course, pente neutralisée. */
  function computeCardiacDrift(series) {
    const pts = usablePoints(series);
    const total = pts.reduce((s, p) => s + p.dt, 0);
    if (total < 2 * CFG.decoupMinHalfSec + 300) return { ok: false, why: 'sortie trop courte (il faut au moins ~30 min de course continue)' };
    // on écarte l'échauffement cardiaque
    let skipped = 0; const kept = [];
    const skip = Math.min(CFG.warmupSkipSec, total * 0.1);
    pts.forEach(p => { if (skipped < skip) skipped += p.dt; else kept.push(p); });
    const w = kept.reduce((s, p) => s + p.dt, 0);
    let acc = 0; const h1 = [], h2 = [];
    kept.forEach(p => { (acc < w / 2 ? h1 : h2).push(p); acc += p.dt; });
    const a = effOf(h1), b = effOf(h2);
    if (!a || !b || a.sec < CFG.decoupMinHalfSec || b.sec < CFG.decoupMinHalfSec) return { ok: false, why: 'pas assez de course continue' };
    // régularité : coefficient de variation de la vitesse ajustée par blocs de 5 min
    const blocks = []; let cur = [], curSec = 0;
    kept.forEach(p => { cur.push(p); curSec += p.dt; if (curSec >= 300) { blocks.push(effOf(cur).gap); cur = []; curSec = 0; } });
    const cv = blocks.length >= 3 ? sd(blocks) / mean(blocks) : null;
    if (cv != null && cv > CFG.steadyMaxCv) return { ok: false, why: 'allure trop variable (fractionné ou terrain irrégulier) : la dérive n\'a pas de sens sur une sortie non stable', cv };
    const decoupling = (a.eff / b.eff - 1) * 100;
    const level = decoupling < 3 ? 'excellent' : decoupling < 5 ? 'bon' : decoupling < 8 ? 'modere' : 'marque';
    return { ok: true, decouplingPct: r1(decoupling), hrFirst: Math.round(a.hr), hrSecond: Math.round(b.hr), gapFirst: a.gap, gapSecond: b.gap, level, cv };
  }

  /** Indice d'efficacité résumé (comparable à l'historique : mêmes données — allure, D+, FC moyenne). */
  function summaryEfficiency(a) {
    if (!(a && a.distanceKm > 0 && a.durationSec > 0 && a.avgHR > 40)) return null;
    const eqKm = a.distanceKm + (a.elevationGain || 0) / 100 * CFG.elevKmPer100;
    return (eqKm * 1000 / a.durationSec) * 60 / a.avgHR;
  }
  function compareEfficiency(act, allActs, nowMs) {
    const eff = summaryEfficiency(act);
    if (eff == null) return null;
    const isT = x => /trail/i.test(x.activityType || '');
    const peers = (allActs || []).filter(x => {
      if (!x || String(x.id) === String(act.id)) return false;
      if (!/run|trail/i.test(x.activityType || '') || isT(x) !== isT(act)) return false;
      const t = Date.parse(String(x.date).replace(' ', 'T'));
      if (!t || t >= nowMs || nowMs - t > CFG.effWindowDays * DAY) return false;
      if (!(x.distanceKm >= act.distanceKm * CFG.effDistLo && x.distanceKm <= act.distanceKm * CFG.effDistHi)) return false;
      return x.avgHR > 40 && Math.abs(x.avgHR - act.avgHR) <= CFG.effHrTol;
    }).map(summaryEfficiency).filter(v => v != null);
    if (peers.length < CFG.effMinSamples) return { eff, n: peers.length, enough: false };
    const med = median(peers), deltaPct = (eff / med - 1) * 100;
    const verdict = Math.abs(deltaPct) < 2 ? 'stable' : deltaPct > 0 ? 'hausse' : 'baisse';
    return { eff, n: peers.length, enough: true, median: med, deltaPct: r1(deltaPct), verdict };
  }

  // ---------------------------------------------------------------- Lot 1.4 : régularité (GAP)
  function kmLaps(laps) {
    const ls = (laps || []).filter(l => l && l.averageSpeed > 0 && l.distance > 0);
    if (ls.length < 3) return [];
    const med = median(ls.map(l => l.distance));
    return ls.filter(l => l.distance >= med * 0.5);
  }
  function computeRegularity(laps) {
    const ls = kmLaps(laps);
    if (ls.length < 3) return null;
    const hasGap = ls.every(l => l.avgGradeAdjustedSpeed > 0);
    const paces = ls.map(l => 1000 / (hasGap ? l.avgGradeAdjustedSpeed : l.averageSpeed));
    const cv = sd(paces) / mean(paces) * 100;
    const half = Math.floor(paces.length / 2);
    const first = mean(paces.slice(0, half)), second = mean(paces.slice(paces.length - half));
    const splitSec = Math.round(second - first);
    const worst = ls.reduce((b, l, i) => { const dev = Math.abs(paces[i] - mean(paces)); return !b || dev > b.dev ? { dev, km: i + 1 } : b; }, null);
    const level = cv < 2 ? 'tres_reguliere' : cv < 4 ? 'reguliere' : cv < 7 ? 'irreguliere' : 'tres_irreguliere';
    return { cvPct: r1(cv), splitSec, splitKind: Math.abs(splitSec) <= 5 ? 'stable' : splitSec < 0 ? 'negatif' : 'positif', basis: hasGap ? 'GAP' : 'brute', worstKm: worst.km, level, n: ls.length };
  }

  // ---------------------------------------------------------------- Lot 2.6 / 2.7 : technique & puissance
  const third = (arr, k) => { const n = Math.floor(arr.length / 3); return k === 0 ? arr.slice(0, n) : arr.slice(arr.length - n); };
  function wmean(ls, key) { const w = ls.reduce((s, l) => s + (l.duration || 0), 0); return w > 0 ? ls.reduce((s, l) => s + l[key] * (l.duration || 0), 0) / w : null; }
  function dynamicsOf(laps, key, minV) {
    const ls = kmLaps(laps).filter(l => l[key] > minV);
    return ls.length >= 3 ? ls : null;
  }
  function computeTechnique(laps) {
    const out = {};
    const cad = dynamicsOf(laps, 'averageRunCadence', 100);
    if (cad) {
      const a = wmean(third(cad, 0), 'averageRunCadence'), b = wmean(third(cad, 1), 'averageRunCadence');
      out.cadence = { avg: Math.round(wmean(cad, 'averageRunCadence')), first: Math.round(a), last: Math.round(b), delta: Math.round(b - a) };
    }
    const st = dynamicsOf(laps, 'strideLength', 20);
    if (st) out.stride = { avgCm: Math.round(wmean(st, 'strideLength')) };
    const gct = dynamicsOf(laps, 'groundContactTime', 100);
    if (gct) {
      const a = wmean(third(gct, 0), 'groundContactTime'), b = wmean(third(gct, 1), 'groundContactTime');
      out.gct = { avg: Math.round(wmean(gct, 'groundContactTime')), first: Math.round(a), last: Math.round(b), delta: Math.round(b - a) };
    }
    const vo = dynamicsOf(laps, 'verticalOscillation', 1);
    if (vo) out.vo = { avgCm: r1(wmean(vo, 'verticalOscillation')) };
    const vr = dynamicsOf(laps, 'verticalRatio', 1);
    if (vr) out.vr = { avg: r1(wmean(vr, 'verticalRatio')) };
    if (!Object.keys(out).length) return null;
    // signal de fatigue : cadence qui chute ET/OU contact au sol qui s'allonge sur le dernier tiers
    const signs = [];
    if (out.cadence && out.cadence.delta <= -3) signs.push(`cadence en baisse de ${-out.cadence.delta} pas/min`);
    if (out.gct && out.gct.delta >= 8) signs.push(`contact au sol allongé de ${out.gct.delta} ms`);
    out.fatigue = signs;
    return out;
  }
  function computePower(laps) {
    const ls = kmLaps(laps).filter(l => l.averagePower > 0);
    if (ls.length < 3) return null;
    const avg = wmean(ls, 'averagePower');
    const np = wmean(ls.filter(l => l.normalizedPower > 0), 'normalizedPower');
    const a = wmean(third(ls, 0), 'averagePower'), b = wmean(third(ls, 1), 'averagePower');
    const vi = np && avg ? np / avg : null;
    return { avg: Math.round(avg), np: np ? Math.round(np) : null, vi: vi ? Math.round(vi * 100) / 100 : null, first: Math.round(a), last: Math.round(b), deltaPct: r1((b / a - 1) * 100), perLap: ls.map(l => Math.round(l.averagePower)) };
  }

  // ---------------------------------------------------------------- Lot 1.1 : découpage de la sortie
  function computeStops(laps, activity) {
    const ls = laps || [];
    const elapsed = ls.reduce((s, l) => s + (l.elapsedDuration || l.duration || 0), 0);
    const moving = ls.reduce((s, l) => s + (l.movingDuration || 0), 0);
    if (!(elapsed > 0 && moving > 0)) return null;
    const dist = activity && activity.distanceKm ? activity.distanceKm : ls.reduce((s, l) => s + (l.distance || 0), 0) / 1000;
    return { elapsedSec: Math.round(elapsed), movingSec: Math.round(moving), stoppedSec: Math.round(Math.max(0, elapsed - moving)), paceElapsed: dist > 0 ? Math.round(elapsed / dist) : null, paceMoving: dist > 0 ? Math.round(moving / dist) : null };
  }

  // ---------------------------------------------------------------- Lot 1.5 / 2.9 : nature de la sortie, contexte
  function hrFrac(avgHR, hrMax) { return avgHR > 0 && hrMax > 0 ? avgHR / hrMax : null; }
  function intensityClass(frac) {
    if (frac == null) return null;
    if (frac < 0.68) return { key: 'recup', label: 'récupération' };
    if (frac < 0.78) return { key: 'endurance', label: 'endurance fondamentale' };
    if (frac < 0.85) return { key: 'soutenue', label: 'endurance soutenue / tempo' };
    if (frac < 0.92) return { key: 'seuil', label: 'seuil' };
    return { key: 'intense', label: 'intense' };
  }
  /** Sortie structurée (fractionné) ? Variation forte de la vitesse d'un km à l'autre. */
  function looksLikeIntervals(laps) {
    const ls = (laps || []).filter(l => l && l.averageSpeed > 0 && l.duration > 20);
    if (ls.length < 5) return false;
    const sp = ls.map(l => l.averageSpeed);
    return sd(sp) / mean(sp) > 0.18;
  }
  function weekContext(act, allActs, nowMs) {
    const t = Date.parse(String(act.date).replace(' ', 'T'));
    if (!t) return null;
    const d = new Date(t); const dow = (d.getDay() + 6) % 7; // lundi = 0
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
    const runKm = (from, to) => (allActs || []).filter(x => /run|trail/i.test(x.activityType || '')).reduce((s, x) => { const tx = Date.parse(String(x.date).replace(' ', 'T')); return tx >= from && tx < to ? s + (x.distanceKm || 0) : s; }, 0);
    const thisWeek = runKm(monday, monday + 7 * DAY);
    const prev = [1, 2, 3, 4].map(i => runKm(monday - i * 7 * DAY, monday - (i - 1) * 7 * DAY));
    const avg4 = mean(prev);
    if (!(avg4 > 0)) return { thisWeekKm: r1(thisWeek), avg4Km: null };
    return { thisWeekKm: r1(thisWeek), avg4Km: r1(avg4), ratio: r1(thisWeek / avg4) };
  }
  /** Équivalent course : seulement si la sortie était un effort maximal soutenu (FC ≥ 90 % FC max). */
  function equivalentRace(act, hrMax, targetKm, RP, dplusTarget) {
    const frac = hrFrac(act.avgHR, hrMax);
    if (!RP || !(targetKm > 0) || !(act.distanceKm >= 5) || frac == null) return null;
    if (frac < CFG.effortHrFrac) return { applicable: false, frac };
    const P = RP.PARAMS;
    const sec = RP.riegelProject(act.durationSec, RP.equivKm(act.distanceKm, act.elevationGain, P), RP.equivKm(targetKm, dplusTarget || 0, P), P.riegel);
    return { applicable: true, frac, sec: Math.round(sec), targetKm };
  }

  // ---------------------------------------------------------------- Lot 2.9 : bilan en une phrase (sans note chiffrée)
  function buildBilan(f) {
    const cls = f.intensity;
    if (!cls) return null;
    const parts = [];
    const kind = f.intervals ? 'Séance fractionnée' : `Sortie ${cls.label}`;
    parts.push(kind + (f.frac != null ? ` (FC moyenne ${Math.round(f.frac * 100)} % de ta FC max)` : ''));
    const good = [], watch = [];
    if (f.reg) { if (f.reg.level === 'tres_reguliere' || f.reg.level === 'reguliere') good.push(`allure ${f.reg.basis === 'GAP' ? 'ajustée au dénivelé ' : ''}régulière (écart ${fr(f.reg.cvPct)} %)`); else watch.push(`allure ${f.reg.basis === 'GAP' ? 'ajustée ' : ''}irrégulière (écart ${fr(f.reg.cvPct)} %)`); }
    if (f.drift && f.drift.ok) { if (f.drift.level === 'excellent' || f.drift.level === 'bon') good.push(`dérive cardiaque contenue (${fr(f.drift.decouplingPct)} %)`); else watch.push(`dérive cardiaque ${f.drift.level === 'marque' ? 'marquée' : 'modérée'} (${fr(f.drift.decouplingPct)} %)`); }
    if (f.eff && f.eff.enough) { if (f.eff.verdict === 'hausse') good.push(`efficacité en hausse (+${fr(f.eff.deltaPct)} %)`); else if (f.eff.verdict === 'baisse') watch.push(`efficacité en baisse (${fr(f.eff.deltaPct)} %)`); }
    if (f.tech && f.tech.fatigue && f.tech.fatigue.length) watch.push(f.tech.fatigue.join(', '));
    let s = parts[0] + '.';
    if (good.length) s += ' Points forts : ' + good.join(' ; ') + '.';
    if (watch.length) s += ' À surveiller : ' + watch.join(' ; ') + '.';
    if (!good.length && !watch.length) s += ' Pas assez de données pour aller plus loin sur cette sortie.';
    return s;
  }

  // ---------------------------------------------------------------- Chaîne complète (pure)
  function analyze(input) {
    const { activity, laps, series, allActivities, nowMs, hrMax, goalKm, goalDplus, RP } = input;
    const intervals = looksLikeIntervals(laps);
    const frac = hrFrac(activity.avgHR, hrMax);
    const f = {
      intervals,
      frac,
      intensity: intensityClass(frac),
      stops: computeStops(laps, activity),
      eff: compareEfficiency(activity, allActivities, nowMs || Date.now()),
      drift: intervals ? { ok: false, why: 'sortie fractionnée' } : computeCardiacDrift(series),
      reg: intervals ? null : computeRegularity(laps),
      tech: computeTechnique(laps),
      power: computePower(laps),
      week: weekContext(activity, allActivities, nowMs || Date.now()),
      race: equivalentRace(activity, hrMax, goalKm, RP, goalDplus),
    };
    f.bilan = buildBilan(f);
    return f;
  }

  const api = { CFG, analyze, computeCardiacDrift, compareEfficiency, summaryEfficiency, computeRegularity, computeTechnique, computePower, computeStops, intensityClass, looksLikeIntervals, weekContext, equivalentRace, buildBilan, usablePoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
