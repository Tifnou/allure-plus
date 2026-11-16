// ============================================================================
// free_analysis_ui.js — rendu de la carte « Analyse approfondie » (#activity-deep-card)
// Les calculs vivent dans free_analysis.js (pur, testé) ; ici seulement le HTML.
// Chargé après free_analysis.js, session-analysis.js (computeMovementSplit, loadAnalysisActivityElevation).
// ============================================================================
let _freeDeepToken = 0;

function freeDeepHide() {
  _freeDeepToken++;
  const card = document.getElementById('activity-deep-card');
  const body = document.getElementById('activity-deep-body');
  if (card) card.style.display = 'none';
  if (body) body.innerHTML = '';
}

/** Profil de la sortie : altitude (aire) + allure ajustée + FC, en SVG, lissé, sur la distance. */
function freeDeepProfileSvg(series) {
  if (!Array.isArray(series) || series.length < 10) return '';
  const W = 640, H = 170, PL = 8, PR = 8, PT = 8, PB = 18;
  const n = series.length, win = 5;
  const sm = key => series.map((_, i) => {
    const a = Math.max(0, i - win), b = Math.min(n, i + win + 1);
    const v = series.slice(a, b).map(p => p[key]).filter(x => x != null && isFinite(x));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  });
  const alt = sm('alt'), hr = sm('hr'), gap = sm('gapMps').map(v => (v > 0.8 ? v : null));
  const maxD = series[n - 1].distKm || 1;
  const x = i => PL + (series[i].distKm / maxD) * (W - PL - PR);
  const line = (arr, color, sw) => {
    const vs = arr.filter(v => v != null);
    if (vs.length < 5) return '';
    const mn = Math.min(...vs); let mx = Math.max(...vs); if (mx - mn < 1e-6) mx = mn + 1;
    const y = v => PT + (1 - (v - mn) / (mx - mn)) * (H - PT - PB);
    let d = '', pen = false;
    arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  };
  const altVs = alt.filter(v => v != null);
  let area = '';
  if (altVs.length > 5) {
    const mn = Math.min(...altVs), mx = Math.max(...altVs), span = Math.max(mx - mn, 10);
    const y = v => H - PB - ((v - mn) / span) * (H - PT - PB) * 0.55;
    let d = `M${x(0).toFixed(1)} ${H - PB}`;
    alt.forEach((v, i) => { if (v != null) d += `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
    d += `L${x(n - 1).toFixed(1)} ${H - PB}Z`;
    area = `<path d="${d}" fill="#9ca3af" opacity=".25"/>`;
  }
  const ticks = [0, .25, .5, .75, 1].map(f => `<text x="${(PL + f * (W - PL - PR)).toFixed(0)}" y="${H - 4}" font-size="10" fill="currentColor" opacity=".6" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${(maxD * f).toFixed(1).replace('.', ',')} km</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="fd-profile" role="img" aria-label="Profil de la sortie : altitude, allure ajustée et fréquence cardiaque">${area}${line(gap, '#3b82f6', 1.6)}${line(hr, '#ef4444', 1.4)}${ticks}</svg>
    <div class="fd-legend"><span><i style="background:#9ca3af"></i>Altitude</span><span><i style="background:#3b82f6"></i>Allure ajustée au dénivelé (plus haut = plus rapide)</span><span><i style="background:#ef4444"></i>FC</span></div>`;
}

function freeDeepRow(label, value, hint) {
  return `<div class="fd-row"><div class="fd-label">${label}</div><div class="fd-value">${value}${hint ? `<div class="fd-hint">${hint}</div>` : ''}</div></div>`;
}

function renderFreeDeepAnalysis(activity, laps) {
  const card = document.getElementById('activity-deep-card'), body = document.getElementById('activity-deep-body');
  if (!card || !body || !activity || typeof FreeAnalysis === 'undefined') return;
  freeDeepHide();
  const token = _freeDeepToken;
  const fmtD = s => formatDuration(Math.round(s));
  const fmtP = s => formatPace(Math.round(s));
  const num = v => String(v).replace('.', ',');
  const fmtKm = v => num(Math.round(v * 10) / 10);

  const all = (typeof _allActivities !== 'undefined' && Array.isArray(_allActivities)) ? _allActivities : [];
  const hrMaxEst = (typeof RacePredictor !== 'undefined' && typeof predictorActivities === 'function') ? RacePredictor.estimateHrMax(predictorActivities()) : null;
  const hrMax = hrMaxEst || (activity.maxHR > 120 ? activity.maxHR : null);
  let goalKm = 0, goalDplus = 0;
  try {
    const g = (typeof campusState !== 'undefined') && campusState.goal;
    if (g && typeof getDistFromGoal === 'function') {
      const pid = g._id || 'plan';
      goalKm = parseFloat(localStorage.getItem('suivi_objectif_dist_' + pid)) || getDistFromGoal(g) || 0;
      goalDplus = parseInt(localStorage.getItem('suivi_objectif_dplus_' + pid)) || 0;
    }
  } catch (e) { /* pas d'objectif */ }

  const run = series => {
    if (token !== _freeDeepToken) return; // une autre activité a été ouverte entre-temps
    const f = FreeAnalysis.analyze({ activity, laps, series, allActivities: all, nowMs: Date.now(), hrMax, goalKm, goalDplus, RP: (typeof RacePredictor !== 'undefined' ? RacePredictor : null) });
    const sections = [];
    if (f.bilan) sections.push(`<div class="fd-bilan">${f.bilan}</div>`);
    const profile = freeDeepProfileSvg(series);
    if (profile) sections.push(`<div class="fd-block"><div class="fd-title">Profil de la sortie</div>${profile}</div>`);

    const rows1 = [];
    if (f.stops) {
      const stopTxt = f.stops.stoppedSec >= 30 ? `${fmtD(f.stops.stoppedSec)} à l'arrêt sur ${fmtD(f.stops.elapsedSec)}` : 'aucun arrêt notable';
      rows1.push(freeDeepRow('Mouvement et arrêts', stopTxt, f.stops.stoppedSec >= 30 ? `Allure en mouvement <strong>${fmtP(f.stops.paceMoving)}</strong> contre ${fmtP(f.stops.paceElapsed)} arrêts compris` : ''));
    }
    try {
      const mv = (typeof computeMovementSplit === 'function' && series) ? computeMovementSplit(series) : null;
      if (mv && mv.walkSec >= 60) rows1.push(freeDeepRow('Course et marche', `${fmtD(mv.runSec)} de course · ${fmtD(mv.walkSec)} de marche`, mv.runPaceSecKm ? `Allure en course <strong>${fmtP(mv.runPaceSecKm)}</strong>` : ''));
    } catch (e) { /* facultatif */ }
    if (f.eff) {
      const unit = 'm/min par bpm', val = num(Math.round(f.eff.eff * 100) / 100);
      if (f.eff.enough) {
        const d = f.eff.deltaPct, col = f.eff.verdict === 'hausse' ? '#22c55e' : f.eff.verdict === 'baisse' ? '#ef4444' : 'inherit';
        const why = f.eff.verdict === 'hausse' ? 'Tu avances plus vite pour le même effort cardiaque : signe de progression.' : f.eff.verdict === 'baisse' ? 'Même effort cardiaque pour moins de vitesse : fatigue, chaleur ou forme en retrait.' : 'Niveau stable.';
        rows1.push(freeDeepRow('Efficacité aérobie', `<strong>${val}</strong> ${unit} <span style="color:${col}">(${d > 0 ? '+' : ''}${num(d)} %)</span>`, `Comparée à tes ${f.eff.n} sorties de distance et FC comparables des 12 dernières semaines. ${why}`));
      } else rows1.push(freeDeepRow('Efficacité aérobie', `<strong>${val}</strong> ${unit}`, `Pas assez de sorties comparables (${f.eff.n} sur 4 à FC voisine, 12 semaines) pour juger une évolution.`));
    }
    if (f.drift) {
      if (f.drift.ok) {
        const lab = { excellent: 'excellente', bon: 'bonne', modere: 'modérée', marque: 'marquée' }[f.drift.level];
        rows1.push(freeDeepRow('Dérive cardiaque', `<strong>${num(f.drift.decouplingPct)} %</strong> de perte d'efficacité · tenue ${lab}`, `FC ${f.drift.hrFirst} → ${f.drift.hrSecond} bpm entre 1re et 2e moitié, pente neutralisée. Sous 5 % : base aérobie solide.`));
      } else if (f.drift.why) rows1.push(freeDeepRow('Dérive cardiaque', '—', `Non calculée : ${f.drift.why}.`));
    }
    if (f.reg) {
      const lab = { tres_reguliere: 'très régulière', reguliere: 'régulière', irreguliere: 'irrégulière', tres_irreguliere: 'très irrégulière' }[f.reg.level];
      const split = f.reg.splitKind === 'stable' ? 'sans dérive entre début et fin' : f.reg.splitKind === 'negatif' ? `négative : ${Math.abs(f.reg.splitSec)}"/km plus vite en fin de sortie` : `positive : ${f.reg.splitSec}"/km plus lent en fin de sortie`;
      rows1.push(freeDeepRow('Régularité', `Allure ${f.reg.basis === 'GAP' ? 'ajustée ' : ''}<strong>${lab}</strong> (écart ${num(f.reg.cvPct)} %)`, `Course ${split}.${f.reg.level.indexOf('irreg') >= 0 ? ` Écart le plus marqué au km ${f.reg.worstKm}.` : ''}`));
    }
    if (f.week && f.week.avg4Km) {
      const cmt = f.week.ratio >= 1.3 ? 'semaine nettement plus chargée : surveille la récupération' : f.week.ratio <= 0.7 ? 'semaine plus légère' : 'charge comparable';
      rows1.push(freeDeepRow('Charge de la semaine', `<strong>${fmtKm(f.week.thisWeekKm)} km</strong> cette semaine`, `Moyenne des 4 semaines précédentes : ${fmtKm(f.week.avg4Km)} km (${cmt}).`));
    }
    if (f.race) {
      if (f.race.applicable) {
        const s = f.race.sec, h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
        rows1.push(freeDeepRow('Équivalent course', `Environ <strong>${h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min'}</strong> sur ${fmtKm(f.race.targetKm)} km`, `Effort maximal soutenu (${Math.round(f.race.frac * 100)} % de la FC max) : cette sortie reflète ton niveau du moment, à mettre en regard de l'estimation de ton objectif.`));
      } else if (goalKm > 0) rows1.push(freeDeepRow('Équivalent course', '—', `Sortie à ${Math.round(f.race.frac * 100)} % de ta FC max : ce n'était pas un effort maximal, elle ne dit rien de ton chrono sur ${fmtKm(goalKm)} km.`));
    }
    if (rows1.length) sections.push(`<div class="fd-block"><div class="fd-title">Forme et exécution</div>${rows1.join('')}</div>`);

    const rows2 = [];
    if (f.tech) {
      const t = f.tech;
      if (t.cadence) rows2.push(freeDeepRow('Cadence', `<strong>${t.cadence.avg}</strong> pas/min`, `${t.cadence.first} au début → ${t.cadence.last} en fin (${t.cadence.delta > 0 ? '+' : ''}${t.cadence.delta}).`));
      if (t.stride) rows2.push(freeDeepRow('Longueur de foulée', `<strong>${num(Math.round(t.stride.avgCm) / 100)} m</strong>`, ''));
      if (t.gct) rows2.push(freeDeepRow('Contact au sol', `<strong>${t.gct.avg}</strong> ms`, `${t.gct.first} → ${t.gct.last} ms entre début et fin (${t.gct.delta > 0 ? '+' : ''}${t.gct.delta}).`));
      if (t.vo || t.vr) rows2.push(freeDeepRow('Oscillation verticale', `${t.vo ? `<strong>${num(t.vo.avgCm)}</strong> cm` : ''}${t.vo && t.vr ? ' · ' : ''}${t.vr ? `ratio <strong>${num(t.vr.avg)}</strong> %` : ''}`, 'Plus c\'est bas, moins tu gaspilles d\'énergie à rebondir.'));
      rows2.push(freeDeepRow('Fatigue technique', t.fatigue.length ? t.fatigue.join(' ; ') : 'aucun signe', t.fatigue.length ? 'Comparaison du premier et du dernier tiers de la sortie.' : 'Cadence et contact au sol stables du début à la fin.'));
    }
    if (f.power) {
      const p = f.power;
      const vi = p.vi ? `Indice de variabilité ${num(p.vi)} (${p.vi < 1.05 ? 'effort très régulier' : p.vi < 1.12 ? 'effort assez régulier' : 'effort variable'}). ` : '';
      rows2.push(freeDeepRow('Puissance', `<strong>${p.avg} W</strong> en moyenne${p.np ? ` · normalisée ${p.np} W` : ''}`, `${vi}${p.first} W au début → ${p.last} W en fin (${p.deltaPct > 0 ? '+' : ''}${num(p.deltaPct)} %).`));
    }
    if (rows2.length) sections.push(`<div class="fd-block"><div class="fd-title">Technique et puissance</div>${rows2.join('')}</div>`);

    if (!sections.length) return;
    body.innerHTML = sections.join('');
    card.style.display = '';
  };

  // La trace seconde par seconde (FC, vitesse ajustée) donne la dérive propre et le profil ; sans elle, les calculs
  // à partir des tours restent disponibles.
  const loader = (typeof loadAnalysisActivityElevation === 'function') ? loadAnalysisActivityElevation(activity.id) : Promise.resolve(null);
  loader.then(series => run(series || null)).catch(() => run(null));
}
